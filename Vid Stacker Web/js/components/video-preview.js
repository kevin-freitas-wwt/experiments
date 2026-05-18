import { h, svg } from '../lib/dom.js'
import { createTimeline } from './timeline.js'

function formatTime( sec ) {
    const m = Math.floor( sec / 60 )
    const s = (sec % 60).toFixed(2).padStart(5, '0')
    return `${m}:${s}`
}

export function createVideoPreview( container, props ) {
    let video      = props.video
    let inPoint    = props.inPoint
    let outPoint   = props.outPoint
    const onInChange  = props.onInChange
    const onOutChange = props.onOutChange
    const onClear     = props.onClear

    let currentTime = 0
    let playing     = false
    let loadError   = null
    let objectUrl   = URL.createObjectURL( video.file )

    const videoEl = h('video', {
        src: objectUrl,
        className: 'vp-video',
        preload: 'auto',
        onTimeUpdate: handleTimeUpdate,
        onEnded: () => { playing = false; paintPlayBtn() },
        onError: handleError
    })

    const newVideoBtn = h('button', {
        className: 'vp-new-video-btn',
        onClick: onClear
    }, 'New Video')

    const errorOverlay = h('div', { className: 'vp-error-overlay', style: { display: 'none' } },
        h('p', { className: 'vp-error-title' }, 'Cannot preview this video'),
        h('p', { className: 'vp-error-hint' }, ''),
        h('p', { className: 'vp-error-detail' }, '')
    )

    const videoWrap = h('div', { className: 'vp-video-wrap' },
        videoEl,
        newVideoBtn,
        errorOverlay
    )

    const playBtn = h('button', { className: 'vp-play-btn', onClick: togglePlay })
    paintPlayBtn()

    const timelineSlot = h('div', { className: 'vp-timeline-slot' })
    const timeline = createTimeline( timelineSlot, {
        duration: video.duration,
        currentTime,
        inPoint,
        outPoint,
        onScrub: handleScrub,
        onInChange: handleInChange,
        onOutChange: handleOutChange
    })

    const timeDisplay = h('span', { className: 'vp-time-display' }, '0:00.00')

    const transportRow = h('div', { className: 'vp-transport-row' },
        playBtn,
        timelineSlot,
        timeDisplay
    )

    const inSpan       = h('span', null, '0:00.00')
    const outSpan      = h('span', null, '0:00.00')
    const durationSpan = h('span', null, '0:00.00')
    const framesSpan   = h('span', null, '~0')

    const selectionInfo = h('div', { className: 'vp-selection-info' },
        h('span', { className: 'vp-info-item' }, h('span', { className: 'vp-info-label' }, 'In '),       inSpan),
        h('span', { className: 'vp-info-item' }, h('span', { className: 'vp-info-label' }, 'Out '),      outSpan),
        h('span', { className: 'vp-info-item' }, h('span', { className: 'vp-info-label' }, 'Duration '), durationSpan),
        h('span', { className: 'vp-info-item' }, h('span', { className: 'vp-info-label' }, 'Frames '),   framesSpan)
    )

    const controls = h('div', { className: 'vp-controls' }, transportRow, selectionInfo)
    const root = h('div', { className: 'vp-container' }, videoWrap, controls)

    container.appendChild( root )
    paintSelectionInfo()

    // ---- handlers ----

    function handleTimeUpdate() {
        currentTime = videoEl.currentTime
        timeDisplay.textContent = formatTime( currentTime )
        timeline.update({ currentTime })
        if (videoEl.currentTime >= outPoint) {
            videoEl.pause()
            videoEl.currentTime = outPoint
            playing = false
            paintPlayBtn()
        }
    }

    function handleError() {
        const err = videoEl.error
        let hint
        let technical

        if (!err) {
            hint = 'Video failed to load (unknown error).'
            technical = ''
        } else {
            const codeLabels = {
                1: 'MEDIA_ERR_ABORTED',
                2: 'MEDIA_ERR_NETWORK',
                3: 'MEDIA_ERR_DECODE',
                4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
            }
            const codeLabel = codeLabels[err.code] || `code ${err.code}`
            technical = err.message ? `${codeLabel} — ${err.message}` : codeLabel

            if (err.code === 3) {
                // Most commonly hit on Firefox/macOS with HEVC profiles that
                // VideoToolbox refuses, or older AVI/MKV containers with
                // odd codecs.
                hint = 'Your browser can’t decode this file’s codec or profile (common with HEVC/H.265 variants on Firefox for macOS). Try opening the file in Chrome, Edge, or Safari, or re-encode it to H.264 with:  ffmpeg -i input.mp4 -c:v libx264 -crf 18 -c:a copy output.mp4'
            } else if (err.code === 4) {
                hint = 'This format or container isn’t supported by your browser. MP4 (H.264) and WebM (VP9) work everywhere. Re-encode with:  ffmpeg -i input.mp4 -c:v libx264 -crf 18 -c:a copy output.mp4'
            } else if (err.code === 2) {
                hint = 'The file couldn’t be read from disk. Drop it again.'
            } else {
                hint = 'Playback was aborted.'
            }
        }

        errorOverlay.style.display = 'flex'
        errorOverlay.querySelector('.vp-error-hint').textContent = hint
        errorOverlay.querySelector('.vp-error-detail').textContent = technical
        loadError = `${hint}${technical ? ` (${technical})` : ''}`
        console.error('[video-preview]', technical, video.file && video.file.name)
    }

    function handleScrub( t ) {
        videoEl.currentTime = t
        currentTime = t
        timeDisplay.textContent = formatTime( currentTime )
        timeline.update({ currentTime })
    }

    function togglePlay() {
        if (playing) {
            videoEl.pause()
            playing = false
        } else {
            const atOrPastOut = videoEl.ended || videoEl.currentTime >= outPoint - 0.01
            const beforeIn = videoEl.currentTime < inPoint
            if (atOrPastOut || beforeIn) {
                videoEl.currentTime = inPoint
                currentTime = inPoint
                timeDisplay.textContent = formatTime( currentTime )
                timeline.update({ currentTime })
            }
            videoEl.play()
            playing = true
        }
        paintPlayBtn()
    }

    function scrubTo( t ) {
        if (!videoEl.paused) {
            videoEl.pause()
            playing = false
            paintPlayBtn()
        }
        videoEl.currentTime = t
        currentTime = t
        timeDisplay.textContent = formatTime( currentTime )
        timeline.update({ currentTime })
    }

    function handleInChange( t ) {
        onInChange( t )
        scrubTo( t )
    }
    function handleOutChange( t ) {
        onOutChange( t )
        scrubTo( t )
    }

    function paintPlayBtn() {
        playBtn.replaceChildren(
            svg('svg', { viewBox: '0 0 16 16' },
                playing
                    ? [
                        svg('rect', { x: 3, y: 2, width: 4, height: 12, fill: 'currentColor' }),
                        svg('rect', { x: 9, y: 2, width: 4, height: 12, fill: 'currentColor' })
                      ]
                    : svg('polygon', { points: '3,2 13,8 3,14', fill: 'currentColor' })
            )
        )
    }

    function paintSelectionInfo() {
        const dur = outPoint - inPoint
        const est = Math.round( dur * video.fps )
        inSpan.textContent       = formatTime( inPoint )
        outSpan.textContent      = formatTime( outPoint )
        durationSpan.textContent = formatTime( dur )
        framesSpan.textContent   = '~' + est.toLocaleString()
    }

    return {
        update( next ) {
            if (next.inPoint  !== undefined) inPoint  = next.inPoint
            if (next.outPoint !== undefined) outPoint = next.outPoint
            timeline.update({ inPoint, outPoint })
            paintSelectionInfo()
        },
        getVideoElement() {
            return videoEl
        },
        destroy() {
            timeline.destroy()
            root.remove()
            URL.revokeObjectURL( objectUrl )
        }
    }
}
