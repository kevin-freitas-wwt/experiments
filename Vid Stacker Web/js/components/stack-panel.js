import { h } from '../lib/dom.js'
import { Stacker } from '../webgl/stacker.js'
import { BLEND_MODES } from '../webgl/blend-modes.js'
import { extractFrames } from '../lib/extractor.js'

function formatElapsed( ms ) {
    const totalSec = ms / 1000
    const m = Math.floor( totalSec / 60 )
    const s = (totalSec % 60).toFixed(1).padStart( 4, '0' )
    return `${m}:${s}`
}

export function createStackPanel( container, props ) {
    let video    = props.video
    let inPoint  = props.inPoint
    let outPoint = props.outPoint
    const getFrameSource = props.getFrameSource

    let blendMode = 'lighten'
    let stacker   = null
    let stackState = 'idle' // 'idle' | 'extracting' | 'done' | 'error'
    let progress  = { done: 0, total: 0 }
    let canExport = false
    let elapsedMs = 0
    let showProgress = false
    let timerInterval = null
    let progressHoldTimeout = null
    let errorMsg = null
    // Frames the user has appended via "Add Frame" since the last completed
    // Stack. The Undo button is visible only while this is > 0.
    let addedFrameCount = 0

    // ---- DOM ----

    const canvas = h('canvas', { className: 'sp-canvas' })

    const canvasOverlay = h('div', { className: 'sp-canvas-overlay' },
        h('p', null, 'Stack result will appear here')
    )

    const progressFill = h('div', { className: 'sp-progress-fill', style: { width: '0%' } })
    const progressText = h('span', { className: 'sp-progress-text' }, '')
    const progressTimer = h('span', { className: 'sp-progress-timer' }, '0:00.0')
    const progressOverlay = h('div', { className: 'sp-progress-overlay', style: { display: 'none' } },
        h('div', { className: 'sp-progress-bar' }, progressFill),
        h('div', { className: 'sp-progress-meta' }, progressText, progressTimer)
    )

    const errorMsgEl = h('p', null, '')
    const errorOverlay = h('div', { className: 'sp-error-overlay', style: { display: 'none' } },
        errorMsgEl,
        h('button', {
            className: 'sp-retry-btn',
            onClick: () => { stackState = 'idle'; errorMsg = null; paint() }
        }, 'Dismiss')
    )

    const undoBtn = h('button', {
        className: 'sp-undo-btn',
        style: { display: 'none' },
        onClick: handleUndo
    }, 'Undo')

    const canvasArea = h('div', { className: 'sp-canvas-area' },
        canvas, canvasOverlay, progressOverlay, errorOverlay, undoBtn
    )

    const select = h('select', {
        className: 'sp-select',
        onChange: ( e ) => { blendMode = e.target.value; if (stacker) stacker.setBlendMode( blendMode ) }
    })
    // Build optgroups.
    const grouped = {}
    for (const m of BLEND_MODES) {
        if (!grouped[m.group]) grouped[m.group] = []
        grouped[m.group].push( m )
    }
    for (const group of Object.keys( grouped )) {
        const optgroup = h('optgroup', { label: group })
        for (const m of grouped[group]) {
            const opt = h('option', { value: m.value }, m.label)
            if (m.value === blendMode) opt.selected = true
            optgroup.appendChild( opt )
        }
        select.appendChild( optgroup )
    }

    const stackBtn = h('button', {
        className: 'sp-stack-btn',
        onClick: handleStack
    }, 'Stack')

    const addFrameBtn = h('button', {
        className: 'sp-add-frame-btn',
        onClick: handleAddFrame
    }, 'Add Frame')

    const exportBtn = h('button', {
        className: 'sp-export-btn',
        onClick: handleExport
    }, 'Export')

    const controls = h('div', { className: 'sp-controls' },
        h('div', { className: 'sp-controls-row' },
            h('div', { className: 'sp-blend-group' },
                h('label', { className: 'sp-section-label' }, 'Blend Mode'),
                select
            ),
            h('div', { className: 'sp-spacer' }),
            stackBtn,
            addFrameBtn,
            exportBtn
        )
    )

    const root = h('div', { className: 'sp-panel' }, canvasArea, controls)
    container.appendChild( root )
    paint()

    // ---- behavior ----

    function initStacker() {
        if (stacker) stacker.dispose()
        stacker = new Stacker( canvas, video.width, video.height )
        stacker.setBlendMode( blendMode )
        return stacker
    }

    async function handleStack() {
        if (stackState === 'extracting') return
        stackState = 'extracting'
        errorMsg = null
        canExport = false
        progress = { done: 0, total: 0 }
        showProgress = true
        addedFrameCount = 0

        const startMs = Date.now()
        elapsedMs = 0
        clearInterval( timerInterval )
        clearTimeout( progressHoldTimeout )
        timerInterval = setInterval(() => {
            elapsedMs = Date.now() - startMs
            paintProgress()
        }, 100)

        paint()

        const stk = initStacker()

        try {
            await extractFrames( video.file, inPoint, outPoint, ( frame, index, total ) => {
                stk.addFrame( frame )
                // The extractor may deliver a VideoFrame (closable) for
                // non-rotated videos, or a reused HTMLCanvasElement (no close)
                // when it had to rotate the source into display orientation.
                if (typeof frame.close === 'function') frame.close()
                progress = { done: index + 1, total }
                paintProgress()
            })
            stackState = 'done'
            canExport = true
            // Snapshot the post-Stack accumulator so Undo can later restore it
            // after any number of Add Frame appends.
            stk.snapshot()
            clearInterval( timerInterval )
            timerInterval = null
            // Keep progress overlay visible for 8s post-completion.
            progressHoldTimeout = setTimeout(() => {
                showProgress = false
                paint()
            }, 8000)
            paint()
        } catch (e) {
            clearInterval( timerInterval )
            timerInterval = null
            errorMsg = `Extraction failed: ${e instanceof Error ? e.message : String( e )}`
            stackState = 'error'
            showProgress = false
            paint()
        }
    }

    function handleAddFrame() {
        if (stackState !== 'done' || !stacker) return
        const videoEl = getFrameSource && getFrameSource()
        // readyState >= 2 (HAVE_CURRENT_DATA) is the minimum for texImage2D to
        // upload a valid frame; below that, the upload would silently use a
        // stale or 0×0 source.
        if (!videoEl || videoEl.readyState < 2) return
        stacker.addFrame( videoEl )
        addedFrameCount++
        paint()
    }

    function handleUndo() {
        if (addedFrameCount === 0 || !stacker || !stacker.hasSnapshot()) return
        stacker.restoreSnapshot()
        addedFrameCount = 0
        paint()
    }

    function handleExport() {
        if (!canExport) return
        canvas.toBlob(( blob ) => {
            if (!blob) return
            const url = URL.createObjectURL( blob )
            const a = h('a', { href: url, download: `stacked_${Date.now()}.png` })
            document.body.appendChild( a )
            a.click()
            a.remove()
            URL.revokeObjectURL( url )
        }, 'image/png')
    }

    function paint() {
        // Overlays
        canvasOverlay.style.display = stackState === 'idle' ? 'flex' : 'none'
        progressOverlay.style.display = showProgress ? 'flex' : 'none'
        if (stackState === 'error' && errorMsg) {
            errorOverlay.style.display = 'flex'
            errorMsgEl.textContent = errorMsg
        } else {
            errorOverlay.style.display = 'none'
        }
        paintProgress()
        // Buttons
        const selectionSec = outPoint - inPoint
        stackBtn.disabled = stackState === 'extracting' || selectionSec <= 0
        addFrameBtn.disabled = stackState !== 'done'
        exportBtn.disabled = !canExport
        select.disabled = stackState === 'extracting'
        undoBtn.style.display = addedFrameCount > 0 ? 'block' : 'none'
    }

    function paintProgress() {
        const estFrames = Math.round( (outPoint - inPoint) * video.fps )
        const pct = progress.total > 0
            ? Math.round( (progress.done / progress.total) * 100 )
            : 0
        progressFill.style.width = pct + '%'
        progressText.textContent = `${progress.done} / ${progress.total || ('~' + estFrames)} frames`
        progressTimer.textContent = formatElapsed( elapsedMs )
    }

    return {
        update( next ) {
            if (next.inPoint  !== undefined) inPoint  = next.inPoint
            if (next.outPoint !== undefined) outPoint = next.outPoint
            paint()
        },
        destroy() {
            clearInterval( timerInterval )
            clearTimeout( progressHoldTimeout )
            if (stacker) stacker.dispose()
            root.remove()
        }
    }
}
