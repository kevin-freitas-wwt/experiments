import * as THREE from "three";
import { materials } from "./materials.js";
import { seeded } from "./noise.js";
import { buildCave } from "./caves.js";

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
    KIT[ `cave-${ name }` ] = { ...def, blurb: `${ def.blurb }, as tunnel`, build: null, cave: true };
}

export function rotatedOpenings( type, rot ) {
    return KIT[ type ].open.map( ( f ) => {
        const i = FACES.indexOf( f );
        return i < 0 ? f : FACES[ ( i + rot ) % 4 ];
    } );
}

// Plane whose UVs are scaled so texture density matches a full CELL face.
function panel( w, h, kind ) {
    const geo = new THREE.PlaneGeometry( w, h );
    const uv = geo.attributes.uv;
    for ( let i = 0; i < uv.count; i++ ) {
        uv.setXY( i, uv.getX( i ) * w / CELL, uv.getY( i ) * h / CELL );
    }
    const mesh = new THREE.Mesh( geo, materials[ kind ] );
    return mesh;
}

// Wall in local space: lies at z = +HALF facing the centre (-z). Rotated into
// place by the caller.
function buildWall( open ) {
    const group = new THREE.Group();
    const add = ( w, h, x, y ) => {
        const m = panel( w, h, "wall" );
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
function buildSlab( y, hole, up ) {
    const group = new THREE.Group();
    const kind = up ? "floor" : "ceiling";
    const add = ( w, d, x, z ) => {
        const m = panel( w, d, kind );
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
    group.add( ramp );
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

    if ( def.cave ) {
        buildCave( group, open, { rand: seeded( seed ) } );
    } else {
        group.add( buildSlab( 0, open.has( "down" ), true ) );
        group.add( buildSlab( CELL, open.has( "up" ), false ) );
        FACES.forEach( ( face, i ) => {
            const wall = buildWall( open.has( face ) );
            wall.rotation.y = Math.PI - i * Math.PI / 2;
            group.add( wall );
        } );
    }

    if ( def.build ) {
        def.build( group );
    }
    return group;
}
