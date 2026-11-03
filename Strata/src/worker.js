import { fbm, ridged, hash2 } from './noise.js';
import { AIR, STONE, DIRT, GRASS, SAND, WATER, SNOW, LOG, LEAF, NEEDLE, GRAVEL, TUNDRA, CLAY,
    CHUNK, HEIGHT, SEA, PALETTE, isSolid } from './blocks.js';

const PAD = 3, P = CHUNK + PAD * 2;

const smooth = ( a, b, x ) => {
    const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
    return t * t * ( 3 - 2 * t );
};

let originSeed = null, originC = 0;

function column( x, z, seed ) {
    if ( originSeed !== seed ) { originSeed = seed; originC = fbm( 0, 0, seed, 4 ); }
    const c = fbm( x / 560, z / 560, seed, 4 ) - originC + 0.4;
    const m = ridged( x / 230, z / 230, seed + 7, 5 );
    const d = fbm( x / 38, z / 38, seed + 13, 3 );
    const land = smooth( 0, 0.6, c );
    let h = Math.round( SEA - 9 + c * 26 + m * m * m * 60 * land + d * 3 );
    h = Math.max( 2, Math.min( HEIGHT - 12, h ) );
    const t = fbm( x / 750 + 31, z / 750, seed + 29, 3 ) - ( h - SEA ) / 110;
    const w = fbm( x / 520 - 77, z / 520, seed + 41, 3 );
    let biome;
    if ( h < SEA - 3 ) biome = 0;
    else if ( h <= SEA + 1 ) biome = 1;
    else if ( h > 98 ) biome = 8;
    else if ( h > 80 ) biome = 7;
    else if ( t < -0.32 ) biome = w > 0 ? 6 : 5;
    else if ( w < -0.3 && t > 0.05 ) biome = 4;
    else if ( w > 0.15 ) biome = 3;
    else biome = 2;
    return { h, biome };
}

function surface( biome, depth, x, z, seed ) {
    if ( depth > 3 ) return STONE;
    switch ( biome ) {
        case 0: return depth === 0 ? ( hash2( x, z, seed + 3 ) < 0.5 ? GRAVEL : CLAY ) : STONE;
        case 1: return SAND;
        case 2: return depth === 0 ? GRASS : DIRT;
        case 3: return depth === 0 ? GRASS : DIRT;
        case 4: return depth < 2 ? SAND : CLAY;
        case 5: return depth === 0 ? TUNDRA : DIRT;
        case 6: return depth === 0 ? TUNDRA : DIRT;
        case 7: return depth === 0 && hash2( x, z, seed + 5 ) < 0.25 ? TUNDRA : STONE;
        case 8: return depth === 0 ? SNOW : STONE;
    }
    return STONE;
}

const DENSITY = [ 0, 0, 0.007, 0.08, 0.004, 0.001, 0.05, 0.012, 0 ];

function stampTree( vol, px, pz, h, biome, x, z, seed ) {
    const r = hash2( x, z, seed + 77 );
    const conifer = biome === 6 || biome === 7 || ( biome === 2 && r > 0.6 );
    const set = ( dx, y, dz, b ) => {
        const sx = px + dx, sz = pz + dz;
        if ( sx < 0 || sz < 0 || sx >= P || sz >= P || y >= HEIGHT ) return;
        const i = ( sx * P + sz ) * HEIGHT + y;
        if ( vol[ i ] === AIR ) vol[ i ] = b;
    };
    if ( conifer ) {
        const th = 6 + Math.floor( r * 4 );
        for ( let y = 1; y <= th; y++ ) set( 0, h + y, 0, LOG );
        for ( let dy = 2; dy <= th + 2; dy++ ) {
            const rad = Math.max( 0, ( th + 2 - dy ) * 0.42 + ( dy % 2 ) * 0.5 );
            const ri = Math.ceil( rad );
            for ( let dx = -ri; dx <= ri; dx++ ) for ( let dz = -ri; dz <= ri; dz++ )
                if ( dx * dx + dz * dz <= rad * rad + 0.3 ) set( dx, h + dy, dz, NEEDLE );
        }
    } else {
        const th = 4 + Math.floor( r * 3 ), rad = 2.4 + r;
        for ( let y = 1; y <= th; y++ ) set( 0, h + y, 0, LOG );
        for ( let dy = -2; dy <= 3; dy++ ) for ( let dx = -3; dx <= 3; dx++ ) for ( let dz = -3; dz <= 3; dz++ ) {
            const dd = dx * dx + dy * dy * 1.7 + dz * dz;
            if ( dd <= rad * rad && hash2( x + dx, z + dz + dy * 31, seed + 9 ) > 0.12 ) set( dx, h + th + dy, dz, LEAF );
        }
    }
}

