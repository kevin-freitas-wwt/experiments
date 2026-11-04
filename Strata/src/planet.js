import { fbm3 } from './noise.js';
import { PALETTE, STONE, GRASS, SAND, WATER, SNOW, LEAF, TUNDRA, CLAY, ICE, BASALT, LAVA, RUST } from './blocks.js';

const mix = ( a, b, t ) => a.map( ( c, i ) => c + ( b[ i ] - c ) * t );

// Amplitude and frequency of the height field; sea level in field units. Colours come from the block palette
// so the smooth sphere, the high-res patch and the voxel shell agree.
export const KINDS = {
    rocky: { amp: 0.06, freq: 2.2, sea: false },
    lush:  { amp: 0.04, freq: 2.6, sea: true, seaLevel: 0.1 },
    icy:   { amp: 0.03, freq: 3.0, sea: true, seaLevel: -0.2 },
    ember: { amp: 0.07, freq: 2.0, sea: true, seaLevel: -0.3 },
};

const SHORE = 0.03;

// Biome ids match blocks.js BIOMES and the worker's surface() stack.
export function classify( kind, k, v, e, seed ) {
    const wet = k.sea && e < k.seaLevel;
    const shore = k.sea && ! wet && e < k.seaLevel + SHORE;
    const patch = fbm3( v[ 0 ] * 6 + 3, v[ 1 ] * 6, v[ 2 ] * 6, seed + 21, 3 );
    const polar = Math.abs( v[ 1 ] ) > 0.86 + e * 0.3;
    if ( kind === 'lush' ) {
        if ( wet ) return 0;
        if ( shore ) return 1;
        if ( e > 0.42 || polar ) return 8;
        if ( e > 0.3 ) return 7;
        return patch > 0.05 ? 3 : 2;
    }
    if ( kind === 'icy' ) return wet ? 12 : ( e > 0.38 ? 7 : 10 );
    if ( kind === 'ember' ) return wet ? 11 : 9;
    if ( polar ) return 8;
    return patch > 0.1 ? 4 : 7;
}

// Voxel ground carries baked ambient occlusion and side shading, so the smooth versions are dimmed to match.
const AO = 0.88, dim = ( c, f = AO ) => c.map( ( v ) => v * f );
const BIOME_RGB = {
    0: PALETTE[ WATER ], 1: dim( PALETTE[ SAND ] ), 2: dim( PALETTE[ GRASS ] ), 3: dim( mix( PALETTE[ GRASS ], PALETTE[ LEAF ], 0.9 ), 0.8 ),
    4: dim( mix( PALETTE[ SAND ], PALETTE[ CLAY ], 0.3 ) ), 7: dim( mix( PALETTE[ STONE ], PALETTE[ TUNDRA ], 0.25 ) ), 8: dim( PALETTE[ SNOW ] ),
    9: dim( mix( PALETTE[ BASALT ], PALETTE[ RUST ], 0.3 ) ), 10: dim( PALETTE[ SNOW ] ), 11: PALETTE[ LAVA ], 12: dim( PALETTE[ ICE ] ),
};

export function surfaceAt( kind, k, v, seed, radius, octaves ) {
    let e = fbm3( v[ 0 ] * k.freq + 10, v[ 1 ] * k.freq, v[ 2 ] * k.freq, seed, octaves );
    if ( kind === 'rocky' ) e -= 0.08 * Math.max( 0, 1 - 30 * Math.abs( fbm3( v[ 0 ] * 5, v[ 1 ] * 5, v[ 2 ] * 5, seed + 3, 2 ) ) );
    const wet = k.sea && e < k.seaLevel;
    const r = radius * ( 1 + ( wet ? k.seaLevel : e ) * k.amp * 4 );
    const biome = classify( kind, k, v, e, seed );
    return { r, rgb: BIOME_RGB[ biome ], biome, e };
}
