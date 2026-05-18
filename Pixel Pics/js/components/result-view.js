import { h } from '../lib/dom.js'
import { PALETTES } from '../lib/palettes.js'
import { DITHERS } from '../lib/dithers.js'
import { pixelize, nearestUpscale } from '../lib/pixelize.js'

const GRID_SIZES = [ 32, 64, 128 ]
const EXPORT_SCALES = [ 1, 4, 8, 16 ]
const BRUSH_SIZES = [ 1, 2, 5, 10 ]

const BG_COLORS = [
    { label: 'Transparent', value: 'transparent' },
    { label: 'Black',       value: '#000000' },
    { label: 'White',       value: '#ffffff' },
    { label: 'Gray',        value: '#808080' },
    { label: 'Red',         value: '#d83030' },
    { label: 'Orange',      value: '#f08018' },
    { label: 'Yellow',      value: '#f8d840' },
    { label: 'Green',       value: '#40a850' },
    { label: 'Cyan',        value: '#40b8c8' },
    { label: 'Blue',        value: '#3858c8' },
    { label: 'Purple',      value: '#9040b8' },
    { label: 'Pink',        value: '#f070b8' }
]

export function createResultView( container, props ) {
    const source = props.source          // square HTMLCanvasElement captured by camera
    const mask   = props.mask            // same-size mask canvas (alpha=255 over person, alpha=0 over bg) or null
    const onNew  = props.onNew

    let gridSize    = 64
    let paletteIdx  = 5  // Game Boy by default — picks well from a typical lit face
    let ditherKind  = 'bayer4'
    let exportScale = 8
    let bgColor     = 'transparent'
    let brushSize   = 5
    // Brush erase strokes. Each stroke is one undo step; `currentStroke` is
    // the one being drawn while the mouse is down. Op coords are FRACTIONS
    // of the image (0..1) so they scale correctly when grid size changes.
    let strokes     = []
    let currentStroke = null
    let dragging    = false
    // basePixelCanvas is the raw pixelize() output; pixelCanvas is that
    // canvas with brush erasures composited on top. We split them so the
    // mousemove path doesn't re-pixelize on every event — it just re-applies
    // strokes to the cached basePixelCanvas.
    let basePixelCanvas = null
    let pixelCanvas = null

    // Pre-compute the cutout (source with bg pixels made transparent via the
    // mask). Reused on every render. Cheap to keep around — same dimensions
    // as the source.
    const cutout = mask ? buildCutout( source, mask ) : null

    // ---- DOM ----

    const previewImg = h('canvas', { className: 'rv-canvas rv-canvas-brush' })
    previewImg.addEventListener('mousedown', onMouseDown)
    const frame = h('div', { className: 'rv-frame' }, previewImg)
    const stage = h('div', { className: 'rv-stage' }, frame)

    // Window-level so a drag that leaves the canvas is still tracked.
    const winMove = ( e ) => { if (dragging) { addBrushOp( e.clientX, e.clientY ); rerenderWithBrush() } }
    const winUp   = ()    => { if (!dragging) return; dragging = false; if (currentStroke && currentStroke.ops.length) strokes.push( currentStroke ); currentStroke = null; rerenderWithBrush() }
    window.addEventListener('mousemove', winMove)
    window.addEventListener('mouseup',   winUp)

    const sizeSelect = h('select', {
        className: 'rv-select',
        onChange: ( e ) => { gridSize = parseInt( e.target.value, 10 ); recompute() }
    })
    for (const s of GRID_SIZES) {
        const opt = h('option', { value: String( s ) }, `${s} × ${s}`)
        if (s === gridSize) opt.selected = true
        sizeSelect.appendChild( opt )
    }

    const paletteSelect = h('select', {
        className: 'rv-select',
        onChange: ( e ) => { paletteIdx = parseInt( e.target.value, 10 ); recompute() }
    })
    for (let i = 0; i < PALETTES.length; i++) {
        const opt = h('option', { value: String( i ) }, PALETTES[i].label)
        if (i === paletteIdx) opt.selected = true
        paletteSelect.appendChild( opt )
    }

    const ditherSelect = h('select', {
        className: 'rv-select',
        onChange: ( e ) => { ditherKind = e.target.value; recompute() }
    })
    for (const d of DITHERS) {
        const opt = h('option', { value: d.value }, d.label)
        if (d.value === ditherKind) opt.selected = true
        ditherSelect.appendChild( opt )
    }

    const bgSelect = h('select', {
        className: 'rv-select',
        title: 'Background color — shown through every transparent pixel (face cutout + brush erasures)',
        onChange: ( e ) => { bgColor = e.target.value; rerenderWithBrush() }
    })
    for (const bg of BG_COLORS) {
        const opt = h('option', { value: bg.value }, bg.label)
        if (bg.value === bgColor) opt.selected = true
        bgSelect.appendChild( opt )
    }

    const brushSelect = h('select', {
        className: 'rv-select rv-select-narrow',
        title: 'Brush erase size, in native pixels',
        onChange: ( e ) => { brushSize = parseInt( e.target.value, 10 ) }
    })
    for (const s of BRUSH_SIZES) {
        const opt = h('option', { value: String( s ) }, `${s} px`)
        if (s === brushSize) opt.selected = true
        brushSelect.appendChild( opt )
    }

    const undoBtn = h('button', {
        className: 'rv-undo-btn',
        title: 'Undo last erase stroke',
        onClick: handleUndo
    }, '⟲ Undo')

    const scaleSelect = h('select', {
        className: 'rv-select',
        onChange: ( e ) => { exportScale = parseInt( e.target.value, 10 ) }
    })
    for (const s of EXPORT_SCALES) {
        const opt = h('option', { value: String( s ) }, s === 1 ? 'Native (1×)' : `${s}× upscale`)
        if (s === exportScale) opt.selected = true
        scaleSelect.appendChild( opt )
    }

    const newBtn = h('button', {
        className: 'rv-new-btn',
        onClick: onNew
    }, 'New Pic')

    const saveBtn = h('button', {
        className: 'rv-save-btn',
        onClick: handleSave
    }, 'Save PNG')

    const controls = h('div', { className: 'rv-controls' },
        h('div', { className: 'rv-field' },
            h('label', { className: 'rv-field-label' }, 'Size'),
            sizeSelect
        ),
        h('div', { className: 'rv-field' },
            h('label', { className: 'rv-field-label' }, 'Palette'),
            paletteSelect
        ),
        h('div', { className: 'rv-field' },
            h('label', { className: 'rv-field-label' }, 'Dither'),
            ditherSelect
        ),
        h('div', { className: 'rv-field' },
            h('label', { className: 'rv-field-label' }, 'Background'),
            bgSelect
        ),
        h('div', { className: 'rv-field' },
            h('label', { className: 'rv-field-label' }, 'Eraser'),
            h('div', { className: 'rv-brush-row' }, brushSelect, undoBtn)
        ),
        h('div', { className: 'rv-field' },
            h('label', { className: 'rv-field-label' }, 'Export'),
            scaleSelect
        ),
        h('div', { className: 'rv-spacer' }),
        newBtn,
        saveBtn
    )

    const root = h('div', { className: 'rv-container' }, stage, controls)
    container.appendChild( root )

    recompute()

    function recompute() {
        const palette = PALETTES[paletteIdx]
        // Pixelize the cutout if we have one (face-isolated, alpha=0 in bg
        // areas), otherwise the raw cropped source. The background color
        // is NOT baked in here — it's applied as a layer behind the brushed
        // canvas in rerenderWithBrush(), so brush strokes also reveal it.
        const input = cutout || source
        basePixelCanvas = pixelize( input, gridSize, palette, ditherKind )
        rerenderWithBrush()
    }

    function rerenderWithBrush() {
        if (!basePixelCanvas) return
        const w = basePixelCanvas.width
        const h = basePixelCanvas.height

        // Step 1: brushed copy of basePixelCanvas with strokes' erasures
        // punched out as alpha=0.
        const brushed = document.createElement('canvas')
        brushed.width = w
        brushed.height = h
        const bctx = brushed.getContext('2d')
        bctx.drawImage( basePixelCanvas, 0, 0 )
        if (strokes.length > 0 || currentStroke) {
            const img = bctx.getImageData( 0, 0, w, h )
            const all = currentStroke ? [...strokes, currentStroke] : strokes
            for (const stroke of all) {
                const radius = stroke.size / 2
                for (const op of stroke.ops) {
                    eraseCircle( img.data, op.x * w, op.y * h, radius, w, h )
                }
            }
            bctx.putImageData( img, 0, 0 )
        }

        // Step 2: layer brushed on top of the chosen background color.
        // Any alpha=0 pixel (cutout bg OR brush erasure) reveals it.
        // 'Transparent' skips the fill so the saved PNG keeps real alpha.
        const display = document.createElement('canvas')
        display.width = w
        display.height = h
        const dctx = display.getContext('2d')
        if (bgColor !== 'transparent') {
            dctx.fillStyle = bgColor
            dctx.fillRect( 0, 0, w, h )
        }
        dctx.drawImage( brushed, 0, 0 )

        pixelCanvas = display

        previewImg.width = w
        previewImg.height = h
        const pctx = previewImg.getContext('2d')
        pctx.imageSmoothingEnabled = false
        pctx.clearRect( 0, 0, w, h )
        pctx.drawImage( display, 0, 0 )
    }

    function onMouseDown( e ) {
        e.preventDefault()
        dragging = true
        currentStroke = { size: brushSize, ops: [] }
        addBrushOp( e.clientX, e.clientY )
        rerenderWithBrush()
    }

    // Append one (and possibly several interpolated) brush op(s) to the
    // current stroke. We linearly fill in the gap to the previous op so
    // fast drags don't leave gaps in the erased line.
    function addBrushOp( clientX, clientY ) {
        if (!currentStroke) return
        // The canvas element can be wider or taller than the square buffer
        // (the workspace flex layout can clamp .rv-frame to non-square via
        // max-height/max-width). With object-fit: contain, the buffer lands
        // letterboxed inside the element — so we have to compute the actual
        // drawn-image rect (centered square at the smaller of W/H) and base
        // fractional cursor coords on THAT, not on the element rect, or the
        // brush drifts proportionally to distance from the image center.
        const rect = previewImg.getBoundingClientRect()
        const drawSize = Math.min( rect.width, rect.height )
        const drawLeft = rect.left + (rect.width  - drawSize) / 2
        const drawTop  = rect.top  + (rect.height - drawSize) / 2
        const x = (clientX - drawLeft) / drawSize
        const y = (clientY - drawTop)  / drawSize
        if (x < 0 || x > 1 || y < 0 || y > 1) return

        const ops = currentStroke.ops
        if (ops.length === 0) {
            ops.push({ x, y })
            return
        }
        // Step every ~1 native pixel along the line; gridSize is the native
        // pixel count, so 1 pixel = 1/gridSize fraction.
        const last = ops[ops.length - 1]
        const dx = x - last.x
        const dy = y - last.y
        const dist = Math.hypot( dx, dy )
        const stepFrac = 1 / Math.max( gridSize, 1 )
        const steps = Math.max( 1, Math.ceil( dist / stepFrac ) )
        for (let i = 1; i <= steps; i++) {
            const t = i / steps
            ops.push({ x: last.x + dx * t, y: last.y + dy * t })
        }
    }

    function handleUndo() {
        if (strokes.length === 0) return
        strokes.pop()
        rerenderWithBrush()
    }

    // Crisp pixel-level eraser: walk a bbox around the brush center, set
    // alpha=0 on every pixel whose CENTER (index + 0.5 in continuous grid
    // coords) is inside the squared radius. Without the +0.5 the math is
    // half a pixel off, which makes the brush feel like it lands above-left
    // of the cursor. No anti-aliasing — pixel art uses binary alpha.
    function eraseCircle( data, cx, cy, radius, w, h ) {
        const r2   = radius * radius
        const minX = Math.max( 0, Math.floor( cx - radius ) )
        const maxX = Math.min( w - 1, Math.ceil(  cx + radius ) )
        const minY = Math.max( 0, Math.floor( cy - radius ) )
        const maxY = Math.min( h - 1, Math.ceil(  cy + radius ) )
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dx = (x + 0.5) - cx
                const dy = (y + 0.5) - cy
                if (dx * dx + dy * dy <= r2) {
                    data[(y * w + x) * 4 + 3] = 0
                }
            }
        }
    }

    // Build a same-size canvas with the source's pixels where mask is opaque
    // and full transparency elsewhere. globalCompositeOperation 'destination-in'
    // keeps the destination's pixels only where the source-being-drawn has
    // non-zero alpha — exactly the cutout semantics we want.
    function buildCutout( src, m ) {
        const c = document.createElement('canvas')
        c.width = src.width
        c.height = src.height
        const ctx = c.getContext('2d')
        ctx.drawImage( src, 0, 0 )
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage( m, 0, 0 )
        return c
    }

    function handleSave() {
        if (!pixelCanvas) return
        const out = exportScale === 1 ? pixelCanvas : nearestUpscale( pixelCanvas, exportScale )
        out.toBlob(( blob ) => {
            if (!blob) return
            const url = URL.createObjectURL( blob )
            const ts = new Date().toISOString().replace( /[:.]/g, '-' ).slice( 0, 19 )
            const safe = ( s ) => s.replace( /[^A-Za-z0-9]+/g, '-' )
            const bgTag = bgColor === 'transparent' ? '' : `_bg-${safe( bgColor )}`
            const name = `pixel-pic_${gridSize}_${safe( PALETTES[paletteIdx].label )}_${safe( ditherKind )}${bgTag}_${ts}.png`
            const a = h('a', { href: url, download: name })
            document.body.appendChild( a )
            a.click()
            a.remove()
            URL.revokeObjectURL( url )
        }, 'image/png')
    }

    return {
        destroy() {
            window.removeEventListener('mousemove', winMove)
            window.removeEventListener('mouseup',   winUp)
            root.remove()
        }
    }
}
