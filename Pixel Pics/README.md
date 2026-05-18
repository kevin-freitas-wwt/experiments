# Pixel Pics

Snap a selfie from your webcam and render it as retro pixel art. Pick a grid
size (32 / 64 / 128), pick a palette (Game Boy, NES, PICO-8, C64, B&W,
Noir, …), and save the result as a PNG — at native pixel size or scaled up
with crisp nearest-neighbor edges.

Pure HTML / CSS / vanilla JavaScript — no build step, no framework.

## Run locally

ES modules + `getUserMedia` both require an HTTP origin (or `https://`).
`file://` won't work. From this folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/> and allow camera access when prompted.

Any static host (GitHub Pages, Netlify, Vercel, S3, …) will host the folder
as-is. `getUserMedia` requires HTTPS on non-localhost origins.

## Browser requirements

- `navigator.mediaDevices.getUserMedia` for the webcam
- 2D canvas API for pixelization (no WebGL needed)
- `canvas.toBlob` for the PNG export

All shipped in every modern browser for a decade.

## Files

```
index.html
css/   global, app, camera-view, result-view
js/
    app.js                          state machine: camera-view ↔ result-view
    components/
        camera-view.js              live preview + Snap button + permission handling
        result-view.js              pixel preview + size / palette / scale dropdowns + Save
    lib/
        dom.js                      h() / svg() helpers
        palettes.js                 10 retro palettes + nearestColor()
        pixelize.js                 downscale-with-smoothing + per-pixel quantization
```
