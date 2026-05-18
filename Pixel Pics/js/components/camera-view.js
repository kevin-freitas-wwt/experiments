import { h } from '../lib/dom.js'
import { detectAndCrop } from '../lib/face-crop.js'

export function createCameraView( container, props ) {
    const onSnap = props.onSnap   // (squareCanvas) => void

    let stream = null
    let state = 'starting'  // 'starting' | 'ready' | 'denied' | 'unavailable'
    let errorText = null

    const video = h('video', {
        className: 'cv-video',
        autoplay: true,
        playsinline: true,
        muted: true
    })

    const messageTitle = h('p', { className: 'cv-message-title' }, '')
    const messageBody  = h('p', null, '')
    const messageHint  = h('p', { className: 'cv-message-hint' }, '')
    const retryBtn     = h('button', { className: 'cv-retry-btn', onClick: tryStart, style: { display: 'none' } }, 'Try again')
    const message = h('div', { className: 'cv-message' },
        messageTitle, messageBody, messageHint, retryBtn
    )

    // Overlay shown while face detection is running on a captured snap. The
    // snap button alone is too subtle for fast detections — this gives a
    // clear visual that work is happening over the frozen camera frame.
    const detectingSpinner = h('div', { className: 'cv-spinner' })
    const detectingTitle   = h('p', { className: 'cv-message-title' }, 'Detecting face…')
    const detectingHint    = h('p', { className: 'cv-message-hint' }, 'Loading MediaPipe on first run, this may take a moment.')
    const detectingOverlay = h('div', { className: 'cv-message', style: { display: 'none' } },
        detectingSpinner, detectingTitle, detectingHint
    )

    const frame = h('div', { className: 'cv-frame' }, video, message, detectingOverlay)
    const stage = h('div', { className: 'cv-stage' }, frame)

    const snapBtn = h('button', {
        className: 'cv-snap-btn',
        disabled: true,
        onClick: handleSnap
    }, 'Snap')

    const uploadInput = h('input', {
        type: 'file',
        accept: 'image/*',
        className: 'cv-hidden-input',
        onChange: ( e ) => {
            const f = e.target.files && e.target.files[0]
            if (f) handleUpload( f )
            e.target.value = ''
        }
    })
    const uploadBtn = h('button', {
        className: 'cv-upload-btn',
        onClick: () => uploadInput.click()
    }, 'Upload Image')

    const controls = h('div', { className: 'cv-controls' }, snapBtn, uploadBtn, uploadInput)

    const root = h('div', { className: 'cv-container' }, stage, controls)
    container.appendChild( root )

    paint()
    tryStart()

    function paint() {
        if (state === 'ready') {
            message.style.display = 'none'
            video.style.visibility = 'visible'
            snapBtn.disabled = false
        } else {
            message.style.display = 'flex'
            video.style.visibility = 'hidden'
            snapBtn.disabled = true
            if (state === 'starting') {
                messageTitle.textContent = 'Waking up the camera…'
                messageBody.textContent  = ''
                messageHint.textContent  = 'Allow camera access if your browser prompts you.'
                retryBtn.style.display = 'none'
            } else if (state === 'denied') {
                messageTitle.textContent = 'Camera access blocked'
                messageBody.textContent  = errorText || ''
                messageHint.textContent  = 'Re-enable camera access for this site in your browser settings, then click Try again.'
                retryBtn.style.display = 'inline-block'
            } else if (state === 'unavailable') {
                messageTitle.textContent = 'No camera available'
                messageBody.textContent  = errorText || ''
                messageHint.textContent  = 'Connect a webcam (or external camera) and click Try again.'
                retryBtn.style.display = 'inline-block'
            }
        }
    }

    async function tryStart() {
        state = 'starting'
        errorText = null
        paint()
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Camera API not supported by this browser.')
            }
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
                audio: false
            })
            video.srcObject = stream
            await video.play()
            state = 'ready'
        } catch (e) {
            const name = e && e.name
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                state = 'denied'
            } else {
                state = 'unavailable'
            }
            errorText = e instanceof Error ? e.message : String( e )
        }
        paint()
    }

    async function handleSnap() {
        if (state !== 'ready') return
        // Capture the FULL video frame, mirrored to match the selfie preview
        // the user is looking at. Face detection runs on this raw mirrored
        // frame.
        const raw = document.createElement('canvas')
        raw.width = video.videoWidth
        raw.height = video.videoHeight
        const ctx = raw.getContext('2d')
        ctx.save()
        ctx.translate( raw.width, 0 )
        ctx.scale( -1, 1 )
        ctx.drawImage( video, 0, 0 )
        ctx.restore()
        await processAndEmit( raw )
    }

    async function handleUpload( file ) {
        let bitmap
        try {
            bitmap = await createImageBitmap( file, { imageOrientation: 'from-image' } )
        } catch (e) {
            console.error('[camera-view] upload decode failed:', e)
            return
        }
        // Uploaded images aren't selfies, so no mirror.
        const raw = document.createElement('canvas')
        raw.width = bitmap.width
        raw.height = bitmap.height
        raw.getContext('2d').drawImage( bitmap, 0, 0 )
        bitmap.close()
        await processAndEmit( raw )
    }

    async function processAndEmit( rawCanvas ) {
        snapBtn.disabled = true
        snapBtn.textContent = 'Detecting…'
        uploadBtn.disabled = true
        detectingOverlay.style.display = 'flex'
        detectingTitle.textContent = 'Detecting face…'
        detectingHint.textContent  = 'Loading MediaPipe on first run, this may take a moment.'

        // Repaint promise: give the browser a frame to render the overlay
        // before we start the (potentially synchronous-feeling) detection.
        await new Promise(( r ) => requestAnimationFrame( r ))

        const { canvas: cropped, mask, faceFound, error } = await detectAndCrop( rawCanvas, { padding: 0.5 } )

        if (error) {
            detectingTitle.textContent = 'Face detector failed'
            detectingHint.textContent  = `${error}. Continuing with a full-frame crop instead.`
            await new Promise(( r ) => setTimeout( r, 1500 ))
        } else if (!faceFound) {
            detectingTitle.textContent = 'No face detected'
            detectingHint.textContent  = 'Continuing with a full-frame crop. Try again with a clearer face in the frame.'
            await new Promise(( r ) => setTimeout( r, 1500 ))
        }

        onSnap({ canvas: cropped, mask })
    }

    function stop() {
        if (stream) {
            for (const t of stream.getTracks()) t.stop()
            stream = null
        }
    }

    return {
        destroy() {
            stop()
            root.remove()
        }
    }
}
