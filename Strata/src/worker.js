import { fbm, ridged, hash2, fbm3, hash3 } from './noise.js';
import { KINDS, surfaceAt, octavesFor, reliefOf } from './planet.js';
import { AIR, STONE, DIRT, GRASS, SAND, WATER, SNOW, LOG, LEAF, NEEDLE, GRAVEL, TUNDRA, CLAY, ICE, BASALT, LAVA, RUST, CLOUD,
    PLATE, PANEL, FLOOR, GLASS, LIGHT, CORE, DOOR, CHUNK, HEIGHT, SEA, PALETTE, isSolid, isLiquid, isOpaque, spawnOf } from './blocks.js';

const PAD = 3, P = CHUNK + PAD * 2;

const smooth = ( a, b, x ) => {
    const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
    return t * t * ( 3 - 2 * t );
};

let originSeed = null, originC = 0, originSpawn = { x: 0, z: 0 };

const continent = ( x, z, seed ) => fbm( x / 1500, z / 1500, seed, 4 ) * 0.7 + fbm( x / 520 + 9, z / 520, seed + 1, 3 ) * 0.3;

function column( x, z, seed ) {
    if ( originSeed !== seed ) { originSeed = seed; originSpawn = spawnOf( seed ); originC = continent( originSpawn.x, originSpawn.z, seed ); }
    const edge = smooth( 90000, 140000, Math.hypot( x - originSpawn.x, z - originSpawn.z ) );
    const c = continent( x, z, seed ) - originC + 0.05 - edge * 2;
    const m = ridged( x / 230, z / 230, seed + 7, 5 );
    const d = fbm( x / 38, z / 38, seed + 13, 3 );
    const land = smooth( 0.02, 0.3, c );
    let h = Math.round( SEA + 1 + c * 46 + m * m * m * 64 * land + d * 3 );
    // Rivers: the zero crossings of a slow noise, cut down below the sea where the land is low enough to
    // reach it, with banks tapering over a second band width, so the sea fills them and they wind to the coast.
    const rv = Math.abs( fbm( x / 900 + 5, z / 900, seed + 53, 3 ) ), RW = 0.008;
    if ( rv < RW * 2.2 && h > SEA - 2 && h < SEA + 34 ) {
        const t = rv < RW ? 1 : 1 - ( rv - RW ) / ( RW * 1.2 ), ease = t * t * ( 3 - 2 * t );
        h = Math.round( h + ( SEA - 3 - h ) * ease );
    }
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
        case 0: return depth === 0 ? ( hash2( x, z, seed + 3 ) < 0.5 ? GRAVEL : SAND ) : STONE;
        case 1: return SAND;
        case 2: return depth === 0 ? GRASS : DIRT;
        case 3: return depth === 0 ? GRASS : DIRT;
        case 4: return depth < 2 ? SAND : CLAY;
        case 5: return depth === 0 ? TUNDRA : DIRT;
        case 6: return depth === 0 ? TUNDRA : DIRT;
        case 7: return depth === 0 && hash2( x, z, seed + 5 ) < 0.25 ? TUNDRA : STONE;
        case 8: return depth === 0 ? SNOW : STONE;
        case 9: return depth === 0 ? ( hash2( x, z, seed + 7 ) < 0.3 ? RUST : BASALT ) : BASALT;
        case 10: return depth === 0 ? SNOW : ICE;
        case 11: return BASALT;
        case 12: return ICE;
        case 13: return CLOUD;
        case 15: return depth === 0 && hash2( x, z, seed + 8 ) < 0.35 ? GRAVEL : STONE;
    }
    return STONE;
}

const BASE = 110;

function planetColumn( t ) {
    const k = KINDS[ t.planet ];
    const seaR = k.sea ? t.radius + k.seaLevel * reliefOf( k, t.radius ) : -1;
    const { up, u, w } = t;
    return ( x, z ) => {
        const d = [ up[ 0 ] * t.radius + u[ 0 ] * x + w[ 0 ] * z, up[ 1 ] * t.radius + u[ 1 ] * x + w[ 1 ] * z, up[ 2 ] * t.radius + u[ 2 ] * x + w[ 2 ] * z ];
        const dl = Math.hypot( ...d ); d[ 0 ] /= dl; d[ 1 ] /= dl; d[ 2 ] /= dl;
        const { r, biome, e } = surfaceAt( t.planet, k, d, t.seed, t.radius, octavesFor( t.radius, 8 ) );
        const cosA = d[ 0 ] * up[ 0 ] + d[ 1 ] * up[ 1 ] + d[ 2 ] * up[ 2 ];
        const sea = seaR > 0 ? Math.round( cosA * seaR - t.zero ) : -1;
        const wet = seaR > 0 && e < k.seaLevel;
        const floor = wet ? Math.max( seaR - 14, t.radius + e * reliefOf( k, t.radius ) ) : r;
        let h = Math.round( cosA * floor - t.zero );
        if ( wet ) h = Math.min( h, sea - 2 );
        h = Math.max( 1, Math.min( HEIGHT - 12, h ) );
        return { h, biome, sea, liquid: t.planet === 'ember' ? LAVA : t.planet === 'icy' ? ICE : WATER };
    };
}

