import { fbm, ridged, hash2, fbm3, hash3 } from './noise.js';
import { KINDS, surfaceAt } from './planet.js';
import { AIR, STONE, DIRT, GRASS, SAND, WATER, SNOW, LOG, LEAF, NEEDLE, GRAVEL, TUNDRA, CLAY,
    CHUNK, HEIGHT, SEA, PALETTE, isSolid } from './blocks.js';

const PAD = 3, P = CHUNK + PAD * 2;

const smooth = ( a, b, x ) => {
    const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
    return t * t * ( 3 - 2 * t );
};

let originSeed = null, originC = 0;

const continent = ( x, z, seed ) => fbm( x / 1500, z / 1500, seed, 4 ) * 0.7 + fbm( x / 520 + 9, z / 520, seed + 1, 3 ) * 0.3;

function column( x, z, seed ) {
    if ( originSeed !== seed ) { originSeed = seed; originC = continent( 0, 0, seed ); }
    const c = continent( x, z, seed ) - originC + 0.05;
    const m = ridged( x / 230, z / 230, seed + 7, 5 );
    const d = fbm( x / 38, z / 38, seed + 13, 3 );
    const land = smooth( 0.02, 0.3, c );
    let h = Math.round( SEA + 1 + c * 46 + m * m * m * 64 * land + d * 3 );
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

function meshVolume( sx, sy, sz, cell ) {
    const b = new Builder();
    const get = ( x, y, z ) => ( x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ) ? null : cell( x, y, z );
    const occ = ( x, y, z ) => get( x, y, z ) ? 1 : 0;
    const ao = new Array( 4 ), rgb = [ 0, 0, 0 ];
    const corners = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ];
    for ( let x = 0; x < sx; x++ ) for ( let y = 0; y < sy; y++ ) for ( let z = 0; z < sz; z++ ) {
        const c = get( x, y, z );
        if ( ! c ) continue;
        for ( const d of DIRS ) {
            const nx = x + d.n[ 0 ], ny = y + d.n[ 1 ], nz = z + d.n[ 2 ];
            if ( get( nx, ny, nz ) ) continue;
            rgb[ 0 ] = c[ 0 ] * d.shade; rgb[ 1 ] = c[ 1 ] * d.shade; rgb[ 2 ] = c[ 2 ] * d.shade;
            for ( let i = 0; i < 4; i++ ) {
                const [ a, bb ] = corners[ i ];
                const s1 = occ( nx + d.u[ 0 ] * a, ny + d.u[ 1 ] * a, nz + d.u[ 2 ] * a );
                const s2 = occ( nx + d.v[ 0 ] * bb, ny + d.v[ 1 ] * bb, nz + d.v[ 2 ] * bb );
                const cc = occ( nx + d.u[ 0 ] * a + d.v[ 0 ] * bb, ny + d.u[ 1 ] * a + d.v[ 1 ] * bb, nz + d.u[ 2 ] * a + d.v[ 2 ] * bb );
                ao[ i ] = s1 && s2 ? 0 : 3 - ( s1 + s2 + cc );
            }
            b.quad( x - sx / 2, y - sy / 2, z - sz / 2, d, rgb, ao );
        }
    }
    return b.pack();
}

function tile( { x0, z0, size, step, seed } ) {
    const n = size / step + 1;
    const pos = new Float32Array( n * n * 3 ), col = new Uint8Array( n * n * 3 );
    let i = 0;
    for ( let gz = 0; gz < n; gz++ ) for ( let gx = 0; gx < n; gx++ ) {
        const x = x0 + gx * step, z = z0 + gz * step;
        const c = column( x, z, seed );
        const wet = c.h <= SEA;
        const h = wet ? SEA : c.h;
        pos[ i * 3 ] = gx * step; pos[ i * 3 + 1 ] = h - 1; pos[ i * 3 + 2 ] = gz * step;
        let rgb = PALETTE[ wet ? WATER : surface( c.biome, 0, x, z, seed ) ];
        if ( ! wet && ( c.biome === 3 || c.biome === 6 ) ) rgb = PALETTE[ c.biome === 3 ? LEAF : NEEDLE ];
        if ( wet && c.h < SEA - 6 ) rgb = [ 0x24, 0x40, 0x6c ];
        const j = 0.95 + hash2( x, z, seed + 17 ) * 0.1;
        col[ i * 3 ] = rgb[ 0 ] * j; col[ i * 3 + 1 ] = rgb[ 1 ] * j; col[ i * 3 + 2 ] = rgb[ 2 ] * j;
        i++;
    }
    return { pos, col };
}

