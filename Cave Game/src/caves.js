import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { materials } from "./materials.js";
import { noise3 } from "./noise.js";

// Sections are carved, not assembled. Each one is a signed distance field
// (negative = air) made of tubes running from every opening to the centre,
// a chamber where three or more meet, and noise that pinches and swells the
// passage. Marching cubes turns the field into one inward-facing mesh.
//
// Two rules keep sections connectable: noise fades to zero near any open face,
// so the mouth of a tube at the cell boundary is always the same shape; and a
// thin shell of rock is forced along every closed face, so air never leaks out
// of the cube.

const CELL = 6;
const HALF = CELL / 2;
const RES = 30;
const SHELL = 0.15;
const HUB_Y = 1.5;
const MOUTH = { half: 1.6, down: 1.5, up: 1.9 };   // horizontal mouth: ellipse about HUB_Y
const VMOUTH = 1.3;                                // floor / ceiling mouth radius
const CHAMBER = { y: 2.2, r: 2.3 };
const NOISE_AMP = 1.0;
export const LIQUID_Y = 0.45;
const SILL = { y: 0.8, z: 2.35, w: 0.3 };
const NOISE_FADE = 1.3;
const SMOOTH_K = 0.9;

const DIR = {
    n: [ 0, 0, -1 ], e: [ 1, 0, 0 ], s: [ 0, 0, 1 ], w: [ -1, 0, 0 ],
    up: [ 0, 1, 0 ], down: [ 0, -1, 0 ]
};

const smooth = ( t ) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * ( 3 - 2 * t );

function smin( a, b, k ) {
    const h = Math.max( k - Math.abs( a - b ), 0 ) / k;
    return Math.min( a, b ) - h * h * k * 0.25;
}

// Elliptical tube from the face centre to the hub, as an approximate distance.
function hTube( px, py, pz, d ) {
    const forward = px * d[ 0 ] + pz * d[ 2 ];
    const across = px * -d[ 2 ] + pz * d[ 0 ];
    const along = forward < 0 ? -forward : 0;
    const dy = py - HUB_Y;
    const ry = dy < 0 ? MOUTH.down : MOUTH.up;
    const r = Math.sqrt( ( across / MOUTH.half ) ** 2 + ( dy / ry ) ** 2 );
    const radial = ( r - 1 ) * MOUTH.half;
    return along > 0 ? Math.hypot( Math.max( radial, 0 ), along ) + Math.min( radial, 0 ) : radial;
}

// Round vertical tube from a floor or ceiling mouth to height `toY`.
function vTube( px, py, pz, fromY, toY ) {
    const lo = Math.min( fromY, toY );
    const hi = Math.max( fromY, toY );
    const radial = Math.hypot( px, pz ) - VMOUTH;
    const along = py < lo ? lo - py : py > hi ? py - hi : 0;
    return along > 0 ? Math.hypot( Math.max( radial, 0 ), along ) + Math.min( radial, 0 ) : radial;
}

const sphere = ( px, py, pz, cx, cy, cz, r ) => Math.hypot( px - cx, py - cy, pz - cz ) - r;

function capsule( px, py, pz, ax, ay, az, bx, by, bz, r ) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const t = Math.min( Math.max( ( apx * abx + apy * aby + apz * abz ) / ( abx * abx + aby * aby + abz * abz ), 0 ), 1 );
    return Math.hypot( apx - abx * t, apy - aby * t, apz - abz * t ) - r;
}

