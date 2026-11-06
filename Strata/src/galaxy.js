import { hash2 } from './noise.js';

// A seeded barred-spiral galaxy, radius G, with the home world 0.55 G out along +x in the disc plane.
// density() is relative (about 1 at home); systems are drawn from it per cell, and the night sky is
// a sample of it seen from wherever you are.
export const G = 1.5e10;
export const HOME_R = 0.55;

const clusters = [];
let seeded = -1, d0 = 1;

function setup( seed ) {
    if ( seeded === seed ) return;
    seeded = seed; clusters.length = 0;
    for ( let k = 0; k < 48; k++ ) {
        const r = 0.25 + hash2( k, 1, seed ) * 0.95, a = hash2( k, 2, seed ) * Math.PI * 2, y = ( hash2( k, 3, seed ) - 0.5 ) * 0.9;
        clusters.push( { x: Math.cos( a ) * r, y, z: Math.sin( a ) * r, s: 0.006 + hash2( k, 4, seed ) * 0.012, w: 3 + hash2( k, 5, seed ) * 8 } );
    }
    d0 = 1; d0 = densityAt( 0, 0, 0, seed );
}

// Galactic coordinates in units of G, from a home-local position in metres. The disc is tilted 62 degrees to
// the home world's ground, so its band arcs over the sky instead of hugging the horizon.
const TILT = 62 * Math.PI / 180, CT = Math.cos( TILT ), ST = Math.sin( TILT );
export function toGalactic( x, y, z ) {
    return [ x / G + HOME_R, ( y * CT - z * ST ) / G, ( y * ST + z * CT ) / G ];
}

export function densityAt( x, y, z, seed ) {
    setup( seed );
    const [ gx, gy, gz ] = toGalactic( x, y, z );
    const r = Math.hypot( gx, gz ), h = Math.abs( gy );
    const disc = Math.exp( -r / 0.35 ) * Math.exp( -h / ( 0.035 * ( 0.5 + r ) ) );
    const phase = Math.atan2( gz, gx ) - 4.5 * Math.log( Math.max( r, 0.02 ) );
    const arm = Math.pow( 0.5 + 0.5 * Math.cos( 2 * phase ), 5 );
    const bar = Math.exp( -( ( r / 0.22 ) ** 2 ) ) * Math.pow( 0.5 + 0.5 * Math.cos( 2 * Math.atan2( gz, gx ) ), 2 );
    const spiral = disc * ( 0.22 + 1.8 * arm + 1.2 * bar );
    const bulge = 3.5 * Math.exp( -( ( r / 0.11 ) ** 2 ) ) * Math.exp( -( ( h / 0.07 ) ** 2 ) );
    const halo = 0.012 * Math.exp( -r / 1.1 ) * Math.exp( -h / 0.6 );
    let gc = 0;
    for ( const c of clusters ) { const d2 = ( gx - c.x ) ** 2 + ( gy - c.y ) ** 2 + ( gz - c.z ) ** 2; gc += c.w * Math.exp( -d2 / ( c.s * c.s ) ); }
    return ( spiral + bulge + halo + gc ) / d0;
}

// Colour of starlight by region: warm in the bulge and clusters, blue-white along the arms, pale in the halo.
export function tintAt( x, y, z, seed ) {
    const [ gx, gy, gz ] = toGalactic( x, y, z );
    const r = Math.hypot( gx, gz ), h = Math.abs( gy );
    if ( r < 0.15 ) return [ 1.0, 0.86, 0.7 ];
    if ( h > 0.08 ) return [ 0.95, 0.92, 0.85 ];
    const phase = Math.atan2( gz, gx ) - 4.5 * Math.log( Math.max( r, 0.02 ) );
    const arm = Math.pow( 0.5 + 0.5 * Math.cos( 2 * phase ), 5 );
    return [ 1 - 0.18 * arm, 1 - 0.1 * arm, 1 ];
}

// Draws n points from the density by rejection; returns home-local positions (metres) with tints.
export function sample( n, seed, rng ) {
    setup( seed );
    const out = [], max = 6;
    let tries = 0;
    while ( out.length < n && tries++ < n * 400 ) {
        const gx = ( rng() * 2.6 - 1.3 ), gy = ( rng() - 0.5 ) * 0.5, gz = ( rng() * 2.6 - 1.3 );
        const x = ( gx - HOME_R ) * G, y = ( gy * CT + gz * ST ) * G, z = ( -gy * ST + gz * CT ) * G;
        if ( rng() * max < densityAt( x, y, z, seed ) ) out.push( { x, y, z, tint: tintAt( x, y, z, seed ) } );
    }
    return out;
}