function icosphere( detail ) {
    const t = ( 1 + Math.sqrt( 5 ) ) / 2;
    let verts = [
        [ -1, t, 0 ], [ 1, t, 0 ], [ -1, -t, 0 ], [ 1, -t, 0 ], [ 0, -1, t ], [ 0, 1, t ],
        [ 0, -1, -t ], [ 0, 1, -t ], [ t, 0, -1 ], [ t, 0, 1 ], [ -t, 0, -1 ], [ -t, 0, 1 ],
    ].map( ( v ) => { const l = Math.hypot( ...v ); return v.map( ( c ) => c / l ); } );
    let faces = [
        [ 0, 11, 5 ], [ 0, 5, 1 ], [ 0, 1, 7 ], [ 0, 7, 10 ], [ 0, 10, 11 ], [ 1, 5, 9 ], [ 5, 11, 4 ], [ 11, 10, 2 ], [ 10, 7, 6 ], [ 7, 1, 8 ],
        [ 3, 9, 4 ], [ 3, 4, 2 ], [ 3, 2, 6 ], [ 3, 6, 8 ], [ 3, 8, 9 ], [ 4, 9, 5 ], [ 2, 4, 11 ], [ 6, 2, 10 ], [ 8, 6, 7 ], [ 9, 8, 1 ],
    ];
    for ( let d = 0; d < detail; d++ ) {
        const cache = new Map(), next = [];
        const mid = ( a, b ) => {
            const k = a < b ? a * 1e6 + b : b * 1e6 + a;
            if ( cache.has( k ) ) return cache.get( k );
            const m = verts[ a ].map( ( c, i ) => c + verts[ b ][ i ] ), l = Math.hypot( ...m );
            verts.push( m.map( ( c ) => c / l ) );
            cache.set( k, verts.length - 1 );
            return verts.length - 1;
        };
        for ( const [ a, b, c ] of faces ) {
            const ab = mid( a, b ), bc = mid( b, c ), ca = mid( c, a );
            next.push( [ a, ab, ca ], [ b, bc, ab ], [ c, ca, bc ], [ ab, bc, ca ] );
        }
        faces = next;
    }
    return { verts, faces };
}

function body( { kind, radius, detail, seed } ) {
    const k = KINDS[ kind ], { verts, faces } = icosphere( detail );
    const pos = new Float32Array( verts.length * 3 ), col = new Uint8Array( verts.length * 3 );
    const octaves = detail >= 6 ? 6 : 5;
    verts.forEach( ( v, i ) => {
        const { r, rgb } = surfaceAt( kind, k, v, seed, radius, octaves );
        pos[ i * 3 ] = v[ 0 ] * r; pos[ i * 3 + 1 ] = v[ 1 ] * r; pos[ i * 3 + 2 ] = v[ 2 ] * r;
        const j = 0.96 + hash3( i, detail, 0, seed ) * 0.08;
        col[ i * 3 ] = rgb[ 0 ] * j; col[ i * 3 + 1 ] = rgb[ 1 ] * j; col[ i * 3 + 2 ] = rgb[ 2 ] * j;
    } );
    const idx = new Uint32Array( faces.length * 3 );
    faces.forEach( ( f, i ) => idx.set( f, i * 3 ) );
    return { pos, col, idx };
}