// Builds the field function for one section. `basin` is "pool" (liquid held
// inside the cell by a rock sill at each mouth) or "channel" (liquid runs face
// to face so neighbouring channels join).
function carve( open, rand, basin ) {
    const faces = [ ...open ];
    const horizontal = faces.filter( ( f ) => !DIR[ f ][ 1 ] );
    const vertical = faces.filter( ( f ) => DIR[ f ][ 1 ] );
    const chamber = faces.length >= 3 || ( vertical.length && horizontal.length ) || basin === "pool";
    const seed = rand() * 100;
    const tall = open.has( "up" );
    const hub = basin === "pool" ? { y: 1.6, r: 2.45 } : { y: tall ? 2.7 : CHAMBER.y, r: tall ? 2.35 : CHAMBER.r };
    const amp = tall && chamber ? NOISE_AMP * 0.7 : NOISE_AMP;

    const bumps = [];
    const drips = [];
    if ( chamber && !tall ) {
        for ( let i = 0; i < 5; i++ ) {
            const a = rand() * Math.PI * 2;
            const rho = 0.3 + rand() * 1.2;
            drips.push( [ Math.cos( a ) * rho, Math.sin( a ) * rho, 0.1 + rand() * 0.12, 3.3 + rand() * 0.5 ] );
        }
    }
    for ( const f of basin ? [] : horizontal ) {
        const d = DIR[ f ];
        for ( let i = 0; i < 2; i++ ) {
            const t = 0.6 + rand() * 1.2;
            const side = rand() < 0.5 ? -1 : 1;
            bumps.push( [ d[ 0 ] * t + -d[ 2 ] * side * 1.35, 0.05, d[ 2 ] * t + d[ 0 ] * side * 1.35, 0.3 + rand() * 0.3 ] );
        }
    }

    return function ( px, py, pz ) {
        let air = Infinity;

        for ( const f of horizontal ) {
            air = smin( air, hTube( px, py, pz, DIR[ f ] ), SMOOTH_K );
        }
        if ( chamber ) {
            air = smin( air, sphere( px, py, pz, 0, hub.y, 0, hub.r ), SMOOTH_K );
        }
        for ( const f of vertical ) {
            const d = DIR[ f ];
            const toY = chamber ? hub.y : CELL / 2;
            air = smin( air, vTube( px, py, pz, d[ 1 ] > 0 ? CELL : 0, toY ), SMOOTH_K );
        }
        if ( faces.length === 1 ) {
            const d = DIR[ horizontal[ 0 ] ];
            air = smin( air, sphere( px, py, pz, -d[ 0 ] * 0.6, HUB_Y + 0.2, -d[ 2 ] * 0.6, 1.75 ), SMOOTH_K );
        }

        // Erosion, fading out toward any open face so mouths stay fixed.
        let fade = 1;
        for ( const f of faces ) {
            const d = DIR[ f ];
            const dist = HALF - ( px * d[ 0 ] + pz * d[ 2 ] ) - ( d[ 1 ] > 0 ? py - HALF : d[ 1 ] < 0 ? HALF - py : 0 );
            fade = Math.min( fade, smooth( dist / NOISE_FADE ) );
        }
        const n = noise3( px * 0.42 + seed, py * 0.42, pz * 0.42 + seed ) * 0.6
            + noise3( px * 1.1 + seed, py * 1.1, pz * 1.1 ) * 0.3
            + noise3( px * 0.17, py * 0.17 + seed, pz * 0.17 ) * 0.1;
        air += ( n - 0.5 ) * amp * fade;

        // Rubble and drips are rock added back into the air.
        for ( const b of bumps ) {
            air = Math.max( air, -sphere( px, py, pz, b[ 0 ], b[ 1 ], b[ 2 ], b[ 3 ] ) );
        }
        for ( const s of drips ) {
            air = Math.max( air, -capsule( px, py, pz, s[ 0 ], 5.6, s[ 1 ], s[ 0 ], s[ 3 ], s[ 1 ], s[ 2 ] ) );
        }

        // Pool sills: a low rock ridge just inside each mouth holds the liquid in.
        if ( basin === "pool" ) {
            air = Math.max( air, Math.min( SILL.y - py, SILL.w - Math.abs( Math.abs( pz ) - SILL.z ) ) );
        }

        // Shell: rock along every closed face, pierced only by the exact mouth.
        for ( const f of [ "n", "e", "s", "w" ] ) {
            const d = DIR[ f ];
            let shell = SHELL - ( HALF - ( px * d[ 0 ] + pz * d[ 2 ] ) );
            if ( open.has( f ) ) {
                shell = Math.min( shell, hTube( px, py, pz, d ) );
            }
            air = Math.max( air, shell );
        }
        let floor = SHELL - py;
        if ( open.has( "down" ) ) {
            floor = Math.min( floor, vTube( px, py, pz, 0, CELL ) );
        }
        let ceiling = SHELL - ( CELL - py );
        if ( open.has( "up" ) ) {
            ceiling = Math.min( ceiling, vTube( px, py, pz, 0, CELL ) );
        }
        return Math.max( air, floor, ceiling );
    };
}

