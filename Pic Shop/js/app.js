import { h } from './lib/dom.js'
import { newId } from './lib/id.js'
import { decodeImage } from './lib/decode.js'
import { createDropZone }   from './components/drop-zone.js'
import { createCanvasView } from './components/canvas-view.js'
import { createLayerPanel } from './components/layer-panel.js'
import { showExportModal }  from './components/export-modal.js'

const mount = document.getElementById('root')

const titleBar = h('div', { className: 'app-title-bar' },
    h('span', { className: 'app-title' }, 'Pic Shop'),
    h('span', { className: 'app-tagline' }, 'Blend-mode image layers in the browser')
)
const workspace = h('div', { className: 'app-workspace' })
const rootEl = h('div', { className: 'app-root' }, titleBar, workspace)
mount.appendChild( rootEl )

// Shared state. layers[0] = topmost. canvas dimensions captured on first load.
let layers  = []
let canvasW = 0
let canvasH = 0

let dropZone    = null
let canvasView  = null
let layerPanel  = null

function makeLayer( file, bitmap ) {
    const baseName = (file.name || 'layer').replace(/\.[^.]+$/, '')
    return {
        id: newId(),
        name: baseName,
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        blendMode: 'normal',
        opacity: 1,
        visible: true
    }
}

function showDropZone() {
    workspace.replaceChildren()
    if (canvasView) { canvasView.destroy(); canvasView = null }
    if (layerPanel) { layerPanel.destroy(); layerPanel = null }
    dropZone = createDropZone( workspace, {
        onImagesLoaded: ( items ) => {
            if (!items.length) return
            // First image sets the canvas dimensions.
            canvasW = items[0].bitmap.width
            canvasH = items[0].bitmap.height
            // New layers go at the top of the visual list (start of array).
            // First image loaded ends up at the bottom of the list since
            // subsequent ones get unshifted on top of it.
            layers = []
            for (const item of items) {
                layers.unshift( makeLayer( item.file, item.bitmap ) )
            }
            showWorkspace()
        }
    })
}

function showWorkspace() {
    workspace.replaceChildren()
    if (dropZone) { dropZone.destroy(); dropZone = null }

    canvasView = createCanvasView( workspace, {
        canvasW, canvasH,
        onAddImages: addImages,
        onNewProject: () => {
            layers = []; canvasW = 0; canvasH = 0
            showDropZone()
        },
        onExport: () => {
            if (canvasView) showExportModal( canvasView.getCanvas() )
        }
    })

    layerPanel = createLayerPanel( workspace, {
        onChange:  updateLayer,
        onDelete:  removeLayer,
        onReorder: reorderLayer
    })

    rerender()
}

async function addImages( files ) {
    const images = files.filter(( f ) => f.type.startsWith('image/'))
    if (!images.length) return
    const decoded = await Promise.all( images.map(( f ) =>
        decodeImage( f ).then(( c ) => ({ file: f, bitmap: c }))
    ))
    for (const item of decoded) {
        layers.unshift( makeLayer( item.file, item.bitmap ) )
    }
    rerender()
}

function updateLayer( id, patch ) {
    const i = layers.findIndex(( l ) => l.id === id)
    if (i === -1) return
    layers[i] = { ...layers[i], ...patch }
    rerender()
}

function removeLayer( id ) {
    layers = layers.filter(( l ) => l.id !== id)
    if (layers.length === 0) {
        canvasW = 0; canvasH = 0
        showDropZone()
        return
    }
    rerender()
}

function reorderLayer( sourceId, targetId, insertBefore ) {
    const from = layers.findIndex(( l ) => l.id === sourceId)
    if (from === -1) return
    const [moved] = layers.splice( from, 1 )
    // Recompute target index after the splice — it may have shifted.
    const target = layers.findIndex(( l ) => l.id === targetId)
    if (target === -1) {
        // Shouldn't happen, but restore order rather than lose the layer.
        layers.splice( from, 0, moved )
        return
    }
    const insertIndex = insertBefore ? target : target + 1
    layers.splice( insertIndex, 0, moved )
    rerender()
}

function rerender() {
    if (canvasView) canvasView.update( layers )
    if (layerPanel) layerPanel.update( layers )
}

showDropZone()
