export function seeded( seed ) {
    let s = seed >>> 0 || 1;
    return function () {
        s = ( s * 1664525 + 1013904223 ) >>> 0;
        return s / 4294967296;
    };
}

function hash( x, y, z ) {
    let h = ( x * 374761393 + y * 668265263 + z * 2147483647 ) | 0;
    h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
    return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;
}

const fade = ( t ) => t * t * ( 3 - 2 * t );
const lerp = ( a, b, t ) => a + ( b - a ) * t;

// Smooth value noise in [0, 1].
export function noise3( x, y, z ) {
    const x0 = Math.floor( x );
    const y0 = Math.floor( y );
    const z0 = Math.floor( z );
    const tx = fade( x - x0 );
    const ty = fade( y - y0 );
    const tz = fade( z - z0 );
    const c00 = lerp( hash( x0, y0, z0 ), hash( x0 + 1, y0, z0 ), tx );
    const c10 = lerp( hash( x0, y0 + 1, z0 ), hash( x0 + 1, y0 + 1, z0 ), tx );
    const c01 = lerp( hash( x0, y0, z0 + 1 ), hash( x0 + 1, y0, z0 + 1 ), tx );
    const c11 = lerp( hash( x0, y0 + 1, z0 + 1 ), hash( x0 + 1, y0 + 1, z0 + 1 ), tx );
    return lerp( lerp( c00, c10, ty ), lerp( c01, c11, ty ), tz );
}
