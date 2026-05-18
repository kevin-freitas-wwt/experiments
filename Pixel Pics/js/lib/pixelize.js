import { applyDither } from './dithers.js'

// pixelize(source, gridSize, palette, ditherKind) → HTMLCanvasElement
//
//   source      HTMLCanvasElement (assumed square; if not, center-cropped)
//   gridSize    one of 32 / 64 / 128 — both width and height of the result
//   palette     { colors: [[r,g,b], ...] | null } — null = no quantization
//   ditherKind  string from DITHERS in lib/dithers.js; defaults to 'none'
//
// Pipeline:
//   1. Downscale source into a gridSize × gridSize canvas with smoothing
//      enabled so each output pixel is roughly the average of the source
//      region under it.
//   2. If a palette is provided, dispatch to lib/dithers.js to quantize
//      each pixel to a palette color, optionally using ordered-dither
//      thresholds or Floyd–Steinberg error diffusion.
//   3. Return the gridSize canvas. Alpha is forced to 255.
export function pixelize( source, gridSize, palette, ditherKind ) {
    const out = document.createElement('canvas')
    out.width = gridSize
    out.height = gridSize
    const ctx = out.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const dim = Math.min( source.width, source.height )
    const sx  = (source.width  - dim) / 2
    const sy  = (source.height - dim) / 2
    ctx.drawImage( source, sx, sy, dim, dim, 0, 0, gridSize, gridSize )

    if (palette && palette.colors) {
        const img = ctx.getImageData( 0, 0, gridSize, gridSize )
        applyDither( img.data, gridSize, gridSize, ditherKind || 'none', palette )
        ctx.putImageData( img, 0, 0 )
    }

    return out
}

// Produce a scaled-up copy of a pixel-art canvas using nearest-neighbor (so
// each source pixel becomes a hard-edged scale × scale block). Used both for
// the on-screen preview and when the user picks a non-1× export scale.
export function nearestUpscale( source, scale ) {
    const out = document.createElement('canvas')
    out.width = source.width * scale
    out.height = source.height * scale
    const ctx = out.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage( source, 0, 0, out.width, out.height )
    return out
}
