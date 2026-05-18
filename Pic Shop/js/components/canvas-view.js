import { h } from '../lib/dom.js'
import { Compositor } from '../webgl/compositor.js'

export function createCanvasView( container, props ) {
    const onAddImages    = props.onAddImages    // (filesArray) => void
    const onNewProject   = props.onNewProject   // () => void
    const onExport       = props.onExport       // () => void
    let canvasW = props.canvasW
    let canvasH = props.canvasH

    const canvas = h('canvas', { className: 'cv-canvas' })
    const compositor = new Compositor( canvas, canvasW, canvasH )

    const canvasArea = h('div', {
        className: 'cv-canvas-area',
        onDrop: handleDrop,
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave
    }, canvas)

    const fileInput = h('input', {
        type: 'file',
        accept: 'image/*',
        multiple: true,
        className: 'cv-hidden-input',
        onChange: ( e ) => {
            const files = Array.from( e.target.files || [] )
            if (files.length) onAddImages( files )
            e.target.value = ''
        }
    })

    const addBtn = h('button', {
        className: 'cv-add-btn',
        onClick: () => fileInput.click()
    }, 'Add Image')

    const newBtn = h('button', {
        className: 'cv-new-btn',
        onClick: () => {
            if (confirm('Discard the current project and start over?')) onNewProject()
        }
    }, 'New Project')

    const exportBtn = h('button', {
        className: 'cv-export-btn',
        onClick: onExport
    }, 'Export')

    const controls = h('div', { className: 'cv-controls' },
        addBtn,
        h('div', { className: 'cv-spacer' }),
        newBtn,
        exportBtn,
        fileInput
    )

    const root = h('div', { className: 'cv-container' }, canvasArea, controls)
    container.appendChild( root )

    function handleDrop( e ) {
        e.preventDefault()
        canvasArea.classList.remove('cv-dragging')
        const files = Array.from( e.dataTransfer.files || [] )
        if (files.length) onAddImages( files )
    }
    function handleDragOver( e ) {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) {
            canvasArea.classList.add('cv-dragging')
        }
    }
    function handleDragLeave( e ) {
        // Only clear when leaving the canvas area itself, not bubbling from a child.
        if (e.target === canvasArea) canvasArea.classList.remove('cv-dragging')
    }

    return {
        update( layers ) {
            compositor.render( layers )
            exportBtn.disabled = layers.length === 0
        },
        getCanvas() {
            return canvas
        },
        destroy() {
            compositor.dispose()
            root.remove()
        }
    }
}
