// extractFrames(file, startSec, endSec, onFrame) → Promise<void>
//
// onFrame is called as `onFrame(videoFrame, index, total)` per emitted frame.
// The callback OWNS the VideoFrame and must call frame.close() to release GPU
// memory (the Stacker does this after uploading to a texture).
//
// Pipeline:
//   File → ArrayBuffer → MP4Box demux → EncodedVideoChunks → VideoDecoder → VideoFrames
//
// Selection handling:
//   - Find first sample with cts ≥ startSec.
//   - Snap that index *backward* to the nearest sync sample (keyframe), because
//     the decoder needs a valid GOP to produce frames after the keyframe.
//   - Decode through endSec.
//   - In the output callback, frames whose presentation timestamp falls before
//     startSec are closed without emission (decoder needed them for reference).
//
// Chromium-based WebCodecs decoders emit frames in presentation order with
// their EncodedVideoChunk timestamps intact, so we don't reorder here.

import { createFile, DataStream, Endianness } from './mp4box.all.min.js'

export async function extractFrames( file, startSec, endSec, onFrame ) {
    if (!('VideoDecoder' in globalThis)) {
        throw new Error('WebCodecs (VideoDecoder) not supported in this browser.')
    }

    const arrayBuffer = await file.arrayBuffer()
    arrayBuffer.fileStart = 0

    const mp4boxFile = createFile()
    const allSamples = []
    let track = null

    // mp4box 2.x: register onSamples BEFORE appendBuffer, and resolve once
    // we've received track.nb_samples samples. start() no longer synchronously
    // drains already-buffered samples the way 0.5.x did.
    await new Promise(( resolve, reject ) => {
        const timeout = setTimeout(() => {
            reject( new Error(`MP4Box extraction stalled: got ${allSamples.length} of ${track ? track.nb_samples : '?'} samples`) )
        }, 30000)

        mp4boxFile.onError = ( msg ) => {
            clearTimeout( timeout )
            reject( new Error(`MP4Box: ${msg}`) )
        }

        mp4boxFile.onReady = ( info ) => {
            const vt = info.videoTracks && info.videoTracks[0]
            if (!vt) {
                clearTimeout( timeout )
                reject( new Error('No video track found in this file.') )
                return
            }
            track = vt
            mp4boxFile.setExtractionOptions( vt.id, null, { nbSamples: 200 } )
            mp4boxFile.start()
            mp4boxFile.flush()
        }

        mp4boxFile.onSamples = ( _id, _user, samples ) => {
            for (const s of samples) allSamples.push( s )
            if (track && allSamples.length >= track.nb_samples) {
                clearTimeout( timeout )
                resolve()
            }
        }

        mp4boxFile.appendBuffer( arrayBuffer )
    })

    if (allSamples.length === 0) {
        throw new Error('No samples extracted from video track.')
    }

    const description = getCodecDescription( mp4boxFile, track.id )

    // Some videos (especially phone portrait clips) ship with a rotation in
    // the MP4 tkhd matrix that the browser applies on <video>, but WebCodecs
    // doesn't apply automatically to decoded VideoFrames. We detect it here
    // and rotate each frame into display orientation before handing it off.
    const rotation = rotationFromMatrix( getTrackMatrix( mp4boxFile, track ) )
    let rotateCanvas = null
    let rotateCtx = null
    if (rotation !== 0) {
        const swap = (rotation === 90 || rotation === 270)
        rotateCanvas = document.createElement('canvas')
        rotateCanvas.width  = swap ? track.video.height : track.video.width
        rotateCanvas.height = swap ? track.video.width  : track.video.height
        rotateCtx = rotateCanvas.getContext('2d')
    }

    const config = {
        codec: track.codec,
        codedWidth: track.video.width,
        codedHeight: track.video.height,
        description
    }

    const support = await VideoDecoder.isConfigSupported( config )
    if (!support.supported) {
        throw new Error( `Codec "${track.codec}" is not supported by this browser's VideoDecoder.` )
    }

    const timescale = track.timescale
    const startTs = startSec * timescale
    const endTs   = endSec   * timescale

    // Locate the first sample whose presentation timestamp falls in selection.
    let firstIdx = -1
    for (let i = 0; i < allSamples.length; i++) {
        if (allSamples[i].cts >= startTs) {
            firstIdx = i
            break
        }
    }
    if (firstIdx === -1) {
        throw new Error('No frames in the selected time range.')
    }
    // Snap backward to nearest sync sample so the decoder has a valid GOP.
    while (firstIdx > 0 && !allSamples[firstIdx].is_sync) {
        firstIdx--
    }

    // Last sample to decode: the last whose cts is still ≤ endTs.
    let lastIdx = allSamples.length - 1
    for (let i = firstIdx; i < allSamples.length; i++) {
        if (allSamples[i].cts > endTs) {
            lastIdx = i - 1
            break
        }
    }
    if (lastIdx < firstIdx) lastIdx = firstIdx

    // Estimated total = samples whose presentation order is within [startTs, endTs].
    let estimatedTotal = 0
    for (let i = firstIdx; i <= lastIdx; i++) {
        if (allSamples[i].cts >= startTs) estimatedTotal++
    }
    if (estimatedTotal === 0) estimatedTotal = 1

    return new Promise(( resolve, reject ) => {
        let emittedCount = 0
        let abortError = null

        const decoder = new VideoDecoder({
            output: ( frame ) => {
                if (abortError) { frame.close(); return }
                const ts = frame.timestamp / 1_000_000
                if (ts >= startSec && ts <= endSec) {
                    try {
                        if (rotation !== 0) {
                            // Draw the (pre-rotation) VideoFrame into a reusable
                            // canvas with the rotation applied. The canvas itself
                            // becomes the TexImageSource — the consumer no longer
                            // needs to close the original frame, but does need to
                            // tolerate a source without .close() (canvases have no
                            // such method).
                            drawRotated( rotateCtx, rotateCanvas, frame, rotation )
                            frame.close()
                            onFrame( rotateCanvas, emittedCount, estimatedTotal )
                        } else {
                            onFrame( frame, emittedCount, estimatedTotal )
                        }
                        emittedCount++
                    } catch (e) {
                        abortError = e
                        try { frame.close() } catch {}
                    }
                } else {
                    frame.close()
                }
            },
            error: ( e ) => {
                abortError = e
                reject( e )
            }
        })

        try {
            decoder.configure( config )
        } catch (e) {
            reject( e )
            return
        }

        for (let i = firstIdx; i <= lastIdx; i++) {
            if (abortError) break
            const sample = allSamples[i]
            const chunk = new EncodedVideoChunk({
                type: sample.is_sync ? 'key' : 'delta',
                timestamp: ( sample.cts * 1_000_000 ) / timescale,
                duration: ( sample.duration * 1_000_000 ) / timescale,
                data: sample.data
            })
            decoder.decode( chunk )
        }

        decoder.flush()
            .then(() => {
                if (abortError) reject( abortError )
                else {
                    try { decoder.close() } catch {}
                    resolve()
                }
            })
            .catch( reject )
    })
}

