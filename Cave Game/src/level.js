import * as THREE from "three";
import { CELL, KIT, OPPOSITE, buildSection, rotatedOpenings } from "./sections.js";
import { materials } from "./materials.js";

const DELTA = {
    n: [ 0, 0, -1 ], e: [ 1, 0, 0 ], s: [ 0, 0, 1 ], w: [ -1, 0, 0 ],
    up: [ 0, 1, 0 ], down: [ 0, -1, 0 ]
};

export const key = ( x, y, z ) => `${ x },${ y },${ z }`;

export async function loadLevel( name ) {
    const response = await fetch( `./levels/${ name }.json` );
    if ( !response.ok ) {
        throw new Error( `Level "${ name }" not found (${ response.status })` );
    }
    return response.json();
}

function label( text, sub ) {
    const canvas = document.createElement( "canvas" );
    canvas.width = 640;
    canvas.height = 160;
    const ctx = canvas.getContext( "2d" );
    ctx.fillStyle = "#e8e2d4";
    ctx.textAlign = "center";
    ctx.font = "500 64px Menlo, Consolas, monospace";
    ctx.fillText( text, 320, 70 );
    ctx.fillStyle = "#f2a93b";
    ctx.font = "26px Menlo, Consolas, monospace";
    ctx.fillText( sub, 320, 122 );
    const tex = new THREE.CanvasTexture( canvas );
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite( new THREE.SpriteMaterial( { map: tex, transparent: true } ) );
    sprite.scale.set( 6.4, 1.6, 1 );
    return sprite;
}

// Instantiates a level: returns the group to add to the scene, the collidable
// meshes, a cell lookup for the HUD, and any connection warnings.
export function buildLevel( level ) {
    const group = new THREE.Group();
    const colliders = [];
    const cells = new Map();
    const warnings = [];

    for ( const c of level.cells ) {
        const rot = c.rot || 0;
        const faces = rotatedOpenings( c.type, rot );
        cells.set( key( c.x, c.y, c.z ), { ...c, rot, faces } );
    }

    for ( const c of cells.values() ) {
        const section = buildSection( c.type, ( c.x * 73856093 ^ c.y * 19349663 ^ c.z * 83492791 ) >>> 0 );
        section.rotation.y = -c.rot * Math.PI / 2;
        section.position.set( c.x * CELL, c.y * CELL, c.z * CELL );
        group.add( section );
        section.traverse( ( o ) => {
            if ( o.isMesh ) {
                colliders.push( o );
            }
        } );

        if ( c.label !== false && level.labels ) {
            const tag = label( c.type, KIT[ c.type ].blurb );
            tag.position.set( c.x * CELL, c.y * CELL + CELL - 1.2, c.z * CELL + CELL / 2 + 0.4 );
            group.add( tag );
        }

        for ( const face of c.faces ) {
            const [ dx, dy, dz ] = DELTA[ face ];
            const other = cells.get( key( c.x + dx, c.y + dy, c.z + dz ) );
            if ( other && !other.faces.includes( OPPOSITE[ face ] ) ) {
                warnings.push( `${ c.type }@${ key( c.x, c.y, c.z ) } opens ${ face } into a closed face of ${ other.type }` );
            }
        }
    }

    if ( level.ground ) {
        const span = CELL * 40;
        const ground = new THREE.Mesh( new THREE.PlaneGeometry( span, span ), materials.ground );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.02;
        ground.receiveShadow = true;
        group.add( ground );
        colliders.push( ground );
    }

    return { group, colliders, cells, warnings };
}

export function cellAt( position ) {
    return {
        x: Math.round( position.x / CELL ),
        y: Math.floor( position.y / CELL ),
        z: Math.round( position.z / CELL )
    };
}
