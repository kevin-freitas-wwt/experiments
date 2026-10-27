import * as THREE from "three";
import { materials } from "./materials.js";
import { seeded, noise2 } from "./noise.js";

// Every section lives inside one CELL-sized cube centred on the origin, floor at
// y = 0. Openings sit at fixed positions on each face so any two sections that
// both open onto a shared face line up.
export const CELL = 6;
export const DOOR_W = 2.4;
export const DOOR_H = 3.6;
export const HOLE = 2.4;

export const FACES = [ "n", "e", "s", "w" ];
export const OPPOSITE = { n: "s", e: "w", s: "n", w: "e", up: "down", down: "up" };

const HALF = CELL / 2;
const RAMP_T = 0.3;

// Cave style: panels are subdivided and pushed inward by noise. Displacement
// fades to zero at every panel edge, so cube boundaries and openings stay
// exactly where the flat kit puts them and neighbours still meet.
const CAVE = {
    edge: 0.9,
    segment: 0.4,
    amp: { wall: 1.1, floor: 0.25, ceiling: 1.2 },
    scale: 0.42
};

// Openings are listed for rotation 0. "rot" in a level is quarter turns
// clockwise seen from above; walls rotate, up/down stay put.
const BASE = {
    corridor: { open: [ "n", "s" ], blurb: "straight pass-through" },
    corner: { open: [ "n", "e" ], blurb: "90° turn" },
    tee: { open: [ "n", "s", "e" ], blurb: "corridor, one side open" },
    cross: { open: [ "n", "e", "s", "w" ], blurb: "corridor, both sides open" },
    end: { open: [ "n" ], blurb: "dead end" },
    ramp: { open: [ "s", "up" ], blurb: "ramp up through the ceiling", build: buildRamp },
    shaft: { open: [ "up", "down" ], blurb: "vertical pass-through" },
    pit: { open: [ "n", "down" ], blurb: "dead end over a drop" },
    well: { open: [ "n", "s", "down" ], blurb: "corridor with a floor hole" },
    cap: { open: [ "n", "s", "up" ], blurb: "corridor with a ceiling hole" }
};

export const KIT = { ...BASE };
for ( const [ name, def ] of Object.entries( BASE ) ) {
    KIT[ `cave-${ name }` ] = { ...def, blurb: `${ def.blurb }, eroded`, cave: true };
}

export function rotatedOpenings( type, rot ) {
    return KIT[ type ].open.map( ( f ) => {
        const i = FACES.indexOf( f );
        return i < 0 ? f : FACES[ ( i + rot ) % 4 ];
    } );
}

const smooth = ( t ) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * ( 3 - 2 * t );

// Plane whose UVs are scaled so texture density matches a full CELL face. In
// cave style it is subdivided and displaced along its normal (+z, which every
// caller rotates to point into the room).
function panel( w, h, kind, ctx ) {
    const cave = Boolean( ctx );
    const segs = cave ? [ Math.max( 2, Math.round( w / CAVE.segment ) ), Math.max( 2, Math.round( h / CAVE.segment ) ) ] : [ 1, 1 ];
    const geo = new THREE.PlaneGeometry( w, h, segs[ 0 ], segs[ 1 ] );
    const uv = geo.attributes.uv;
    for ( let i = 0; i < uv.count; i++ ) {
        uv.setXY( i, uv.getX( i ) * w / CELL, uv.getY( i ) * h / CELL );
    }

    if ( cave ) {
        const pos = geo.attributes.position;
        const ox = ctx.rand() * 100;
        const oy = ctx.rand() * 100;
        const amp = CAVE.amp[ kind ];
        for ( let i = 0; i < pos.count; i++ ) {
            const x = pos.getX( i );
            const y = pos.getY( i );
            const d = Math.min( x + w / 2, w / 2 - x, y + h / 2, h / 2 - y );
            const fade = smooth( d / CAVE.edge );
            const n = noise2( ( x + ox ) * CAVE.scale, ( y + oy ) * CAVE.scale ) * 0.7
                + noise2( ( x + ox ) * CAVE.scale * 2.3, ( y + oy ) * CAVE.scale * 2.3 ) * 0.3;
            pos.setZ( i, amp * fade * ( 0.25 + n ) );
        }
        geo.computeVertexNormals();
    }

    const mesh = new THREE.Mesh( geo, materials[ cave ? `cave_${ kind }` : kind ] );
    mesh.receiveShadow = true;
    return mesh;
}

// Wall in local space: lies at z = +HALF facing the centre (-z). Rotated into
// place by the caller.
function buildWall( open, ctx ) {
    const group = new THREE.Group();
    const add = ( w, h, x, y ) => {
        const m = panel( w, h, "wall", ctx );
        m.rotation.y = Math.PI;
        m.position.set( x, y, HALF );
        group.add( m );
    };
    if ( !open ) {
        add( CELL, CELL, 0, HALF );
        return group;
    }
    const side = ( CELL - DOOR_W ) / 2;
    add( side, CELL, -( DOOR_W / 2 + side / 2 ), HALF );
    add( side, CELL, DOOR_W / 2 + side / 2, HALF );
    add( DOOR_W, CELL - DOOR_H, 0, DOOR_H + ( CELL - DOOR_H ) / 2 );
    return group;
}