// MP4 tkhd display matrix → rotation in CW screen degrees, snapped to one of
// {0, 90, 180, 270}. Matrix values are 16.16 fixed point. For pure rotations
// the first row is [cosθ, sinθ, 0]; atan2(b, a) recovers θ.
function rotationFromMatrix( matrix ) {
    if (!matrix || matrix.length < 2) return 0
    const FIXED = 65536
    const a = matrix[0] / FIXED
    const b = matrix[1] / FIXED
    const deg = Math.atan2( b, a ) * 180 / Math.PI
    const snapped = (Math.round( deg / 90 ) * 90) % 360
    return (snapped + 360) % 360
}

function getTrackMatrix( mp4boxFile, track ) {
    if (track && track.matrix) return track.matrix
    try {
        const trak = mp4boxFile.getTrackById( track.id )
        return trak && trak.tkhd && trak.tkhd.matrix
    } catch {
        return null
    }
}

function drawRotated( ctx, canvas, frame, rotation ) {
    ctx.save()
    ctx.setTransform( 1, 0, 0, 1, 0, 0 )
    if (rotation === 90) {
        ctx.translate( canvas.width, 0 )
        ctx.rotate( Math.PI / 2 )
    } else if (rotation === 180) {
        ctx.translate( canvas.width, canvas.height )
        ctx.rotate( Math.PI )
    } else if (rotation === 270) {
        ctx.translate( 0, canvas.height )
        ctx.rotate( -Math.PI / 2 )
    }
    ctx.drawImage( frame, 0, 0 )
    ctx.restore()
}

// Pull the avcC / hvcC / vpcC / av1C codec config box bytes out of MP4Box's
// parsed sample description entry. WebCodecs VideoDecoder.configure needs
// these as the `description` field (sequence and picture parameter sets, etc).
// Note: mp4box 2.x split the byte-order constants out of DataStream into a
// separate Endianness enum.
function getCodecDescription( mp4boxFile, trackId ) {
    const trak = mp4boxFile.getTrackById( trackId )
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C
        if (box) {
            const stream = new DataStream( undefined, 0, Endianness.BIG_ENDIAN )
            box.write( stream )
            // Strip the 8-byte ISO BMFF box header (size + type).
            return new Uint8Array( stream.buffer, 8 )
        }
    }
    return undefined
}
