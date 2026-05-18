import { h, svg } from '../lib/dom.js'
import { probeVideo } from '../lib/probe.js'

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'm4v']

export function createDropZone( container, { onVideoLoaded } ) {
    let dragging = false
    let loading  = false
    let error    = null

    const fileInput = h('input', {
        type: 'file',
        accept: 'video/*',
        className: 'dz-hidden-input',
        onChange: ( e ) => {
            const f = e.target.files && e.target.files[0]
            if (f) loadFile( f )
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

    async function loadFile( file ) {
        const ext = ( file.name.split('.').pop() || '' ).toLowerCase()
        if (!VIDEO_EXTS.includes( ext )) {
            error = 'Unsupported file type. Please use MP4, MOV, MKV, or WebM.'
            render()
            return
        }
        loading = true
        error = null
        render()
        try {
            const info = await probeVideo( file )
            onVideoLoaded({ ...info, file })
        } catch (e) {
            error = `Could not read video: ${e instanceof Error ? e.message : String( e )}`
        } finally {
            loading = false
            render()
        }
    }

    function handleDrop( e ) {
        e.preventDefault()
        dragging = false
        const f = e.dataTransfer.files[0]
        if (f) loadFile( f )
        else render()
    }
    function handleDragOver( e ) {
        e.preventDefault()
        if (!dragging) {
            dragging = true
            render()
        }
    }
    function handleDragLeave() {
        dragging = false
        render()
    }

    function render() {
        root.className = 'dz-zone' + (dragging ? ' dz-dragging' : '')
        // Replace inner content each render — DropZone has little state and
        // few nodes, so we rebuild rather than patching.
        root.replaceChildren( fileInput )
        if (loading) {
            root.appendChild( h('div', { className: 'dz-loading' },
                h('div', { className: 'dz-spinner' }),
                h('span', null, 'Reading video…')
            ))
        } else {
            root.appendChild( h('div', { className: 'dz-inner' },
                h('div', { className: 'dz-icon' },
                    svg('svg', { viewBox: '0 0 48 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
                        svg('rect', { x: 4, y: 10, width: 40, height: 28, rx: 3, stroke: 'currentColor', 'stroke-width': 2 }),
                        svg('polygon', { points: '20,18 20,30 32,24', fill: 'currentColor' }),
                        svg('rect', { x: 4, y: 10, width: 4, height: 28, fill: 'currentColor', opacity: 0.3 }),
                        svg('rect', { x: 40, y: 10, width: 4, height: 28, fill: 'currentColor', opacity: 0.3 })
                    )
                ),
                h('p', { className: 'dz-primary' }, 'Drop a video file here'),
                h('p', { className: 'dz-secondary' }, 'MP4, MOV, MKV, WebM'),
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
