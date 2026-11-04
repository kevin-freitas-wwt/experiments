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

export function hash3( x, y, z, seed ) {
    return hash2( x + z * 7919, y + z * 104729, seed );
}

export function value3( x, y, z, seed ) {
    const xi = Math.floor( x ), yi = Math.floor( y ), zi = Math.floor( z );
    const u = fade( x - xi ), v = fade( y - yi ), w = fade( z - zi );
    const lerp = ( a, b, t ) => a + ( b - a ) * t;
    const c = ( dx, dy, dz ) => hash3( xi + dx, yi + dy, zi + dz, seed );
    const x00 = lerp( c( 0, 0, 0 ), c( 1, 0, 0 ), u ), x10 = lerp( c( 0, 1, 0 ), c( 1, 1, 0 ), u );
    const x01 = lerp( c( 0, 0, 1 ), c( 1, 0, 1 ), u ), x11 = lerp( c( 0, 1, 1 ), c( 1, 1, 1 ), u );
    return lerp( lerp( x00, x10, v ), lerp( x01, x11, v ), w );
}

// Normalised by the infinite-series limit so more octaves add detail without changing the large shape.
export function fbm3( x, y, z, seed, octaves = 4, gain = 0.5 ) {
    let sum = 0, amp = 1, f = 1;
    for ( let i = 0; i < octaves; i++ ) {
        sum += ( value3( x * f, y * f, z * f, seed + i * 131 ) * 2 - 1 ) * amp;
        amp *= gain;
        f *= 2;
    }
    return sum * ( 1 - gain );
}