const DENSITY = [ 0, 0, 0.007, 0.08, 0, 0.001, 0.05, 0.012, 0, 0, 0, 0, 0, 0, 0, 0 ];

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

function generate( cx, cz, seed, terrain ) {
    const vol = new Uint8Array( P * P * HEIGHT );
    const cols = new Array( P * P );
    const ox = cx * CHUNK - PAD, oz = cz * CHUNK - PAD;
    if ( terrain && terrain.interior ) {
        const lay = interiorLayout( terrain );
        for ( let px = 0; px < P; px++ ) for ( let pz = 0; pz < P; pz++ ) {
            const base = ( px * P + pz ) * HEIGHT;
            cols[ px * P + pz ] = { h: 1, biome: 14, sea: -1 };
            for ( let y = 0; y <= lay.H; y++ ) vol[ base + y ] = lay.blockAt( ox + px, y, oz + pz );
        }
        return { vol, cols };
    }
    const colAt = terrain && terrain.planet ? planetColumn( terrain ) : ( x, z, sd ) => ( { ...column( x, z, sd ), sea: SEA, liquid: WATER } );
    for ( let px = 0; px < P; px++ ) for ( let pz = 0; pz < P; pz++ ) {
        const x = ox + px, z = oz + pz;
        const col = colAt( x, z, seed );
        cols[ px * P + pz ] = col;
        const base = ( px * P + pz ) * HEIGHT;
        for ( let y = 0; y <= col.h; y++ ) vol[ base + y ] = surface( col.biome, col.h - y, x, z, seed );
        for ( let y = col.h + 1; y <= Math.min( col.sea, HEIGHT - 1 ); y++ ) vol[ base + y ] = col.liquid;
    }
    const organic = ! terrain || ! terrain.planet || KINDS[ terrain.planet ].atmosphere;
    if ( organic ) for ( let px = 0; px < P; px++ ) for ( let pz = 0; pz < P; pz++ ) {
        const col = cols[ px * P + pz ], x = ox + px, z = oz + pz;
        if ( col.h > col.sea + 1 && hash2( x, z, seed + 99 ) < DENSITY[ col.biome ] ) stampTree( vol, px, pz, col.h, col.biome, x, z, seed );
    }
    stampRuins( vol, cols, cx, cz, seed );
    return { vol, cols };
}

