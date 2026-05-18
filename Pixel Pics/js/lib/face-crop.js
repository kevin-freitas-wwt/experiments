// detectAndCrop(canvas, opts?) →
//   { canvas, mask, faceFound, error }
//
//   canvas    HTMLCanvasElement — square crop of the source, centered on the
//             detected face (with padding), or a centered fallback crop when
//             no face was found.
//   mask      HTMLCanvasElement same size as `canvas`, alpha=255 where the
//             person was detected, alpha=0 over background, ready to use as
//             a `destination-in` composition mask. `null` if a face wasn't
//             found OR the segmenter failed (so the caller can decide to
//             skip background replacement gracefully).
//   faceFound boolean — true if MediaPipe found at least one face.
//   error     string | null — last error message, useful for surfacing
//             setup failures to the user.
//
// Runs MediaPipe's FaceDetector and ImageSegmenter (selfie segmenter) in
// parallel on the same input. Both are loaded lazily as ES modules from
// jsDelivr and warmed at module load. Together they add ~3MB of WASM +
// ~400KB of model files on first run; everything caches after that.

import {
    FaceDetector,
    ImageSegmenter,
    FilesetResolver
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs'

const WASM_URL    = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
const FACE_MODEL  = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
const SEG_MODEL   = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite'

let detectorPromise = null
let segmenterPromise = null

function loadDetector() {
    if (detectorPromise) return detectorPromise
    detectorPromise = (async () => {
        const vision = await FilesetResolver.forVisionTasks( WASM_URL )
        return FaceDetector.createFromOptions( vision, {
            baseOptions: { modelAssetPath: FACE_MODEL },
            runningMode: 'IMAGE'
        })
    })().catch(( e ) => { detectorPromise = null; throw e })
    return detectorPromise
}

function loadSegmenter() {
    if (segmenterPromise) return segmenterPromise
    segmenterPromise = (async () => {
        const vision = await FilesetResolver.forVisionTasks( WASM_URL )
        return ImageSegmenter.createFromOptions( vision, {
            baseOptions: { modelAssetPath: SEG_MODEL },
            runningMode: 'IMAGE',
            outputCategoryMask: true,
            outputConfidenceMasks: false
        })
    })().catch(( e ) => { segmenterPromise = null; throw e })
    return segmenterPromise
}

// Warm both models in the background so the first Snap is fast.
loadDetector().then(
    () => console.log('[face-crop] FaceDetector ready'),
    ( e ) => console.warn('[face-crop] FaceDetector load failed:', e)
)
loadSegmenter().then(
    () => console.log('[face-crop] ImageSegmenter ready'),
    ( e ) => console.warn('[face-crop] ImageSegmenter load failed:', e)
)

export async function detectAndCrop( canvas, opts = {} ) {
    const padding = opts.padding ?? 0.5

    const [faceResult, segResult] = await Promise.allSettled([
        loadDetector().then(( d ) => d.detect( canvas )),
        loadSegmenter().then(( s ) => s.segment( canvas ))
    ])

    let bbox = null
    let error = null
    if (faceResult.status === 'fulfilled') {
        const dets = (faceResult.value && faceResult.value.detections) || []
        console.log( `[face-crop] ${dets.length} face(s) found` )
        if (dets.length > 0) {
            let best = dets[0]
            for (const d of dets) {
                const da = d.boundingBox.width * d.boundingBox.height
                const ba = best.boundingBox.width * best.boundingBox.height
                if (da > ba) best = d
            }
            bbox = best.boundingBox
        }
    } else {
        error = errMsg( faceResult.reason )
        console.warn('[face-crop] face detection error:', faceResult.reason)
    }

    // Compute the square crop region in source coordinates.
    let cx, cy, size
    if (bbox) {
        cx = bbox.originX + bbox.width / 2
        cy = bbox.originY + bbox.height / 2
        size = Math.max( bbox.width, bbox.height ) * (1 + padding * 2)
    } else {
        cx = canvas.width / 2
        cy = canvas.height / 2
        size = Math.min( canvas.width, canvas.height )
    }
    size = Math.min( size, canvas.width, canvas.height )
    let x0 = Math.round( cx - size / 2 )
    let y0 = Math.round( cy - size / 2 )
    x0 = Math.max( 0, Math.min( canvas.width  - size, x0 ) )
    y0 = Math.max( 0, Math.min( canvas.height - size, y0 ) )

    // Crop the source.
    const out = document.createElement('canvas')
    out.width = size
    out.height = size
    out.getContext('2d').drawImage( canvas, x0, y0, size, size, 0, 0, size, size )

    // Crop the segmentation mask to the same region, if we have one and a
    // face was found (no point isolating without a face — center-crop
    // background isolation would just remove framing).
    let maskCanvas = null
    if (bbox && segResult.status === 'fulfilled') {
        try {
            maskCanvas = extractAndCropMask( segResult.value.categoryMask, canvas, x0, y0, size )
        } catch (e) {
            console.warn('[face-crop] mask extraction failed:', e)
        }
    } else if (bbox && segResult.status === 'rejected') {
        console.warn('[face-crop] segmenter error:', segResult.reason)
        if (!error) error = errMsg( segResult.reason )
    }
    // Always close the MPMask if it exists, to release the underlying GPU
    // resources back to MediaPipe.
    if (segResult.status === 'fulfilled' && segResult.value && segResult.value.categoryMask) {
        try { segResult.value.categoryMask.close() } catch {}
    }

    return { canvas: out, mask: maskCanvas, faceFound: bbox !== null, error }
}

// Turn an MPMask into an HTMLCanvasElement of (size × size) where person
// pixels are opaque white and background pixels are fully transparent. The
// segmenter's mask is the full input image's resolution (or the model's
// internal resolution), so we sample the right region with drawImage scaling.
function extractAndCropMask( mpMask, sourceCanvas, x0, y0, size ) {
    const maskW = mpMask.width
    const maskH = mpMask.height
    const raw   = mpMask.getAsUint8Array()

    // Build a same-resolution canvas where person pixels are opaque white
    // and background pixels are transparent. Selfie segmenter category mask
    // uses 0 for the person foreground and 255 for background.
    const full = document.createElement('canvas')
    full.width = maskW
    full.height = maskH
    const fctx = full.getContext('2d')
    const img = fctx.createImageData( maskW, maskH )
    const out = img.data
    for (let i = 0; i < raw.length; i++) {
        const isPerson = raw[i] === 0
        const o = i * 4
        out[o    ] = 255
        out[o + 1] = 255
        out[o + 2] = 255
        out[o + 3] = isPerson ? 255 : 0
    }
    fctx.putImageData( img, 0, 0 )

    // Project the crop region (in source coords) into mask coords.
    const sx = maskW / sourceCanvas.width
    const sy = maskH / sourceCanvas.height
    const cropped = document.createElement('canvas')
    cropped.width = size
    cropped.height = size
    cropped.getContext('2d').drawImage(
        full,
        x0 * sx, y0 * sy, size * sx, size * sy,
        0, 0, size, size
    )
    return cropped
}

function errMsg( e ) {
    return e instanceof Error ? e.message : String( e )
}