// One shared polygonizer; each section copies its triangles out.
let mc = null;
const delta = 2 / RES;
const scale = CELL / ( 2 - 3 * delta );
const offset = -HALF + scale * ( 1 - delta );

export function buildCave( group, open, ctx, basin ) {
    if ( !mc ) {
        mc = new MarchingCubes( RES, materials.rock, true, false, 40000 );
        mc.isolation = 0;
    }
    const field = carve( open, ctx.rand, basin );
    const data = mc.field;
    for ( let z = 0; z < RES; z++ ) {
        const wz = ( ( z - RES / 2 ) / ( RES / 2 ) ) * scale + offset;
        for ( let y = 0; y < RES; y++ ) {
            const wy = ( ( y - RES / 2 ) / ( RES / 2 ) ) * scale + offset + HALF;
            for ( let x = 0; x < RES; x++ ) {
                const wx = ( ( x - RES / 2 ) / ( RES / 2 ) ) * scale + offset;
                data[ z * RES * RES + y * RES + x ] = field( wx, wy, wz );
            }
        }
    }
    mc.normal_cache.fill( 0 );
    mc.update();

    const count = mc.count;
    const geo = new THREE.BufferGeometry();
    const pos = mc.positionArray.slice( 0, count * 3 );
    for ( let i = 0; i < pos.length; i++ ) {
        pos[ i ] = pos[ i ] * scale + offset + ( i % 3 === 1 ? HALF : 0 );
    }
    geo.setAttribute( "position", new THREE.BufferAttribute( pos, 3 ) );
    geo.setAttribute( "normal", new THREE.BufferAttribute( mc.normalArray.slice( 0, count * 3 ), 3 ) );
    const uv = new Float32Array( count * 2 );
    for ( let i = 0; i < count; i++ ) {
        uv[ i * 2 ] = ( pos[ i * 3 ] + pos[ i * 3 + 2 ] ) / 3;
        uv[ i * 2 + 1 ] = pos[ i * 3 + 1 ] / 3;
    }
    geo.setAttribute( "uv", new THREE.BufferAttribute( uv, 2 ) );

    const mesh = new THREE.Mesh( geo, materials.rock );
    group.add( mesh );
    return field;
}

// Flat liquid surface at LIQUID_Y, trimmed to the air of the field so it never
// pokes through rock. Returns the mesh; the caller colours and lights it.
export function buildLiquid( field, material ) {
    const n = 72;
    const step = CELL / n;
    const pos = [];
    const uv = [];
    const idx = [];
    const index = new Map();
    const vertex = ( i, j ) => {
        const k = i * ( n + 1 ) + j;
        if ( !index.has( k ) ) {
            index.set( k, pos.length / 3 );
            pos.push( -HALF + i * step, LIQUID_Y, -HALF + j * step );
            uv.push( i / n, j / n );
        }
        return index.get( k );
    };
    const air = ( i, j ) => field( -HALF + i * step, LIQUID_Y, -HALF + j * step ) < 0.05;
    for ( let i = 0; i < n; i++ ) {
        for ( let j = 0; j < n; j++ ) {
            if ( air( i, j ) && air( i + 1, j ) && air( i, j + 1 ) && air( i + 1, j + 1 ) ) {
                const a = vertex( i, j );
                const b = vertex( i + 1, j );
                const c = vertex( i, j + 1 );
                const d = vertex( i + 1, j + 1 );
                idx.push( a, c, b, b, c, d );
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute( "position", new THREE.Float32BufferAttribute( pos, 3 ) );
    geo.setAttribute( "uv", new THREE.Float32BufferAttribute( uv, 2 ) );
    geo.setIndex( idx );
    geo.computeVertexNormals();
    return new THREE.Mesh( geo, material );
}