// Horizontal slab at y with an optional centred square hole. `up` selects
// which way it faces.
function buildSlab( y, hole, up, ctx ) {
    const group = new THREE.Group();
    const kind = up ? "floor" : "ceiling";
    const add = ( w, d, x, z ) => {
        const m = panel( w, d, kind, ctx );
        m.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
        m.position.set( x, y, z );
        group.add( m );
    };
    if ( !hole ) {
        add( CELL, CELL, 0, 0 );
        return group;
    }
    const side = ( CELL - HOLE ) / 2;
    add( CELL, side, 0, -( HOLE / 2 + side / 2 ) );
    add( CELL, side, 0, HOLE / 2 + side / 2 );
    add( side, HOLE, -( HOLE / 2 + side / 2 ), 0 );
    add( side, HOLE, HOLE / 2 + side / 2, 0 );
    return group;
}

// Slab from the south doorsill up to the far edge of the ceiling hole.
function buildRamp( group ) {
    const run = HALF + HOLE / 2;
    const length = Math.hypot( run, CELL );
    const angle = Math.atan2( CELL, run );
    const ramp = new THREE.Mesh( new THREE.BoxGeometry( HOLE, RAMP_T, length ), materials.step );
    ramp.rotation.x = angle;
    ramp.position.set( 0, CELL / 2 - RAMP_T / 2 * Math.cos( angle ), HALF - run / 2 - RAMP_T / 2 * Math.sin( angle ) );
    ramp.castShadow = ramp.receiveShadow = true;
    group.add( ramp );
}

// Stalactites, stalagmites and rubble. Kept out of the centre lane and the
// hole footprint, and under knee height on the floor, so they never block
// movement; they just add silhouette.
function dress( group, open, ctx ) {
    const rand = ctx.rand;
    const spots = [];
    let guard = 60;
    while ( spots.length < 14 && guard-- ) {
        const x = ( rand() - 0.5 ) * ( CELL - 0.8 );
        const z = ( rand() - 0.5 ) * ( CELL - 0.8 );
        const nearWall = Math.max( Math.abs( x ), Math.abs( z ) ) > 1.9;
        const inDoorLane = ( Math.abs( x ) < 1.5 && ( open.has( "n" ) || open.has( "s" ) ) )
            || ( Math.abs( z ) < 1.5 && ( open.has( "e" ) || open.has( "w" ) ) );
        if ( nearWall && !inDoorLane ) {
            spots.push( [ x, z ] );
        }
    }

    spots.forEach( ( [ x, z ], i ) => {
        const r = 0.12 + rand() * 0.22;
        if ( i % 3 === 0 ) {
            const h = 0.3 + rand() * 0.8;
            const rock = new THREE.Mesh( new THREE.ConeGeometry( r, h, 5 ), materials.cave_floor );
            rock.position.set( x, h / 2 - 0.05, z );
            rock.rotation.y = rand() * Math.PI;
            rock.castShadow = true;
            group.add( rock );
        } else if ( i % 3 === 1 ) {
            const rubble = new THREE.Mesh( new THREE.DodecahedronGeometry( r, 0 ), materials.cave_floor );
            rubble.position.set( x, r * 0.6, z );
            rubble.rotation.set( rand() * 3, rand() * 3, rand() * 3 );
            rubble.scale.set( 1 + rand() * 0.6, 0.6 + rand() * 0.4, 1 + rand() * 0.6 );
            rubble.castShadow = true;
            group.add( rubble );
        } else {
            const h = 0.5 + rand() * 1.3;
            const tite = new THREE.Mesh( new THREE.ConeGeometry( r, h, 5 ), materials.cave_ceiling );
            tite.position.set( x, CELL - h / 2 + 0.05, z );
            tite.rotation.set( Math.PI, rand() * Math.PI, 0 );
            tite.castShadow = true;
            group.add( tite );
        }
    } );
}

// Builds a section at rotation 0 in local space. Faces point inward only, so
// from outside a cube you look straight through into it. `seed` keeps a cave
// section's erosion stable between loads.
export function buildSection( type, seed = 1 ) {
    const def = KIT[ type ];
    if ( !def ) {
        throw new Error( `Unknown section type: ${ type }` );
    }
    const open = new Set( def.open );
    const group = new THREE.Group();
    const ctx = def.cave ? { rand: seeded( seed ) } : null;

    group.add( buildSlab( 0, open.has( "down" ), true, ctx ) );
    group.add( buildSlab( CELL, open.has( "up" ), false, ctx ) );

    FACES.forEach( ( face, i ) => {
        const wall = buildWall( open.has( face ), ctx );
        wall.rotation.y = Math.PI - i * Math.PI / 2;
        group.add( wall );
    } );

    if ( def.build ) {
        def.build( group );
    }
    if ( ctx ) {
        dress( group, open, ctx );
    }
    return group;
}
