import { fbm, fbm3 } from './noise.js';

const mix = ( a, b, t ) => a.map( ( c, i ) => c + ( b[ i ] - c ) * t );

export const KINDS = {
    rocky:  { amp: 0.06, freq: 2.2, low: [ 0x6a, 0x5a, 0x50 ], mid: [ 0xa8, 0x8a, 0x6c ], high: [ 0xd8, 0xc6, 0xb0 ], sea: null },
    lush:   { amp: 0.04, freq: 2.6, low: [ 0x3f, 0x6e, 0x45 ], mid: [ 0x8a, 0x9a, 0x5c ], high: [ 0xe8, 0xe4, 0xd8 ], sea: [ 0x2b, 0x4a, 0x7c ], seaLevel: 0.1 },
    icy:    { amp: 0.03, freq: 3.0, low: [ 0x9c, 0xb4, 0xc4 ], mid: [ 0xdd, 0xe8, 0xee ], high: [ 0xff, 0xff, 0xff ], sea: [ 0x7a, 0x9a, 0xb4 ], seaLevel: -0.2 },
    ember:  { amp: 0.07, freq: 2.0, low: [ 0xc8, 0x40, 0x2e ], mid: [ 0x3a, 0x2c, 0x2a ], high: [ 0x6a, 0x5c, 0x58 ], sea: [ 0xe0, 0x5a, 0x24 ], seaLevel: -0.3 },
    gas:    { amp: 0.0, freq: 1, low: [ 0xe2, 0xbf, 0x86 ], mid: [ 0xf1, 0xe4, 0xcc ], high: [ 0xc9, 0x8e, 0x6a ], sea: null },
};

export function surfaceAt( kind, k, v, seed, radius, octaves ) {
    let e = k.amp ? fbm3( v[ 0 ] * k.freq + 10, v[ 1 ] * k.freq, v[ 2 ] * k.freq, seed, octaves ) : 0;
    if ( kind === 'rocky' ) e -= 0.08 * Math.max( 0, 1 - 30 * Math.abs( fbm3( v[ 0 ] * 5, v[ 1 ] * 5, v[ 2 ] * 5, seed + 3, 2 ) ) );
    const wet = k.sea && e < k.seaLevel;
    const r = radius * ( 1 + ( wet ? k.seaLevel : e ) * k.amp * 4 );
    let rgb;
    if ( kind === 'gas' ) {
        const band = fbm( v[ 1 ] * 9 + fbm3( v[ 0 ] * 3, v[ 1 ] * 3, v[ 2 ] * 3, seed, 3 ) * 1.5, 0.5, seed + 9, 3 );
        rgb = band > 0.2 ? k.low : band < -0.2 ? k.high : k.mid;
    } else if ( wet ) rgb = k.sea;
    else {
        const t = Math.min( 1, Math.max( 0, ( e + 0.5 ) ) );
        rgb = t < 0.5 ? mix( k.low, k.mid, t * 2 ) : mix( k.mid, k.high, ( t - 0.5 ) * 2 );
        if ( kind !== 'icy' && Math.abs( v[ 1 ] ) > 0.86 + e * 0.3 ) rgb = [ 0xee, 0xee, 0xf4 ];
    }
    return { r, rgb };
}

