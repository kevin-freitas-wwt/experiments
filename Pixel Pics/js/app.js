import { h } from './lib/dom.js'
import { createCameraView } from './components/camera-view.js'
import { createResultView } from './components/result-view.js'

const mount = document.getElementById('root')

const titleBar = h('div', { className: 'app-title-bar' },
    h('span', { className: 'app-title' }, 'Pixel Pics'),
    h('span', { className: 'app-tagline' }, 'Snap a selfie, render it as retro pixel art')
)
const workspace = h('div', { className: 'app-workspace' })
const rootEl = h('div', { className: 'app-root' }, titleBar, workspace)
mount.appendChild( rootEl )

let cameraView = null
let resultView = null

function showCamera() {
    workspace.replaceChildren()
    if (resultView) { resultView.destroy(); resultView = null }
    cameraView = createCameraView( workspace, {
        onSnap: ( snap ) => showResult( snap )
    })
}

function showResult( snap ) {
    workspace.replaceChildren()
    if (cameraView) { cameraView.destroy(); cameraView = null }
    resultView = createResultView( workspace, {
        source: snap.canvas,
        mask: snap.mask,
        onNew: () => showCamera()
    })
}

showCamera()
