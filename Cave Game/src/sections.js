import * as THREE from "three";
import { seeded } from "./noise.js";
import { buildCave } from "./caves.js";

// Every section lives inside one CELL-sized cube centred on the origin, floor at
// y = 0. Openings sit at fixed positions on each face so any two sections that
// both open onto a shared face line up.
export const CELL = 6;

export const FACES = [ "n", "e", "s", "w" ];
export const OPPOSITE = { n: "s", e: "w", s: "n", w: "e", up: "down", down: "up" };

// Openings are listed for rotation 0. "rot" in a level is quarter turns
// clockwise seen from above; wall openings rotate, up/down stay put.
export const KIT = {
    corridor: { open: [ "n", "s" ], blurb: "straight pass-through" },
    corner: { open: [ "n", "e" ], blurb: "90° turn" },
    tee: { open: [ "n", "s", "e" ], blurb: "one side opens off" },
    cross: { open: [ "n", "e", "s", "w" ], blurb: "both sides open off" },
    end: { open: [ "n" ], blurb: "dead end" },
    chimney: { open: [ "s", "up" ], blurb: "dead end under a ceiling hole" },
    shaft: { open: [ "up", "down" ], blurb: "vertical pass-through" },
    pit: { open: [ "n", "down" ], blurb: "dead end over a drop" },
    well: { open: [ "n", "s", "down" ], blurb: "passage with a floor hole" },
    cap: { open: [ "n", "s", "up" ], blurb: "passage with a ceiling hole" }
};

export function rotatedOpenings( type, rot ) {
    return KIT[ type ].open.map( ( f ) => {
        const i = FACES.indexOf( f );
        return i < 0 ? f : FACES[ ( i + rot ) % 4 ];
    } );
}

// Builds a section at rotation 0 in local space. `seed` keeps its erosion
// stable between loads.
export function buildSection( type, seed = 1 ) {
    const def = KIT[ type ];
    if ( !def ) {
        throw new Error( `Unknown section type: ${ type }` );
    }
    const group = new THREE.Group();
    buildCave( group, new Set( def.open ), { rand: seeded( seed ) } );
    return group;
}
