// probeVideo(file) → { duration, width, height, fps }
//
// Uses an HTMLVideoElement for duration + dimensions (the browser already needs
// to parse those to show preview), and MP4Box for accurate fps from the sample
// timing table. If MP4Box can't read the file (e.g. it's WebM/MKV via Matroska
// rather than ISO BMFF) we fall back to a constant fps default.

import { createFile } from './mp4box.all.min.js'

const FALLBACK_FPS = 30

export async function probeVideo( file ) {
    const url = URL.createObjectURL( file )
    try {
        const { duration, width, height } = await readMetadata( url )
        const fps = await readFps( file ).catch(() => FALLBACK_FPS)
        return { duration, width, height, fps }
    } finally {
        URL.revokeObjectURL( url )
    }
}

function readMetadata( url ) {
    return new Promise(( resolve, reject ) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.muted = true
        v.src = url
        v.addEventListener('loadedmetadata', () => {
            resolve({
                duration: v.duration,
                width: v.videoWidth,
                height: v.videoHeight
            })
        }, { once: true })
        v.addEventListener('error', () => {
            reject( new Error('Could not read video metadata.') )
        }, { once: true })
    })
}

// Use MP4Box to parse the moov atom and compute fps from the first video
// track's nb_samples / duration_in_track_timescale. Works for MP4/MOV/M4V.
function readFps( file ) {
    return new Promise(( resolve, reject ) => {
        const mp4boxFile = createFile()
        mp4boxFile.onError = ( msg ) => reject( new Error(`MP4Box: ${msg}`) )
        mp4boxFile.onReady = ( info ) => {
            const vt = info.videoTracks && info.videoTracks[0]
            if (!vt) {
                reject( new Error('No video track') )
                return
            }
            const fps = vt.nb_samples * vt.timescale / vt.duration
            if (!isFinite( fps ) || fps <= 0) {
                reject( new Error('FPS calculation failed') )
                return
            }
            resolve( fps )
        }

        // Feed the file in chunks so MP4Box can demux progressively. We only
        // need the moov atom to compute fps, which is usually at the start
        // (or end with mdat first); MP4Box decides when it has enough.
        const CHUNK = 4 * 1024 * 1024
        let offset = 0
        const reader = new FileReader()
        reader.onload = ( e ) => {
            const buf = e.target.result
            buf.fileStart = offset
            const next = mp4boxFile.appendBuffer( buf )
            offset += buf.byteLength
            if (offset < file.size && next !== undefined) {
                readNext()
            } else {
                mp4boxFile.flush()
            }
        }
        reader.onerror = () => reject( reader.error )
        const readNext = () => {
            const slice = file.slice( offset, offset + CHUNK )
            reader.readAsArrayBuffer( slice )
        }
        readNext()
    })
}
