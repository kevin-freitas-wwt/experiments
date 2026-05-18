import { h, svg } from '../lib/dom.js'
import { decodeImage } from '../lib/decode.js'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']

export function createDropZone( container, { onImagesLoaded } ) {
    let dragging = false
    let loading  = false
    let error    = null

    const fileInput = h('input', {
        type: 'file',
        accept: 'image/*',
        multiple: true,
        className: 'dz-hidden-input',
        onChange: ( e ) => {
            const files = Array.from( e.target.files || [] )
            if (files.length) loadFiles( files )
            e.target.value = ''
        }
    })

    const root = h('div', {
        className: 'dz-zone',
        onDrop: handleDrop,
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave
    })

    container.appendChild( root )
    render()

    async function loadFiles( files ) {
        const images = files.filter(( f ) => {
            if (f.type.startsWith('image/')) return true
            const ext = ( f.name.split('.').pop() || '' ).toLowerCase()
            return IMAGE_EXTS.includes( ext )
        })
        if (!images.length) {
            error = 'No image files were dropped. Use PNG, JPG, WebP, GIF, or BMP.'
            render()
            return
        }
        loading = true
        error = null
        render()
        try {
            const decoded = await Promise.all( images.map( decodeFile ) )
            onImagesLoaded( decoded )
        } catch (e) {
            error = `Could not read images: ${e instanceof Error ? e.message : String( e )}`
            loading = false
            render()
        }
    }

    async function decodeFile( file ) {
        const canvas = await decodeImage( file )
        return { file, bitmap: canvas }
    }

    function handleDrop( e ) {
        e.preventDefault()
        dragging = false
        const files = Array.from( e.dataTransfer.files || [] )
        if (files.length) loadFiles( files )
        else render()
    }
    function handleDragOver( e ) {
        e.preventDefault()
        if (!dragging) { dragging = true; render() }
    }
    function handleDragLeave() {
        dragging = false
        render()
    }

    function render() {
        root.className = 'dz-zone' + (dragging ? ' dz-dragging' : '')
        root.replaceChildren( fileInput )
        if (loading) {
            root.appendChild( h('div', { className: 'dz-loading' },
                h('div', { className: 'dz-spinner' }),
                h('span', null, 'Reading images…')
            ))
        } else {
            root.appendChild( h('div', { className: 'dz-inner' },
                h('div', { className: 'dz-icon' },
                    svg('svg', { viewBox: '0 0 48 48', fill: 'none' },
                        svg('rect',    { x: 6,  y: 6,  width: 36, height: 36, rx: 3, stroke: 'currentColor', 'stroke-width': 2 }),
                        svg('circle',  { cx: 16, cy: 18, r: 3, fill: 'currentColor' }),
                        svg('path',    { d: 'M8 38 L20 24 L28 32 L36 22 L42 30 L42 38 Z', fill: 'currentColor', opacity: 0.7 })
                    )
                ),
                h('p', { className: 'dz-primary' }, 'Drop image files here'),
                h('p', { className: 'dz-secondary' }, 'PNG, JPG, WebP, GIF — one or many'),
                h('button', { className: 'dz-btn', onClick: () => fileInput.click() }, 'Browse Files'),
                error ? h('p', { className: 'dz-error' }, error) : null
            ))
        }
    }

    return {
        destroy() {
            root.remove()
        }
    }
}
