# Vid Stacker

Stack video frames into a single long-exposure image, in the browser.
Pure HTML / CSS / vanilla JavaScript — no build step, no framework. Drop a
video in, mark in/out points, pick a blend mode, stack the frames, export
a PNG.

## Run locally

ES modules need to be served over HTTP — `file://` won't work. From this
folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

Any static host (GitHub Pages, Netlify, Vercel, S3, etc.) will host the
folder as-is.

## Browser requirements

- WebCodecs `VideoDecoder` — Chrome / Edge, Safari 16.4+, Firefox 130+.
- Plays / decodes anything Chromium's `<video>` element supports natively:
  MP4 (H.264 / HEVC depending on platform), WebM (VP9, AV1), MOV with H.264.
  ProRes / MTS / MXF / older AVI are out.

## Files

```
index.html                          (root)
css/                                six stylesheets, one per component
js/
    app.js                          orchestrator
    components/                     drop-zone, video-preview, timeline, stack-panel
    webgl/                          stacker, blend-modes (16 modes, GLSL shaders)
    lib/
        dom.js                      h() / svg() builder helpers
        probe.js                    HTMLVideoElement + MP4Box for fps
        extractor.js                MP4Box demux → WebCodecs VideoDecoder
        mp4box.all.min.js           vendored MP4Box.js 2.3.0, 189 KB
```
