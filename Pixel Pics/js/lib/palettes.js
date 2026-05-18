// Each palette is a list of RGB triples in 0..255 (or `null` to mean "no
// quantization — keep the downscaled pixels as-is"). Order in the list
// determines order in the dropdown.

const hex = ( s ) => {
    const n = parseInt( s.replace('#', ''), 16 )
    return [ (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff ]
}

const palette = ( label, hexes ) => ({ label, colors: hexes.map( hex ) })

export const PALETTES = [
    { label: 'Full color',  colors: null },

    palette('Black & White',  ['#000000', '#ffffff']),

    palette('Grayscale (8)', [
        '#000000', '#242424', '#4a4a4a', '#6e6e6e',
        '#939393', '#b8b8b8', '#dcdcdc', '#ffffff'
    ]),

    // High-contrast cinematic black & white — deep shadows, bright highlights,
    // few mid-tones. Pushes a photo toward classic noir film stock.
    palette('Noir', [
        '#000000', '#0c0c0c', '#1f1f1f', '#3a3a3a',
        '#d2d2d2', '#ececec', '#f8f8f8', '#ffffff'
    ]),

    palette('Sepia', [
        '#1d0f00', '#3d1f08', '#5a3010', '#7c4a20',
        '#a4683a', '#c98a5a', '#e2b07e', '#f4d8a8'
    ]),

    // Original Game Boy DMG screen: 4 shades of pea-soup green.
    palette('Game Boy', [
        '#0f380f', '#306230', '#8bac0f', '#9bbc0f'
    ]),

    // Curated 16-color subset of the NES master palette — the "8-bit Nintendo"
    // look.
    palette('NES 8-bit', [
        '#000000', '#fcfcfc', '#7c7c7c', '#bcbcbc',
        '#0000fc', '#0058f8', '#3cbcfc', '#a4e4fc',
        '#940084', '#d800cc', '#f878f8', '#fcb4f0',
        '#a81000', '#f83800', '#fc7460', '#fcbcb0'
    ]),

    // Approximation of an SNES-era 16-color "16-bit" palette: brighter, wider
    // gamut than NES, more pastels.
    palette('SNES 16-bit', [
        '#000000', '#ffffff', '#2d2d54', '#5151a8',
        '#9090ff', '#c4ddff', '#206020', '#48a848',
        '#90e090', '#601818', '#c83030', '#ff7878',
        '#a86018', '#e0a830', '#ffd870', '#ffe8a8'
    ]),

    // PICO-8 fantasy console — 16 carefully-chosen colors used by a
    // generation of indie pixel art.
    palette('PICO-8', [
        '#000000', '#1d2b53', '#7e2553', '#008751',
        '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
        '#ff004d', '#ffa300', '#ffec27', '#00e436',
        '#29adff', '#83769c', '#ff77a8', '#ffccaa'
    ]),

    // Commodore 64 — distinctive 16-color hardware palette.
    palette('Commodore 64', [
        '#000000', '#ffffff', '#880000', '#aaffee',
        '#cc44cc', '#00cc55', '#0000aa', '#eeee77',
        '#dd8855', '#664400', '#ff7777', '#333333',
        '#777777', '#aaff66', '#0088ff', '#bbbbbb'
    ])
]

// Find the nearest palette color to (r, g, b) by squared Euclidean distance
// in RGB space. Returns the matched color triple. `colors` is a non-empty
// array of [r, g, b].
export function nearestColor( r, g, b, colors ) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < colors.length; i++) {
        const c = colors[i]
        const dr = r - c[0]
        const dg = g - c[1]
        const db = b - c[2]
        const d = dr * dr + dg * dg + db * db
        if (d < bestDist) {
            bestDist = d
            bestIdx = i
        }
    }
    return colors[bestIdx]
}