function generate( cx, cz, seed ) {
    const vol = new Uint8Array( P * P * HEIGHT );
    const cols = new Array( P * P );
    const ox = cx * CHUNK - PAD, oz = cz * CHUNK - PAD;
    for ( let px = 0; px < P; px++ ) for ( let pz = 0; pz < P; pz++ ) {
        const x = ox + px, z = oz + pz;
        const col = column( x, z, seed );
        cols[ px * P + pz ] = col;
        const base = ( px * P + pz ) * HEIGHT;
        for ( let y = 0; y <= col.h; y++ ) vol[ base + y ] = surface( col.biome, col.h - y, x, z, seed );
        for ( let y = col.h + 1; y <= SEA; y++ ) vol[ base + y ] = WATER;
    }
    for ( let px = 0; px < P; px++ ) for ( let pz = 0; pz < P; pz++ ) {
        const col = cols[ px * P + pz ], x = ox + px, z = oz + pz;
        if ( col.h > SEA + 1 && hash2( x, z, seed + 99 ) < DENSITY[ col.biome ] ) stampTree( vol, px, pz, col.h, col.biome, x, z, seed );
    }
    return { vol, cols };
}

const DIRS = [
    { n: [ 1, 0, 0 ], shade: 0.78, u: [ 0, 1, 0 ], v: [ 0, 0, 1 ] },
    { n: [ -1, 0, 0 ], shade: 0.78, u: [ 0, 0, 1 ], v: [ 0, 1, 0 ] },
    { n: [ 0, 1, 0 ], shade: 1.0, u: [ 0, 0, 1 ], v: [ 1, 0, 0 ] },
    { n: [ 0, -1, 0 ], shade: 0.5, u: [ 1, 0, 0 ], v: [ 0, 0, 1 ] },
    { n: [ 0, 0, 1 ], shade: 0.68, u: [ 1, 0, 0 ], v: [ 0, 1, 0 ] },
    { n: [ 0, 0, -1 ], shade: 0.68, u: [ 0, 1, 0 ], v: [ 1, 0, 0 ] },
];
const AO = [ 0.5, 0.68, 0.84, 1 ];

class Builder {
    constructor() {
        this.pos = []; this.col = []; this.nrm = []; this.idx = []; this.count = 0;
    }
    quad( x, y, z, d, rgb, ao ) {
        const { n, u, v } = d;
        const cx = x + 0.5 + n[ 0 ] * 0.5, cy = y + 0.5 + n[ 1 ] * 0.5, cz = z + 0.5 + n[ 2 ] * 0.5;
        const corners = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ];
        for ( let i = 0; i < 4; i++ ) {
            const [ a, b ] = corners[ i ];
            this.pos.push( cx + ( u[ 0 ] * a + v[ 0 ] * b ) * 0.5, cy + ( u[ 1 ] * a + v[ 1 ] * b ) * 0.5, cz + ( u[ 2 ] * a + v[ 2 ] * b ) * 0.5 );
            this.nrm.push( n[ 0 ], n[ 1 ], n[ 2 ] );
            const f = AO[ ao[ i ] ];
            this.col.push( rgb[ 0 ] * f, rgb[ 1 ] * f, rgb[ 2 ] * f );
        }
        const c = this.count;
        if ( ao[ 0 ] + ao[ 2 ] > ao[ 1 ] + ao[ 3 ] ) this.idx.push( c, c + 1, c + 2, c, c + 2, c + 3 );
        else this.idx.push( c + 1, c + 2, c + 3, c + 1, c + 3, c );
        this.count += 4;
    }
    pack() {
        return {
            pos: new Float32Array( this.pos ), col: new Uint8Array( this.col ),
            nrm: new Int8Array( this.nrm ), idx: new Uint32Array( this.idx ),
        };
    }
}

