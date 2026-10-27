export function seeded( seed ) {
    let s = seed >>> 0 || 1;
    return function () {
        s = ( s * 1664525 + 1013904223 ) >>> 0;
        return s / 4294967296;
    };
}

function hash( x, y ) {
    let h = ( x * 374761393 + y * 668265263 ) | 0;
    h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
    return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;
}

const fade = ( t ) => t * t * ( 3 - 2 * t );

// Smooth value noise in [0, 1].
export function noise2( x, y ) {
    const x0 = Math.floor( x );
    const y0 = Math.floor( y );
    const tx = fade( x - x0 );
    const ty = fade( y - y0 );
    const a = hash( x0, y0 );
    const b = hash( x0 + 1, y0 );
    const c = hash( x0, y0 + 1 );
    const d = hash( x0 + 1, y0 + 1 );
    return a + ( b - a ) * tx + ( c - a ) * ty + ( a - b - c + d ) * tx * ty;
}