function patch( { kind, radius, seed, center, ang, n } ) {
    const k = KINDS[ kind ];
    const c = center, len = Math.hypot( ...c );
    const cn = c.map( ( x ) => x / len );
    const ref = Math.abs( cn[ 1 ] ) < 0.9 ? [ 0, 1, 0 ] : [ 1, 0, 0 ];
    const u = [ cn[ 1 ] * ref[ 2 ] - cn[ 2 ] * ref[ 1 ], cn[ 2 ] * ref[ 0 ] - cn[ 0 ] * ref[ 2 ], cn[ 0 ] * ref[ 1 ] - cn[ 1 ] * ref[ 0 ] ];
    const ul = Math.hypot( ...u ); u.forEach( ( x, i ) => u[ i ] = x / ul );
    const w = [ cn[ 1 ] * u[ 2 ] - cn[ 2 ] * u[ 1 ], cn[ 2 ] * u[ 0 ] - cn[ 0 ] * u[ 2 ], cn[ 0 ] * u[ 1 ] - cn[ 1 ] * u[ 0 ] ];
    const pos = new Float32Array( n * n * 3 ), col = new Uint8Array( n * n * 3 );
    const t = Math.tan( ang ), skirt = radius * ang * 0.08;
    let i = 0;
    for ( let gy = 0; gy < n; gy++ ) for ( let gx = 0; gx < n; gx++ ) {
        const a = ( gx / ( n - 1 ) * 2 - 1 ) * t, b = ( gy / ( n - 1 ) * 2 - 1 ) * t;
        const d = [ cn[ 0 ] + u[ 0 ] * a + w[ 0 ] * b, cn[ 1 ] + u[ 1 ] * a + w[ 1 ] * b, cn[ 2 ] + u[ 2 ] * a + w[ 2 ] * b ];
        const dl = Math.hypot( ...d ); d.forEach( ( x, j ) => d[ j ] = x / dl );
        const { r, rgb } = surfaceAt( kind, k, d, seed, radius, 8 );
        const rim = ( gx === 0 || gy === 0 || gx === n - 1 || gy === n - 1 ) ? skirt : -0.4;
        const rr = r - rim;
        pos[ i * 3 ] = d[ 0 ] * rr; pos[ i * 3 + 1 ] = d[ 1 ] * rr; pos[ i * 3 + 2 ] = d[ 2 ] * rr;
        const j = 0.95 + hash3( gx, gy, Math.round( ang * 1000 ), seed ) * 0.1;
        col[ i * 3 ] = rgb[ 0 ] * j; col[ i * 3 + 1 ] = rgb[ 1 ] * j; col[ i * 3 + 2 ] = rgb[ 2 ] * j;
        i++;
    }
    const idx = new Uint32Array( ( n - 1 ) * ( n - 1 ) * 6 );
    let q = 0;
    for ( let gy = 0; gy < n - 1; gy++ ) for ( let gx = 0; gx < n - 1; gx++ ) {
        const a0 = gy * n + gx, b0 = a0 + 1, c0 = a0 + n, d0 = c0 + 1;
        idx.set( [ a0, b0, c0, b0, d0, c0 ], q ); q += 6;
    }
    return { pos, col, idx };
}

function rock( { size, seed } ) {
    const n = size, c = ( n - 1 ) / 2;
    const ax = 0.6 + hash2( seed, 1, 5 ) * 0.4, ay = 0.5 + hash2( seed, 2, 5 ) * 0.5, az = 0.6 + hash2( seed, 3, 5 ) * 0.4;
    const vol = new Uint8Array( n * n * n );
    for ( let x = 0; x < n; x++ ) for ( let y = 0; y < n; y++ ) for ( let z = 0; z < n; z++ ) {
        const dx = ( x - c ) / ( c * ax ), dy = ( y - c ) / ( c * ay ), dz = ( z - c ) / ( c * az );
        const d = Math.sqrt( dx * dx + dy * dy + dz * dz ) + fbm3( x / 5, y / 5, z / 5, seed, 3 ) * 0.45;
        vol[ ( x * n + y ) * n + z ] = d < 0.95 ? 1 : 0;
    }
    const base = [ [ 0x8a, 0x84, 0x7a ], [ 0x6e, 0x66, 0x5e ], [ 0x9c, 0x8c, 0x78 ] ][ seed % 3 ];
    const m = meshVolume( n, n, n, ( x, y, z ) => {
        if ( ! vol[ ( x * n + y ) * n + z ] ) return null;
        const j = 0.85 + hash3( x, y, z, seed ) * 0.3;
        return [ base[ 0 ] * j, base[ 1 ] * j, base[ 2 ] * j ];
    } );
    return m;
}

