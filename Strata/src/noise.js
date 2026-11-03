export function hash2( x, y, seed ) {
    let h = ( x * 374761393 + y * 668265263 + seed * 2246822519 ) | 0;
    h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
    h ^= h >>> 16;
    return ( h >>> 0 ) / 4294967296;
}

function fade( t ) {
    return t * t * t * ( t * ( t * 6 - 15 ) + 10 );
}

export function value2( x, y, seed ) {
    const xi = Math.floor( x ), yi = Math.floor( y );
    const u = fade( x - xi ), v = fade( y - yi );
    const a = hash2( xi, yi, seed ), b = hash2( xi + 1, yi, seed );
    const c = hash2( xi, yi + 1, seed ), d = hash2( xi + 1, yi + 1, seed );
    return ( a + ( b - a ) * u ) * ( 1 - v ) + ( c + ( d - c ) * u ) * v;
}

export function fbm( x, y, seed, octaves = 4, gain = 0.5 ) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for ( let i = 0; i < octaves; i++ ) {
        sum += ( value2( x * f, y * f, seed + i * 101 ) * 2 - 1 ) * amp;
        norm += amp;
        amp *= gain;
        f *= 2;
    }
    return sum / norm;
}

export function ridged( x, y, seed, octaves = 5 ) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for ( let i = 0; i < octaves; i++ ) {
        const n = 1 - Math.abs( value2( x * f, y * f, seed + i * 211 ) * 2 - 1 );
        sum += n * n * amp;
        norm += amp;
        amp *= 0.55;
        f *= 2.1;
    }
    return sum / norm;
}
