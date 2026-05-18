# Pic Shop

Layer-based image compositor in the browser. Drop one or many images, give each
its own blend mode and opacity, reorder / hide / delete layers, then export
to PNG or JPG with a live side-by-side compressed preview.

Pure HTML / CSS / vanilla JavaScript — no build step, no framework.

## Run locally

ES modules need to be served over HTTP — `file://` won't work. From this
folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

Any static host (GitHub Pages, Netlify, Vercel, S3, etc.) will host the folder
as-is.

## Browser requirements

- `createImageBitmap` for off-thread image decode
- WebGL 1 for the blend-mode compositor (16 Photoshop-style modes)
- `canvas.toBlob` for PNG / JPG export
- HTML5 drag-and-drop for layer reorder

All shipped in every modern browser for a decade. No WebCodecs, no MP4Box.

## Files

```
index.html                          (root)
css/   global, app, drop-zone, canvas-view, layer-panel, export-modal
js/
    app.js                          shared layers state + mount/unmount
    components/
        drop-zone.js                multi-file drop / browse
        canvas-view.js              canvas + Compositor + Add / New / Export buttons
        layer-row.js                one row of the layer panel
        layer-panel.js              sortable layer list
        export-modal.js             PNG/JPG modal with side-by-side compressed preview
    webgl/
        compositor.js               multi-layer blend-mode renderer
        blend-modes.js              16 GLSL blend functions
    lib/
        dom.js                      h() / svg() builder helpers
        id.js                       session-id generator for layer keys
        export.js                   canvas → Blob; size formatting
```
