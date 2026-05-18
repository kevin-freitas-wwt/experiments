import { nearestColor } from './palettes.js'

// Dither dropdown options. Order in the array = order in the dropdown.
export const DITHERS = [
    { value: 'none',            label: 'None' },
    { value: 'bayer4',          label: 'Bayer 4×4' },
    { value: 'bayer8',          label: 'Bayer 8×8' },
    { value: 'bluenoise',       label: 'Blue noise' },
    { value: 'floyd-steinberg', label: 'Floyd–Steinberg' }
]

// Threshold offset range in 0..255 units. Larger = more visible dither.
// 48 is a reasonable middle ground across our palettes (2-color B&W gets
// strong dithering, 16-color palettes get gentle dithering).
const STRENGTH = 48

const BAYER_4 = buildBayer([
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5]
])

const BAYER_8 = buildBayer([
    [ 0, 32,  8, 40,  2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44,  4, 36, 14, 46,  6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [ 3, 35, 11, 43,  1, 33,  9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47,  7, 39, 13, 45,  5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21]
])

function buildBayer( rows ) {
    const n = rows.length
    const size = n * n
    const out = new Float32Array( size )
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            // +0.5 so values are at cell centers, mapped to [0, 1).
            out[y * n + x] = (rows[y][x] + 0.5) / size
        }
    }
    return out
}

// Interleaved Gradient Noise — Jorge Jimenez's high-frequency hash, widely
// used as a cheap blue-noise approximation in real-time graphics. Small
// changes in (x, y) produce big changes in output, so the result has
// high-frequency content (no low-frequency clumping) — the perceptual
// signature of true blue noise.
function ign( x, y ) {
    const v = 52.9829189 * frac( 0.06711056 * x + 0.00583715 * y )
    return frac( v )
}
function frac( v ) { return v - Math.floor( v ) }

const clamp255 = ( v ) => v < 0 ? 0 : (v > 255 ? 255 : v)

// applyDither(data, w, h, kind, palette) mutates the Uint8ClampedArray in
// place: each RGBA pixel gets quantized to the nearest palette color, with
// a threshold offset applied (for ordered dithers) or with error diffusion
// (for Floyd–Steinberg). Alpha is forced to 255.
//
// 'none' is a valid kind — it skips the offset (still quantizes to the
// palette). Caller should not invoke at all if there's no palette
// (Full Color mode).
export function applyDither( data, w, h, kind, palette ) {
    if (!palette || !palette.colors) return
    const colors = palette.colors

    if (kind === 'floyd-steinberg') {
        applyFloydSteinberg( data, w, h, colors )
        return
    }

    let threshold
    if (kind === 'bayer4')         threshold = ( x, y ) => BAYER_4[(y & 3) * 4 + (x & 3)]
    else if (kind === 'bayer8')    threshold = ( x, y ) => BAYER_8[(y & 7) * 8 + (x & 7)]
    else if (kind === 'bluenoise') threshold = ign
    else                           threshold = () => 0.5   // 'none': no offset

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            // Binary-alpha pixel art: pixels that came in mostly-transparent
            // (background after masking) stay fully transparent; everything
            // else gets a hard alpha=255 + palette quantization.
            if (data[i + 3] < 128) {
                data[i + 3] = 0
                continue
            }
            const offset = (threshold( x, y ) - 0.5) * STRENGTH * 2
            const r = clamp255( data[i]     + offset )
            const g = clamp255( data[i + 1] + offset )
            const b = clamp255( data[i + 2] + offset )
            const m = nearestColor( r, g, b, colors )
            data[i]     = m[0]
            data[i + 1] = m[1]
            data[i + 2] = m[2]
            data[i + 3] = 255
        }
    }
}

// Classic Floyd–Steinberg error diffusion. We use a Float32 buffer so the
// running error doesn't get repeatedly clamped at byte boundaries.
//   distribution weights, divided by 16:
//                 *  7
//          3   5  1
function applyFloydSteinberg( data, w, h, colors ) {
    const buf = new Float32Array( w * h * 3 )
    for (let p = 0, q = 0; p < data.length; p += 4, q += 3) {
        buf[q]     = data[p]
        buf[q + 1] = data[p + 1]
        buf[q + 2] = data[p + 2]
    }

    const W3 = w * 3
    const push = ( q, weight, er, eg, eb ) => {
        buf[q]     += er * weight
        buf[q + 1] += eg * weight
        buf[q + 2] += eb * weight
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = (y * w + x) * 4
            if (data[p + 3] < 128) continue   // skip transparent pixels
            const q = (y * w + x) * 3
            const r0 = buf[q], g0 = buf[q + 1], b0 = buf[q + 2]
            const m = nearestColor( clamp255( r0 ), clamp255( g0 ), clamp255( b0 ), colors )
            const er = r0 - m[0]
            const eg = g0 - m[1]
            const eb = b0 - m[2]
            buf[q]     = m[0]
            buf[q + 1] = m[1]
            buf[q + 2] = m[2]
            if (x + 1 < w)                push( q + 3,        7 / 16, er, eg, eb )
            if (y + 1 < h) {
                if (x > 0)                push( q - 3 + W3,   3 / 16, er, eg, eb )
                                          push( q     + W3,   5 / 16, er, eg, eb )
                if (x + 1 < w)            push( q + 3 + W3,   1 / 16, er, eg, eb )
            }
        }
    }

    for (let p = 0, q = 0; p < data.length; p += 4, q += 3) {
        if (data[p + 3] < 128) {
            data[p + 3] = 0
            continue
        }
        data[p]     = clamp255( Math.round( buf[q] ) )
        data[p + 1] = clamp255( Math.round( buf[q + 1] ) )
        data[p + 2] = clamp255( Math.round( buf[q + 2] ) )
        data[p + 3] = 255
    }
}