function mesh( vol, cx, cz, seed ) {
    const solid = new Builder(), water = new Builder();
    const at = ( x, y, z ) => ( y < 0 || y >= HEIGHT ) ? AIR : vol[ ( ( x + PAD ) * P + z + PAD ) * HEIGHT + y ];
    const occ = ( x, y, z ) => isSolid( at( x, y, z ) ) ? 1 : 0;
    const ao = new Array( 4 ), rgb = [ 0, 0, 0 ];
    for ( let x = 0; x < CHUNK; x++ ) for ( let z = 0; z < CHUNK; z++ ) for ( let y = 0; y < HEIGHT; y++ ) {
        const b = at( x, y, z );
        if ( b === AIR ) continue;
        if ( b === WATER ) {
            if ( at( x, y + 1, z ) === AIR ) {
                ao.fill( 3 );
                water.quad( x, y - 0.15, z, DIRS[ 2 ], PALETTE[ WATER ], ao );
            }
            continue;
        }
        const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
        const jitter = 0.93 + hash2( wx * 7 + y, wz * 13 - y, seed ) * 0.14;
        for ( const d of DIRS ) {
            const nx = x + d.n[ 0 ], ny = y + d.n[ 1 ], nz = z + d.n[ 2 ];
            if ( isSolid( at( nx, ny, nz ) ) ) continue;
            const src = ( d.n[ 1 ] === 0 && ( b === GRASS || b === TUNDRA ) ) ? DIRT : b;
            const base = PALETTE[ src ];
            const s = d.shade * jitter;
            rgb[ 0 ] = base[ 0 ] * s; rgb[ 1 ] = base[ 1 ] * s; rgb[ 2 ] = base[ 2 ] * s;
            const corners = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ];
            for ( let i = 0; i < 4; i++ ) {
                const [ a, bb ] = corners[ i ];
                const s1 = occ( nx + d.u[ 0 ] * a, ny + d.u[ 1 ] * a, nz + d.u[ 2 ] * a );
                const s2 = occ( nx + d.v[ 0 ] * bb, ny + d.v[ 1 ] * bb, nz + d.v[ 2 ] * bb );
                const cc = occ( nx + d.u[ 0 ] * a + d.v[ 0 ] * bb, ny + d.u[ 1 ] * a + d.v[ 1 ] * bb, nz + d.u[ 2 ] * a + d.v[ 2 ] * bb );
                ao[ i ] = s1 && s2 ? 0 : 3 - ( s1 + s2 + cc );
            }
            solid.quad( x, y, z, d, rgb, ao );
        }
    }
    return { solid: solid.pack(), water: water.pack() };
}

function inner( vol, cols ) {
    const blocks = new Uint8Array( CHUNK * CHUNK * HEIGHT );
    const biomes = new Uint8Array( CHUNK * CHUNK );
    for ( let x = 0; x < CHUNK; x++ ) for ( let z = 0; z < CHUNK; z++ ) {
        const src = ( ( x + PAD ) * P + z + PAD ) * HEIGHT, dst = ( x * CHUNK + z ) * HEIGHT;
        blocks.set( vol.subarray( src, src + HEIGHT ), dst );
        biomes[ x * CHUNK + z ] = cols[ ( x + PAD ) * P + z + PAD ].biome;
    }
    return { blocks, biomes };
}

self.onmessage = ( { data } ) => {
    const { cx, cz, seed } = data;
    const { vol, cols } = generate( cx, cz, seed );
    const { solid, water } = mesh( vol, cx, cz, seed );
    const { blocks, biomes } = inner( vol, cols );
    const buffers = [ solid.pos.buffer, solid.col.buffer, solid.nrm.buffer, solid.idx.buffer,
        water.pos.buffer, water.col.buffer, water.nrm.buffer, water.idx.buffer, blocks.buffer, biomes.buffer ];
    self.postMessage( { cx, cz, solid, water, blocks, biomes }, buffers );
};