// Ruins, sparse and seeded, on any solid ground: cairns on high or bare ground (a stone ring and a stack),
// monoliths (a basalt pillar, one or two blocks square, nine to fourteen tall) and crashed hulls (a plate-and-
// panel wreck seven long, half sunk, torn open) once in a few hundred chunks. Blocks only go into air.
function stampRuins( vol, cols, cx, cz, seed ) {
    const ox = cx * CHUNK - PAD, oz = cz * CHUNK - PAD;
    const set = ( px, y, pz, b ) => {
        if ( px < 0 || pz < 0 || px >= P || pz >= P || y < 0 || y >= HEIGHT ) return;
        const i = ( px * P + pz ) * HEIGHT + y;
        if ( vol[ i ] === AIR ) vol[ i ] = b;
    };
    const land = ( px, pz ) => { const c = cols[ px * P + pz ]; return c && c.h > c.sea + 1 && c.biome !== 14 ? c : null; };
    for ( let px = PAD; px < P - PAD; px++ ) for ( let pz = PAD; pz < P - PAD; pz++ ) {
        const col = land( px, pz );
        if ( ! col ) continue;
        const x = ox + px, z = oz + pz, r = hash2( x, z, seed + 301 );
        if ( r < 0.00012 && ( col.biome === 5 || col.biome === 6 || col.biome === 7 || col.biome === 15 || col.biome === 9 ) ) {
            const h = col.h, n = 2 + Math.floor( hash2( x, z, seed + 302 ) * 3 );
            for ( let dx = -1; dx <= 1; dx++ ) for ( let dz = -1; dz <= 1; dz++ ) if ( ( dx || dz ) && hash2( x + dx, z + dz, seed + 303 ) < 0.7 ) set( px + dx, h + 1, pz + dz, hash2( x + dx, z + dz, seed + 304 ) < 0.5 ? STONE : GRAVEL );
            for ( let y = 1; y <= n; y++ ) set( px, h + y, pz, STONE );
        } else if ( r > 0.99997 ) {
            const h = col.h, tall = 9 + Math.floor( hash2( x, z, seed + 305 ) * 6 ), wide = hash2( x, z, seed + 306 ) < 0.4 ? 2 : 1;
            for ( let dx = 0; dx < wide; dx++ ) for ( let dz = 0; dz < wide; dz++ ) for ( let y = -2; y <= tall; y++ ) set( px + dx, h + y, pz + dz, BASALT );
        }
    }
    // One hull per chunk at most, and rarely: centred, so its seven blocks stay inside the padding.
    if ( hash2( cx, cz, seed + 310 ) < 0.004 ) {
        const px = PAD + Math.floor( CHUNK / 2 ), pz = PAD + Math.floor( CHUNK / 2 ), col = land( px, pz );
        if ( col ) {
            const along = hash2( cx, cz, seed + 311 ) < 0.5, h = col.h - 1, hs = seed + cx * 7 + cz * 13;
            for ( let a = -3; a <= 3; a++ ) for ( let t = -1; t <= 1; t++ ) for ( let y = 0; y <= 2; y++ ) {
                const edge = Math.abs( t ) === 1 || y === 0 || y === 2 || Math.abs( a ) === 3;
                if ( ! edge ) continue;
                if ( hash3( a, y, t, hs ) < ( a > 1 ? 0.45 : 0.12 ) ) continue;
                const dx = along ? a : t, dz = along ? t : a, lift = Math.round( ( a + 3 ) * 0.35 );
                set( px + dx, h + y + lift, pz + dz, hash3( a, y, t, hs + 1 ) < 0.3 ? PANEL : PLATE );
            }
        }
    }
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
    // A face of block (x,y,z) on side d, spanning w blocks along d.u and h along d.v.
    quad( x, y, z, d, rgb, ao, w = 1, h = 1 ) {
        const { n, u, v } = d;
        const cx = x + 0.5 + n[ 0 ] * 0.5 + ( u[ 0 ] * ( w - 1 ) + v[ 0 ] * ( h - 1 ) ) * 0.5;
        const cy = y + 0.5 + n[ 1 ] * 0.5 + ( u[ 1 ] * ( w - 1 ) + v[ 1 ] * ( h - 1 ) ) * 0.5;
        const cz = z + 0.5 + n[ 2 ] * 0.5 + ( u[ 2 ] * ( w - 1 ) + v[ 2 ] * ( h - 1 ) ) * 0.5;
        const corners = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ];
        for ( let i = 0; i < 4; i++ ) {
            const [ a, b ] = corners[ i ];
            this.pos.push( cx + ( u[ 0 ] * a * w + v[ 0 ] * b * h ) * 0.5, cy + ( u[ 1 ] * a * w + v[ 1 ] * b * h ) * 0.5, cz + ( u[ 2 ] * a * w + v[ 2 ] * b * h ) * 0.5 );
            this.nrm.push( n[ 0 ], n[ 1 ], n[ 2 ] );
            const f = AO[ ao[ i ] ];
            this.col.push( Math.min( 255, rgb[ 0 ] * f ), Math.min( 255, rgb[ 1 ] * f ), Math.min( 255, rgb[ 2 ] * f ) );
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

// Greedy mesher: per side and slice, faces with the same colour and an AO pattern constant along the
// merge axis are joined into one quad. Per-block tone jitter lives in the shader so flats can merge.
function mesh( vol, cx, cz, seed ) {
    const solid = new Builder(), water = new Builder();
    const at = ( x, y, z ) => ( y < 0 || y >= HEIGHT ) ? AIR : vol[ ( ( x + PAD ) * P + z + PAD ) * HEIGHT + y ];
    const occ = ( x, y, z ) => isOpaque( at( x, y, z ) ) ? 1 : 0;
    let yMax = 0;
    for ( let i = 0; i < vol.length; i++ ) if ( vol[ i ] ) { const y = i % HEIGHT; if ( y > yMax ) yMax = y; }
    const size = [ CHUNK, Math.min( HEIGHT, yMax + 2 ), CHUNK ];
    const corners = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ];
    const p = [ 0, 0, 0 ];
    for ( const d of DIRS ) {
        const axis = d.n.findIndex( ( c ) => c !== 0 ), ua = d.u.findIndex( ( c ) => c !== 0 ), va = d.v.findIndex( ( c ) => c !== 0 );
        const W = size[ ua ], H = size[ va ], cells = new Array( W * H );
        for ( let s = 0; s < size[ axis ]; s++ ) {
            cells.fill( null );
            for ( let a = 0; a < W; a++ ) for ( let b = 0; b < H; b++ ) {
                p[ axis ] = s; p[ ua ] = a; p[ va ] = b;
                const [ x, y, z ] = p, blk = at( x, y, z );
                if ( blk === AIR ) continue;
                const nx = x + d.n[ 0 ], ny = y + d.n[ 1 ], nz = z + d.n[ 2 ], nb = at( nx, ny, nz );
                let face = null;
                if ( isLiquid( blk ) ) {
                    if ( d.n[ 1 ] === 1 && nb === AIR ) face = { to: water, rgb: PALETTE[ blk ], ao: 255, dy: -0.15, mu: true, mv: true };
                } else if ( blk === GLASS ) {
                    if ( nb === AIR ) face = { to: water, rgb: PALETTE[ GLASS ].map( ( c ) => c * d.shade ), ao: 255, dy: 0, mu: true, mv: true };
                } else if ( ! isOpaque( nb ) ) {
                    const src = ( d.n[ 1 ] === 0 && ( blk === GRASS || blk === TUNDRA ) ) ? DIRT : blk, base = PALETTE[ src ];
                    const ao = [ 0, 0, 0, 0 ];
                    for ( let i = 0; i < 4; i++ ) {
                        const [ ca, cb ] = corners[ i ];
                        const s1 = occ( nx + d.u[ 0 ] * ca, ny + d.u[ 1 ] * ca, nz + d.u[ 2 ] * ca );
                        const s2 = occ( nx + d.v[ 0 ] * cb, ny + d.v[ 1 ] * cb, nz + d.v[ 2 ] * cb );
                        const cc = occ( nx + d.u[ 0 ] * ca + d.v[ 0 ] * cb, ny + d.u[ 1 ] * ca + d.v[ 1 ] * cb, nz + d.u[ 2 ] * ca + d.v[ 2 ] * cb );
                        ao[ i ] = s1 && s2 ? 0 : 3 - ( s1 + s2 + cc );
                    }
                    face = { to: solid, rgb: [ base[ 0 ] * d.shade, base[ 1 ] * d.shade, base[ 2 ] * d.shade ], ao: ao[ 0 ] | ao[ 1 ] << 2 | ao[ 2 ] << 4 | ao[ 3 ] << 6, aov: ao, dy: 0,
                        mu: ao[ 0 ] === ao[ 1 ] && ao[ 3 ] === ao[ 2 ], mv: ao[ 0 ] === ao[ 3 ] && ao[ 1 ] === ao[ 2 ] };
                }
                if ( face ) { face.key = ( ( src8( face.rgb[ 0 ] ) * 256 + src8( face.rgb[ 1 ] ) ) * 256 + src8( face.rgb[ 2 ] ) ) * 256 + face.ao + ( face.to === water ? 1e10 : 0 ); cells[ a * H + b ] = face; }
            }
            for ( let a = 0; a < W; a++ ) for ( let b = 0; b < H; b++ ) {
                const f = cells[ a * H + b ];
                if ( ! f ) continue;
                let w = 1, h = 1;
                while ( f.mu && a + w < W && cells[ ( a + w ) * H + b ] && cells[ ( a + w ) * H + b ].key === f.key ) w++;
                if ( f.mv ) outer: for ( ; b + h < H; h++ ) for ( let i = 0; i < w; i++ ) { const g = cells[ ( a + i ) * H + b + h ]; if ( ! g || g.key !== f.key ) break outer; }
                for ( let i = 0; i < w; i++ ) for ( let j = 0; j < h; j++ ) cells[ ( a + i ) * H + b + j ] = null;
                p[ axis ] = s; p[ ua ] = a; p[ va ] = b;
                f.to.quad( p[ 0 ], p[ 1 ] + f.dy, p[ 2 ], d, f.rgb, f.aov || [ 3, 3, 3, 3 ], w, h );
            }
        }
    }
    return { solid: solid.pack(), water: water.pack() };
}

const src8 = ( c ) => Math.min( 255, Math.round( c ) );

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

// Heightfield tile. On the home world a flat grid; with `terrain` (a planet) the grid is gnomonic in the
// tangent frame (up, u, w) but vertices are exact body-local sphere points, so tiles overlay the smooth sphere.
function tile( { x0, z0, size, step, seed, terrain } ) {
    const n = size / step + 1;
    const pos = new Float32Array( n * n * 3 ), col = new Uint8Array( n * n * 3 );
    const k = terrain ? KINDS[ terrain.planet ] : null, oct = terrain ? octavesFor( terrain.radius, 8 ) : 0;
    const seaR = k && k.sea ? terrain.radius + k.seaLevel * reliefOf( k, terrain.radius ) : -1;
    let i = 0;
    for ( let gz = 0; gz < n; gz++ ) for ( let gx = 0; gx < n; gx++ ) {
        const x = x0 + gx * step, z = z0 + gz * step;
        let c, wet, bedDepth, liquid = WATER;
        if ( terrain ) {
            const { up, u, w, radius } = terrain;
            const d = [ up[ 0 ] * radius + u[ 0 ] * x + w[ 0 ] * z, up[ 1 ] * radius + u[ 1 ] * x + w[ 1 ] * z, up[ 2 ] * radius + u[ 2 ] * x + w[ 2 ] * z ];
            const dl = Math.hypot( ...d ); d[ 0 ] /= dl; d[ 1 ] /= dl; d[ 2 ] /= dl;
            const { r, biome, e } = surfaceAt( terrain.planet, k, d, seed, radius, oct );
            wet = seaR > 0 && e < k.seaLevel;
            const rr = wet ? seaR : r;
            bedDepth = wet ? seaR - Math.max( seaR - 14, radius + e * reliefOf( k, radius ) ) : 0;
            pos[ i * 3 ] = d[ 0 ] * rr; pos[ i * 3 + 1 ] = d[ 1 ] * rr; pos[ i * 3 + 2 ] = d[ 2 ] * rr;
            c = { biome };
            liquid = terrain.planet === 'ember' ? LAVA : terrain.planet === 'icy' ? ICE : WATER;
        } else {
            c = column( x, z, seed );
            wet = c.h <= SEA;
            bedDepth = SEA - c.h;
            pos[ i * 3 ] = gx * step; pos[ i * 3 + 1 ] = ( wet ? SEA : c.h ) - 1; pos[ i * 3 + 2 ] = gz * step;
        }
        let rgb = PALETTE[ wet ? liquid : surface( c.biome, 0, x, z, seed ) ];
        if ( ! wet && ( c.biome === 3 || c.biome === 6 ) ) rgb = PALETTE[ c.biome === 3 ? LEAF : NEEDLE ];
        if ( wet && liquid !== ICE ) { const bed = PALETTE[ bedDepth > 6 ? GRAVEL : SAND ], kk = bedDepth > 3 ? 0.1 : 0.16; rgb = rgb.map( ( v, j ) => v * ( 1 - kk ) + bed[ j ] * kk ); }
        const j = ( wet ? 1 : 0.9 ) * ( 0.95 + hash2( x, z, seed + 17 ) * 0.1 );
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
    const octaves = octavesFor( radius, detail >= 6 ? 6 : 5 );
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
        const { r, rgb } = surfaceAt( kind, k, d, seed, radius, octavesFor( radius, 8 ) );
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

function rock( { size, seed, color } ) {
    const n = size, c = ( n - 1 ) / 2;
    const ax = 0.6 + hash2( seed, 1, 5 ) * 0.4, ay = 0.5 + hash2( seed, 2, 5 ) * 0.5, az = 0.6 + hash2( seed, 3, 5 ) * 0.4;
    const vol = new Uint8Array( n * n * n );
    for ( let x = 0; x < n; x++ ) for ( let y = 0; y < n; y++ ) for ( let z = 0; z < n; z++ ) {
        const dx = ( x - c ) / ( c * ax ), dy = ( y - c ) / ( c * ay ), dz = ( z - c ) / ( c * az );
        const d = Math.sqrt( dx * dx + dy * dy + dz * dz ) + fbm3( x / 5, y / 5, z / 5, seed, 3 ) * 0.45;
        vol[ ( x * n + y ) * n + z ] = d < 0.95 ? 1 : 0;
    }
    const base = color || [ [ 0x8a, 0x84, 0x7a ], [ 0x6e, 0x66, 0x5e ], [ 0x9c, 0x8c, 0x78 ] ][ seed % 3 ];
    const m = meshVolume( n, n, n, ( x, y, z ) => {
        if ( ! vol[ ( x * n + y ) * n + z ] ) return null;
        const j = 0.85 + hash3( x, y, z, seed ) * 0.3;
        return [ base[ 0 ] * j, base[ 1 ] * j, base[ 2 ] * j ];
    } );
    return { ...m, vol };
}

const INTERIOR = {
    small:   { W: 14, H: 4, L: 40 },
    medium:  { W: 24, H: 5, L: 80 },
    capital: { W: 40, H: 6, L: 150 },
    station: { R: 90, H: 5 },
};

function interiorLayout( t ) {
    const seed = t.seed, r = ( i, j ) => hash2( i, j, seed );
    if ( t.cls === 'station' ) {
        const { R, H } = INTERIOR.station, hub = 16, segs = 10 + Math.floor( r( 1, 1 ) * 6 ), spokes = 3 + Math.floor( r( 2, 1 ) * 3 );
        return { H, blockAt: ( x, y, z ) => {
            const rad = Math.hypot( x, z ), a = Math.atan2( z, x );
            const seg = ( ( a / ( Math.PI * 2 ) * segs ) % 1 + 1 ) % 1, segI = Math.floor( ( a / ( Math.PI * 2 ) + 1 ) * segs ) % segs;
            const spoke = ( () => { for ( let i = 0; i < spokes; i++ ) { const sa = i / spokes * Math.PI * 2; const t2 = Math.abs( x * Math.sin( sa ) - z * Math.cos( sa ) ), along = x * Math.cos( sa ) + z * Math.sin( sa ); if ( along > 0 && t2 < 4 && along < R ) return t2; } return 9; } )();
            const inHub = rad < hub + 2, inRing = rad > R - 5 && rad < R + 14, inSpoke = spoke < 4;
            if ( ! inHub && ! inRing && ! inSpoke ) return AIR;
            if ( y === 0 ) return FLOOR;
            if ( y >= H ) return ( inRing && rad > R - 3 && rad < R + 3 && Math.floor( a * R ) % 7 === 0 ) ? LIGHT : PLATE;
            if ( inHub ) {
                if ( rad > hub ) return y === 2 && Math.floor( a * 10 ) % 2 ? GLASS : PLATE;
                if ( x >= 0 && x < 1 && z >= 0 && z < 1 ) return y <= 2 ? DOOR : AIR;
                if ( rad > 4 && rad < 5.2 && y < 3 && Math.abs( Math.sin( a * 2 ) ) > 0.75 ) return CORE;
                return ( rad > 8 && rad < 9 && Math.floor( a * 3 ) % 2 && y < 2 ) ? PANEL : AIR;
            }
            if ( inSpoke && rad < R - 3 ) return spoke > 2 ? ( y === 2 && Math.floor( rad ) % 6 === 0 ? GLASS : PLATE ) : AIR;
            if ( rad >= R - 3 && rad <= R + 3 ) return AIR;
            if ( rad < R - 3 ) return PLATE;
            if ( rad > R + 12 ) return ( y === 2 || y === 3 ) && ( segI % 2 === 0 ) ? GLASS : PLATE;
            const wall = seg < 0.5 / segs || seg > 1 - 0.5 / segs;
            if ( wall ) return PANEL;
            if ( rad > R + 3 && rad < R + 5 ) return Math.abs( seg - 0.5 ) < 0.4 / segs && y < 3 ? AIR : PANEL;
            if ( r( Math.floor( x / 2 ), Math.floor( z / 2 ) ) < 0.05 && y < 2 ) return PANEL;
            return AIR;
        } };
    }
    const { W, H, L } = INTERIOR[ t.cls ], mid = Math.floor( W / 2 ), door = Math.floor( L / 2 );
    const bounds = [];
    for ( let z = 2; z < L - 14; ) { const len = 6 + Math.floor( r( z, 9 ) * 7 ); bounds.push( z + len ); z += len; }
    const isWall = ( z ) => bounds.includes( z );
    return { H, blockAt: ( x, y, z ) => {
        if ( x < 0 || x >= W || z < 0 || z >= L || y > H ) return AIR;
        if ( y === 0 ) return FLOOR;
        if ( y === H ) return ( Math.abs( x - mid ) <= 1 && z % 4 === 0 ) || ( z > L - 14 && z % 5 === 0 && x % 5 === 0 ) ? LIGHT : PLATE;
        if ( z === L - 1 ) return y >= 1 && y <= H - 1 && x > 1 && x < W - 2 ? GLASS : PLATE;
        if ( x === W - 1 && z === door && y <= 2 ) return DOOR;
        if ( x === 0 || x === W - 1 ) return ( y === 2 && z % 6 === 3 && z > 12 ) ? GLASS : PLATE;
        if ( z === 0 ) return PLATE;
        if ( z > L - 14 ) return ( z === L - 14 && Math.abs( x - mid ) > 1 ) ? PANEL : ( z === L - 6 && ( x === mid - 3 || x === mid + 3 ) && y < 2 ? PANEL : AIR );
        if ( Math.abs( x - mid ) <= 1 ) return AIR;
        if ( z < 12 ) {
            if ( z === 11 && Math.abs( x - mid ) > 1 && ! ( Math.abs( x - mid ) === 2 && y < 3 ) ) return PANEL;
            const dx = Math.abs( x - mid ), core = ( x < mid ? mid - 5 : mid + 5 );
            return Math.abs( x - core ) <= 1 && z > 4 && z < 9 && y <= 3 ? CORE : dx === 2 ? AIR : AIR;
        }
        if ( Math.abs( x - mid ) === 2 ) return ( isWall( z ) || isWall( z + 1 ) ) ? PANEL : ( Math.abs( ( z % 9 ) - 4 ) < 1 && y < 3 ? AIR : PANEL );
        if ( isWall( z ) ) return PANEL;
        if ( r( x, z ) < 0.08 && y < 2 ) return PANEL;
        return AIR;
    } };
}

const SHIP_CLASSES = {
    small:   { L: 18, W: 9, H: 5, engines: 1 },
    medium:  { L: 40, W: 17, H: 9, engines: 2 },
    capital: { L: 96, W: 34, H: 18, engines: 4 },
};

function ship( { seed, cls = 'small' } ) {
    const { L, W, H, engines } = SHIP_CLASSES[ cls ], half = Math.ceil( W / 2 );
    const hull = [ [ 0xd8, 0xd4, 0xca ], [ 0x4a, 0x4e, 0x58 ], [ 0xb8, 0xa8, 0x8a ], [ 0x7a, 0x82, 0x8c ] ][ seed % 4 ];
    const accent = [ [ 0xc8, 0x40, 0x2e ], [ 0x2d, 0x4e, 0x80 ], [ 0xe0, 0xa0, 0x30 ], [ 0x3f, 0x7a, 0x5a ] ][ ( seed >> 2 ) % 4 ];
    const grid = new Uint8Array( L * W * H );
    const put = ( x, y, z, k ) => { if ( x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < L ) grid[ ( z * W + x ) * H + y ] = k; };
    const sym = ( dx, y, z, k ) => { put( half - 1 + dx, y, z, k ); put( half - 1 - dx, y, z, k ); };
    const nose = 0.3 + hash2( seed, 2, 3 ) * 0.3, wingAt = 0.45 + hash2( seed, 3, 3 ) * 0.25;
    for ( let z = 0; z < L; z++ ) {
        const f = z / ( L - 1 );
        const taper = 1 - Math.pow( Math.abs( f - nose ) / Math.max( nose, 1 - nose ), 1.5 );
        const w = Math.max( 1, Math.round( half * ( 0.3 + 0.7 * taper ) + ( hash2( z, 1, seed ) - 0.5 ) * ( cls === 'capital' ? 3 : 1.5 ) ) );
        const h = Math.max( 1, Math.round( H * ( 0.3 + 0.6 * taper ) ) );
        const y0 = Math.floor( ( H - h ) / 2 );
        for ( let x = 0; x < w; x++ ) for ( let y = y0; y < y0 + h; y++ ) {
            if ( hash3( x, y, z, seed ) < 0.06 ) continue;
            let kind = 1;
            if ( y === y0 + h - 1 && z > L * 0.5 && z < L * 0.7 && x < Math.max( 1, w * 0.3 ) ) kind = 2;
            if ( ( z === Math.floor( L * 0.2 ) || z === Math.floor( L * 0.21 ) ) && x === w - 1 ) kind = 4;
            sym( x, y, z, kind );
        }
        if ( cls !== 'small' && Math.abs( f - wingAt ) < 0.12 ) {
            const span = Math.round( half * ( 1.6 - Math.abs( f - wingAt ) * 8 ) );
            for ( let x = w; x < span; x++ ) sym( x, Math.floor( H / 2 ), z, x === span - 1 ? 4 : 1 );
        }
    }
    if ( cls === 'capital' ) {
        const bz = Math.floor( L * 0.62 );
        for ( let z = bz; z < bz + 8; z++ ) for ( let y = H - 4; y < H; y++ ) for ( let x = 0; x < 3; x++ ) sym( x, y, z, y === H - 1 ? 2 : 1 );
        for ( let z = Math.floor( L * 0.3 ); z < L * 0.6; z += 6 ) for ( let x = 0; x < half - 2; x += 4 ) sym( x, 1, z, 4 );
    }
    const spread = Math.max( 1, Math.floor( half * 0.5 ) );
    for ( let e = 0; e < engines; e++ ) {
        const ex = engines === 1 ? 0 : Math.round( ( e / ( engines - 1 ) - 0.5 ) * 2 * spread ) ;
        const ey = Math.floor( H / 2 ) + ( engines > 2 && e % 2 ? 2 : -1 );
        for ( let dy = 0; dy < 2; dy++ ) for ( let dx = 0; dx < 2; dx++ ) { put( half - 1 + ex + dx - 1, ey + dy, 0, 3 ); put( half - 1 + ex + dx - 1, ey + dy, 1, 1 ); }
    }
    const colors = { 1: hull, 2: [ 0x1a, 0x24, 0x34 ], 3: [ 0xff, 0x9a, 0x3a ], 4: accent };
    return meshVolume( W, H, L, ( x, y, z ) => {
        const k = grid[ ( z * W + x ) * H + y ];
        if ( ! k ) return null;
        const j = 0.9 + hash3( x, y, z, seed + 1 ) * 0.2;
        return colors[ k ].map( ( c ) => c * j );
    } );
}

function station( { seed, dead } ) {
    const N = 60, H = 26, c = N / 2, cy = H / 2;
    const grid = new Uint8Array( N * H * N );
    const put = ( x, y, z, k ) => { if ( x >= 0 && x < N && y >= 0 && y < H && z >= 0 && z < N ) grid[ ( z * N + x ) * H + y ] = k; };
    const rings = 1 + ( hash2( seed, 1, 9 ) < 0.4 ? 1 : 0 ), spokes = 3 + Math.floor( hash2( seed, 2, 9 ) * 3 );
    const hull = [ [ 0xd4, 0xd2, 0xca ], [ 0xb9, 0xb3, 0xa6 ], [ 0x8e, 0x94, 0x9c ] ][ seed % 3 ];
    for ( let ri = 0; ri < rings; ri++ ) {
        const R = 27 - ri * 9, tube = ri ? 2.6 : 3.6, yoff = ri ? ( hash2( seed, 4, 9 ) - 0.5 ) * 8 : 0;
        for ( let x = 0; x < N; x++ ) for ( let z = 0; z < N; z++ ) {
            const d = Math.hypot( x - c + 0.5, z - c + 0.5 ) - R;
            for ( let y = 0; y < H; y++ ) {
                const dy = y - cy - yoff + 0.5;
                if ( d * d + dy * dy <= tube * tube ) put( x, y, z, hash3( x, y, z, seed + 3 ) < 0.08 ? 3 : 1 );
            }
        }
    }
    for ( let y = 2; y < H - 2; y++ ) for ( let x = 0; x < N; x++ ) for ( let z = 0; z < N; z++ ) {
        const d = Math.hypot( x - c + 0.5, z - c + 0.5 );
        if ( d <= ( y % 7 === 0 ? 7 : 5.5 ) ) put( x, y, z, d > 4.5 && hash3( x, y, z, seed + 5 ) < 0.15 ? 3 : 1 );
    }
    for ( let si = 0; si < spokes; si++ ) {
        const a = si / spokes * Math.PI * 2 + hash2( seed, 6, 9 ) * 1.5;
        for ( let r = 5; r < 27; r++ ) for ( let t = -1; t <= 1; t++ ) {
            const x = Math.round( c + Math.cos( a ) * r + Math.sin( a ) * t ), z = Math.round( c + Math.sin( a ) * r - Math.cos( a ) * t );
            put( x, Math.floor( cy ), z, 1 ); put( x, Math.floor( cy ) - 1, z, 1 );
        }
    }
    const panels = 2 + Math.floor( hash2( seed, 7, 9 ) * 3 );
    for ( let pi = 0; pi < panels; pi++ ) {
        const a = pi / panels * Math.PI * 2 + 0.3, y = Math.floor( cy ) + ( pi % 2 ? 5 : -5 );
        for ( let r = 7; r < 24; r++ ) for ( let t = -3; t <= 3; t++ ) {
            const x = Math.round( c + Math.cos( a ) * r + Math.sin( a ) * t ), z = Math.round( c + Math.sin( a ) * r - Math.cos( a ) * t );
            put( x, y, z, r % 5 === 2 ? 1 : 2 );
        }
    }
    for ( let y = 0; y < H; y++ ) for ( let dx = -1; dx <= 1; dx++ ) for ( let dz = -1; dz <= 1; dz++ ) put( c + dx, y, c + dz, 1 );
    const colors = dead ? { 1: hull.map( ( c0 ) => c0 * 0.45 ), 2: [ 0x1a, 0x1c, 0x22 ], 3: [ 0x3a, 0x30, 0x28 ] } : { 1: hull, 2: [ 0x1e, 0x2c, 0x4a ], 3: [ 0xff, 0xb0, 0x50 ] };
    // A dead station is dark, holed, and missing a wedge of its ring.
    const gone = dead ? hash2( seed, 8, 9 ) * Math.PI * 2 : -1;
    return meshVolume( N, H, N, ( x, y, z ) => {
        const k = grid[ ( z * N + x ) * H + y ];
        if ( ! k ) return null;
        if ( dead ) {
            const a = Math.atan2( z - c + 0.5, x - c + 0.5 ), rr = Math.hypot( x - c + 0.5, z - c + 0.5 );
            if ( rr > 9 && Math.abs( ( ( a - gone + Math.PI * 3 ) % ( Math.PI * 2 ) ) - Math.PI ) < 0.45 ) return null;
            if ( hash3( x, y, z, seed + 12 ) < 0.07 ) return null;
        }
        const j = 0.9 + hash3( x, y, z, seed + 1 ) * 0.2;
        return colors[ k ].map( ( c0 ) => c0 * j );
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
    if ( type === 'station' ) { const r = station( data ); return self.postMessage( { ...data, ...r }, buffersOf( r ) ); }
    const { cx, cz, seed } = data;
    const { vol, cols } = generate( cx, cz, seed, data.terrain );
    const { solid, water } = mesh( vol, cx, cz, seed );
    const { blocks, biomes } = inner( vol, cols );
    self.postMessage( { ...data, solid, water, blocks, biomes }, [ ...buffersOf( solid ), ...buffersOf( water ), blocks.buffer, biomes.buffer ] );
};