function ship( { seed } ) {
    const L = 18, W = 9, H = 5, half = Math.ceil( W / 2 );
    const hull = [ [ 0xd8, 0xd4, 0xca ], [ 0x4a, 0x4e, 0x58 ], [ 0xb8, 0xa8, 0x8a ] ][ seed % 3 ];
    const accent = [ [ 0xc8, 0x40, 0x2e ], [ 0x2d, 0x4e, 0x80 ], [ 0xe0, 0xa0, 0x30 ] ][ ( seed >> 2 ) % 3 ];
    const grid = new Uint8Array( L * W * H );
    const at = ( x, y, z ) => grid[ ( z * W + x ) * H + y ];
    for ( let z = 0; z < L; z++ ) {
        const taper = 1 - Math.pow( Math.abs( z / ( L - 1 ) - 0.4 ) / 0.6, 1.6 );
        const w = Math.max( 1, Math.round( half * ( 0.35 + 0.65 * taper ) + ( hash2( z, 1, seed ) - 0.5 ) * 1.5 ) );
        const h = Math.max( 1, Math.round( H * ( 0.3 + 0.6 * taper ) ) );
        for ( let x = 0; x < w; x++ ) for ( let y = 0; y < h; y++ ) {
            const hole = hash3( x, y, z, seed ) < 0.08;
            if ( hole ) continue;
            let kind = 1;
            if ( y === h - 1 && z > L * 0.55 && z < L * 0.75 && x < 2 ) kind = 2;
            if ( z === 0 && y < 2 && x < 2 ) kind = 3;
            if ( ( z === 2 || z === 3 ) && x === w - 1 ) kind = 4;
            grid[ ( z * W + ( half - 1 + x ) ) * H + y ] = kind;
            grid[ ( z * W + ( half - 1 - x ) ) * H + y ] = kind;
        }
    }
    const colors = { 1: hull, 2: [ 0x1a, 0x24, 0x34 ], 3: [ 0xff, 0x9a, 0x3a ], 4: accent };
    return meshVolume( W, H, L, ( x, y, z ) => {
        const k = at( x, y, z );
        if ( ! k ) return null;
        const j = 0.9 + hash3( x, y, z, seed + 1 ) * 0.2;
        return colors[ k ].map( ( c ) => c * j );
    } );
}

const buffersOf = ( o ) => Object.values( o ).filter( ( v ) => ArrayBuffer.isView( v ) ).map( ( v ) => v.buffer );

self.onmessage = ( { data } ) => {
    const { type } = data;
    if ( type === 'tile' ) { const t = tile( data ); return self.postMessage( { ...data, ...t }, buffersOf( t ) ); }
    if ( type === 'body' ) { const b = body( data ); return self.postMessage( { ...data, ...b }, buffersOf( b ) ); }
    if ( type === 'patch' ) { const b = patch( data ); return self.postMessage( { ...data, ...b }, buffersOf( b ) ); }
    if ( type === 'rock' ) { const r = rock( data ); return self.postMessage( { ...data, ...r }, buffersOf( r ) ); }
    if ( type === 'ship' ) { const r = ship( data ); return self.postMessage( { ...data, ...r }, buffersOf( r ) ); }
    const { cx, cz, seed } = data;
    const { vol, cols } = generate( cx, cz, seed );
    const { solid, water } = mesh( vol, cx, cz, seed );
    const { blocks, biomes } = inner( vol, cols );
    self.postMessage( { ...data, solid, water, blocks, biomes }, [ ...buffersOf( solid ), ...buffersOf( water ), blocks.buffer, biomes.buffer ] );
};
