import { h, svg } from '../lib/dom.js'
import { BLEND_MODES } from '../webgl/blend-modes.js'

const grouped = BLEND_MODES.reduce(( acc, m ) => {
    if (!acc[m.group]) acc[m.group] = []
    acc[m.group].push( m )
    return acc
}, {})

function buildBlendSelect( layer, onChange ) {
    const select = h('select', {
        className: 'lp-blend',
        title: 'Blend mode',
        onChange: ( e ) => onChange({ blendMode: e.target.value })
    })
    for (const groupName of Object.keys( grouped )) {
        const og = h('optgroup', { label: groupName })
        for (const m of grouped[groupName]) {
            const opt = h('option', { value: m.value }, m.label)
            if (m.value === layer.blendMode) opt.selected = true
            og.appendChild( opt )
        }
        select.appendChild( og )
    }
    return select
}

// Render a 48x48 thumbnail of the layer's image. The layer's `image` is a
// Y-flipped canvas (pre-flipped for WebGL upload in lib/decode.js), so we
// flip Y again here to show it right-side up in the panel.
function buildThumbnail( src ) {
    const T = 48
    const c = h('canvas', { className: 'lp-thumb', width: T, height: T })
    const ctx = c.getContext('2d')
    const s = Math.min( T / src.width, T / src.height )
    const w = src.width * s
    const heightW = src.height * s
    const dx = (T - w) / 2
    const dy = (T - heightW) / 2
    ctx.save()
    ctx.translate( dx, dy + heightW )
    ctx.scale( 1, -1 )
    ctx.drawImage( src, 0, 0, w, heightW )
    ctx.restore()
    return c
}

function eyeOpenSvg() {
    return svg('svg', { viewBox: '0 0 16 16', fill: 'none' },
        svg('path',   { d: 'M1 8 C 3 4, 6 2.5, 8 2.5 C 10 2.5, 13 4, 15 8 C 13 12, 10 13.5, 8 13.5 C 6 13.5, 3 12, 1 8 Z', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
        svg('circle', { cx: 8, cy: 8, r: 2.5, fill: 'currentColor' })
    )
}

function eyeClosedSvg() {
    return svg('svg', { viewBox: '0 0 16 16', fill: 'none' },
        svg('path', { d: 'M2 6 C 4 9, 6 10.5, 8 10.5 C 10 10.5, 12 9, 14 6', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', fill: 'none' }),
        svg('path', { d: 'M3 11 L 4.5 9', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
        svg('path', { d: 'M13 11 L 11.5 9', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
        svg('path', { d: 'M8 11.5 L 8 13', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' })
    )
}

export function createLayerRow( layer, { onChange, onDelete, onDragStart, onDragOver, onDrop, onDragEnd } ) {
    const handle = h('div', {
        className: 'lp-handle',
        title: 'Drag to reorder'
    }, '⋮⋮')

    const eyeBtn = h('button', {
        className: 'lp-eye' + (layer.visible ? '' : ' lp-eye-off'),
        title: layer.visible ? 'Hide layer' : 'Show layer',
        onClick: () => onChange({ visible: !layer.visible })
    }, layer.visible ? eyeOpenSvg() : eyeClosedSvg())

    const thumb = buildThumbnail( layer.image )

    const nameInput = h('input', {
        type: 'text',
        className: 'lp-name',
        value: layer.name,
        spellcheck: 'false',
        onChange: ( e ) => onChange({ name: e.target.value })
    })

    const blend = buildBlendSelect( layer, onChange )

    const opacity = h('input', {
        type: 'number',
        className: 'lp-opacity',
        min: '0',
        max: '100',
        step: '1',
        value: String( Math.round( layer.opacity * 100 ) ),
        title: 'Opacity (%)',
        onInput: ( e ) => {
            const raw = e.target.value
            if (raw === '') return       // user is mid-edit
            const n = parseInt( raw, 10 )
            if (Number.isNaN( n )) return
            const pct = Math.max( 0, Math.min( 100, n ) )
            onChange({ opacity: pct / 100 })
        },
        onBlur: ( e ) => {
            const n = parseInt( e.target.value, 10 )
            const pct = Number.isFinite( n ) ? Math.max( 0, Math.min( 100, n ) ) : 100
            e.target.value = String( pct )
        }
    })
    const opacitySuffix = h('span', { className: 'lp-opacity-suffix' }, '%')
    const opacityWrap = h('div', { className: 'lp-opacity-wrap' }, opacity, opacitySuffix)

    const controls = h('div', { className: 'lp-controls' }, blend, opacityWrap)

    const deleteBtn = h('button', {
        className: 'lp-delete',
        title: 'Delete layer',
        onClick: () => onDelete( layer.id )
    }, '×')

    // The entire row is draggable — the handle is just a visual cue. Inputs,
    // selects, and buttons inside still receive their normal events; the
    // browser only starts a drag when the user mousedown-drags from non-input
    // space (or from the handle).
    const row = h('div', {
        className: 'lp-row',
        'data-layer-id': layer.id,
        draggable: true,
        onDragStart: ( e ) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', layer.id)
            onDragStart( layer.id )
        },
        onDragEnd: () => {
            row.classList.remove('lp-drop-above', 'lp-drop-below')
            onDragEnd( layer.id )
        },
        onDragOver: ( e ) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const rect = row.getBoundingClientRect()
            const above = e.clientY < rect.top + rect.height / 2
            row.classList.toggle('lp-drop-above', above)
            row.classList.toggle('lp-drop-below', !above)
            onDragOver( layer.id, above )
        },
        onDragLeave: ( e ) => {
            // Only clear when truly leaving the row (not when entering a child).
            if (!row.contains( e.relatedTarget )) {
                row.classList.remove('lp-drop-above', 'lp-drop-below')
            }
        },
        onDrop: ( e ) => {
            e.preventDefault()
            const above = row.classList.contains('lp-drop-above')
            row.classList.remove('lp-drop-above', 'lp-drop-below')
            onDrop( layer.id, above )
        }
    }, handle, eyeBtn, thumb, nameInput, deleteBtn, controls)

    return {
        element: row,
        layerId: layer.id,
        setDraggingClass( on ) {
            row.classList.toggle('lp-dragging', on)
        }
    }
}
