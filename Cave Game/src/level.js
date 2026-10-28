import * as THREE from "three";
import { CELL, KIT, LIQUID_DEFAULT, OPPOSITE, buildSection, rotatedOpenings } from "./sections.js";
import { buildLiquid } from "./caves.js";
import { liquidMaterial, materials } from "./materials.js";
import { buildFlare } from "./flare.js";
import { buildLamp } from "./lamp.js";

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

// Instantiates a level: returns the group to add to the scene, the ground, a
// cell lookup (each cell carries its group and meshes), flares, liquid
// materials to animate, and warnings.
export function buildLevel( level ) {
    const group = new THREE.Group();
    const cells = new Map();
    const flares = [];
    const liquids = [];
    let ground = null;
    const warnings = [];

    for ( const c of level.cells ) {
        const rot = c.rot || 0;
        const faces = rotatedOpenings( c.type, rot );
        cells.set( key( c.x, c.y, c.z ), { ...c, rot, faces } );
    }

    for ( const c of cells.values() ) {
        const { group: section, field, basin } = buildSection( c.type, ( c.x * 73856093 ^ c.y * 19349663 ^ c.z * 83492791 ) >>> 0 );
        section.rotation.y = -c.rot * Math.PI / 2;
        c.group = new THREE.Group();
        c.group.position.set( c.x * CELL, c.y * CELL, c.z * CELL );
        c.group.add( section );
        group.add( c.group );
        c.meshes = [];
        section.traverse( ( o ) => {
            if ( o.isMesh ) {
                c.meshes.push( o );
            }
        } );

        if ( c.label !== false && level.labels ) {
            const tag = label( c.type, KIT[ c.type ].blurb );
            tag.position.set( 0, CELL - 1.2, CELL / 2 + 0.4 );
            c.group.add( tag );
        }

        if ( basin ) {
            c.liquid = c.liquid || LIQUID_DEFAULT;
            const material = liquidMaterial( c.liquid );
            c.liquidMesh = buildLiquid( field, material, basin );
            section.add( c.liquidMesh );
            liquids.push( material );
            const glow = new THREE.PointLight( c.liquid, 90, CELL * 2.2, 2 );
            glow.position.set( c.x * CELL, c.y * CELL + 1.6, c.z * CELL );
            group.add( glow );
        } else {
            delete c.liquid;
        }

        if ( c.flare ) {
            flares.push( buildFlare( c, group ) );
        }
        if ( c.lamp ) {
            buildLamp( c, group );
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
        ground = new THREE.Mesh( new THREE.PlaneGeometry( span, span ), materials.ground );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.02;
        group.add( ground );
    }

    return { group, ground, cells, flares, liquids, warnings };
}

export function cellAt( position ) {
    return {
        x: Math.round( position.x / CELL ),
        y: Math.floor( position.y / CELL ),
        z: Math.round( position.z / CELL )
    };
}
