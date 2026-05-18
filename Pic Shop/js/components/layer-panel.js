import { h } from '../lib/dom.js'
import { createLayerRow } from './layer-row.js'

export function createLayerPanel( container, props ) {
    const onChange  = props.onChange  // (layerId, patch) => void
    const onDelete  = props.onDelete  // (layerId) => void
    const onReorder = props.onReorder // (sourceId, targetId) => void

    let draggingId = null
    let lastDragOverId = null
    let lastDragOverAbove = false

    const listEl = h('div', { className: 'lp-list' })
    const empty = h('div', { className: 'lp-empty' }, 'No layers yet.')
    const root = h('div', { className: 'lp-panel' },
        h('div', { className: 'lp-header' }, 'Layers'),
        listEl
    )
    container.appendChild( root )

    // Map of layerId → row instance, kept in sync with the latest layers array.
    let rows = new Map()

    function rowEvents() {
        return {
            onChange:    ( id, patch ) => onChange( id, patch ),
            onDelete:    ( id )        => onDelete( id ),
            onDragStart: ( id ) => {
                draggingId = id
                const r = rows.get( id )
                if (r) r.setDraggingClass( true )
            },
            onDragOver:  ( id, above ) => { lastDragOverId = id; lastDragOverAbove = above },
            onDrop:      ( id, above ) => {
                if (draggingId && draggingId !== id) {
                    onReorder( draggingId, id, above )
                }
            },
            onDragEnd:   ( id ) => {
                const r = rows.get( id )
                if (r) r.setDraggingClass( false )
                draggingId = null
                lastDragOverId = null
                lastDragOverAbove = false
            }
        }
    }

    function update( layers ) {
        listEl.replaceChildren()
        rows.clear()
        if (layers.length === 0) {
            listEl.appendChild( empty )
            return
        }
        const ev = rowEvents()
        for (const layer of layers) {
            const row = createLayerRow( layer, {
                onChange:    ( patch ) => ev.onChange( layer.id, patch ),
                onDelete:    ev.onDelete,
                onDragStart: ev.onDragStart,
                onDragOver:  ev.onDragOver,
                onDrop:      ev.onDrop,
                onDragEnd:   ev.onDragEnd
            })
            rows.set( layer.id, row )
            listEl.appendChild( row.element )
        }
    }

    return {
        update,
        destroy() {
            root.remove()
        }
    }
}
