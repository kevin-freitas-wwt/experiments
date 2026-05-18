import { h } from './lib/dom.js'
import { createDropZone } from './components/drop-zone.js'
import { createVideoPreview } from './components/video-preview.js'
import { createStackPanel } from './components/stack-panel.js'

const mount = document.getElementById('root')

const titleBar = h('div', { className: 'app-title-bar' },
    h('span', { className: 'app-title' }, 'Vid Stacker'),
    h('span', { className: 'app-tagline' }, 'Stack video frames into a long-exposure image')
)
const workspace = h('div', { className: 'app-workspace' })
const rootEl = h('div', { className: 'app-root' }, titleBar, workspace)
mount.appendChild( rootEl )

let video    = null   // { file, duration, width, height, fps }
let inPoint  = 0
let outPoint = 0

let dropZone     = null
let videoPreview = null
let stackPanel   = null

function showDropZone() {
    workspace.replaceChildren()
    if (videoPreview) { videoPreview.destroy(); videoPreview = null }
    if (stackPanel)   { stackPanel.destroy();   stackPanel   = null }
    dropZone = createDropZone( workspace, {
        onVideoLoaded: ( meta ) => {
            video    = meta
            inPoint  = 0
            outPoint = meta.duration
            showWorkspace()
        }
    })
}

function showWorkspace() {
    workspace.replaceChildren()
    if (dropZone) { dropZone.destroy(); dropZone = null }
    videoPreview = createVideoPreview( workspace, {
        video,
        inPoint,
        outPoint,
        onInChange: ( t ) => {
            inPoint = t
            videoPreview.update({ inPoint })
            stackPanel.update({ inPoint })
        },
        onOutChange: ( t ) => {
            outPoint = t
            videoPreview.update({ outPoint })
            stackPanel.update({ outPoint })
        },
        onClear: () => {
            video = null
            inPoint = 0
            outPoint = 0
            showDropZone()
        }
    })
    stackPanel = createStackPanel( workspace, {
        video, inPoint, outPoint,
        getFrameSource: () => videoPreview && videoPreview.getVideoElement()
    })
}

showDropZone()
