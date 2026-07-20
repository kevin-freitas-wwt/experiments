import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";

const geometryCache = new Map();
const edgesCache = new Map();

const POS_EASE = 16;
const FILL_EASE = 9;

// Plain LineBasicMaterial ignores its linewidth on most platforms - WebGL's
// core profile caps GL_LINES at 1px in Chrome/ANGLE regardless of the value
// (the spark shards elsewhere in this project hit the same wall and worked
// around it with real cylinder geometry). LineSegments2/LineMaterial render
// each segment as a camera-facing quad instead, so linewidth actually works.
const WIRE_LINEWIDTH = 2;
const activeWireMaterials = new Set();
const wireResolution = new THREE.Vector2( window.innerWidth, window.innerHeight );

// Renderer size changes (see main.js's resize()) have to be pushed into
// every live wire material's resolution uniform, or fat lines render at the
// wrong apparent width until each piece happens to get recreated.
export function setWireResolution( width, height ) {
    wireResolution.set( width, height );
    activeWireMaterials.forEach( ( material ) => material.resolution.set( width, height ) );
}

// A box whose vertex colors fade from frontHex (at +z, facing the camera)
// to backHex (at -z). Front/back faces read as flat solid color; the four
// side faces span the depth, so they render a smooth front-to-back fade.
function gradientGeometry( sizeX, sizeY, sizeZ, frontHex, backHex ) {
    const key = `${ sizeX }|${ sizeY }|${ sizeZ }|${ frontHex }|${ backHex }`;
    if ( geometryCache.has( key ) ) return geometryCache.get( key );

    const geometry = new THREE.BoxGeometry( sizeX, sizeY, sizeZ );
    const position = geometry.attributes.position;
    const front = new THREE.Color( frontHex );
    const back = new THREE.Color( backHex );
    const mixed = new THREE.Color();
    const colors = new Float32Array( position.count * 3 );

    for ( let i = 0; i < position.count; i++ ) {
        const t = position.getZ( i ) / sizeZ + 0.5; // 0 at back face, 1 at front face
        mixed.copy( back ).lerp( front, t );
        colors[ i * 3 ] = mixed.r;
        colors[ i * 3 + 1 ] = mixed.g;
        colors[ i * 3 + 2 ] = mixed.b;
    }
    geometry.setAttribute( "color", new THREE.BufferAttribute( colors, 3 ) );

    geometryCache.set( key, geometry );
    return geometry;
}

function sharedEdges( sizeX, sizeY, sizeZ ) {
    const key = `${ sizeX }|${ sizeY }|${ sizeZ }`;
    if ( !edgesCache.has( key ) ) {
        const edges = new THREE.EdgesGeometry( new THREE.BoxGeometry( sizeX, sizeY, sizeZ ) );
        const fat = new LineSegmentsGeometry();
        fat.setPositions( edges.attributes.position.array );
        edges.dispose();
        edgesCache.set( key, fat );
    }
    return edgesCache.get( key );
}

// A single Tetris cell: one full cube deep, with a bright flat front facet
// fading smoothly through the side facets to a dim back facet. The fill
// starts fully transparent (wireframe only) and animates to opaque once
// the piece locks, via setFilled() + updateBlock().
export function createBlockMesh( colorHex, sizeXY = 0.92, depth = 1 ) {
    const backHex = new THREE.Color( colorHex ).multiplyScalar( 0.24 ).getHex();
    const geometry = gradientGeometry( sizeXY, sizeXY, depth, colorHex, backHex );
    // depthWrite: false - the fill starts invisible (opacity 0) while a piece
    // falls, and a depth-writing invisible mesh would still occlude/z-fight
    // against anything behind it (namely the well's back panel).
    const material = new THREE.MeshBasicMaterial( { vertexColors: true, opacity: 0, transparent: true, depthWrite: false } );
    const fill = new THREE.Mesh( geometry, material );

    const wireMaterial = new LineMaterial( {
        color: colorHex,
        linewidth: WIRE_LINEWIDTH,
        resolution: wireResolution,
    } );
    activeWireMaterials.add( wireMaterial );
    const wire = new LineSegments2( sharedEdges( sizeXY, sizeXY, depth ), wireMaterial );

    const group = new THREE.Group();
    group.add( fill, wire );
    group.userData = { fillOpacity: 0, fillTarget: 0, material, wireMaterial };
    return group;
}

// A static gradient panel (no wireframe, fixed opacity) for background
// elements like the playfield well.
export function createGradientPanel( sizeX, sizeY, sizeZ, frontHex, backHex, opacity ) {
    const geometry = gradientGeometry( sizeX, sizeY, sizeZ, frontHex, backHex );
    const material = new THREE.MeshBasicMaterial( { vertexColors: true, opacity, transparent: true, depthWrite: false } );
    return new THREE.Mesh( geometry, material );
}

export function setFilled( group, filled ) {
    group.userData.fillTarget = filled ? 1 : 0;
}

export function flashWhite( group ) {
    const mat = group.userData.material;
    mat.vertexColors = false;
    mat.color.set( 0xffffff );
    mat.needsUpdate = true;
    mat.opacity = 1;
    group.userData.wireMaterial.color.set( 0xffffff );
    group.userData.fillTarget = 1;
    group.userData.fillOpacity = 1;
}

// Eases any object's position toward userData.targetX/targetY (set whenever
// a piece falls, shifts, or slides down after a line clear) so motion reads
// as a smooth glide between grid steps rather than a hard snap. Works for a
// cell group or a piece container - anything with a position and userData.
export function easePosition( object, dt ) {
    const ud = object.userData;
    const ease = Math.min( 1, dt * POS_EASE );
    if ( ud.targetX !== undefined && object.position.x !== ud.targetX ) {
        object.position.x += ( ud.targetX - object.position.x ) * ease;
        if ( Math.abs( object.position.x - ud.targetX ) < 0.005 ) object.position.x = ud.targetX;
    }
    if ( ud.targetY !== undefined && object.position.y !== ud.targetY ) {
        object.position.y += ( ud.targetY - object.position.y ) * ease;
        if ( Math.abs( object.position.y - ud.targetY ) < 0.005 ) object.position.y = ud.targetY;
    }
}

// Eases fill opacity toward its target and eases position. Call once per
// cell per tick.
export function updateBlock( group, dt ) {
    const ud = group.userData;

    if ( ud.fillOpacity !== ud.fillTarget ) {
        ud.fillOpacity += ( ud.fillTarget - ud.fillOpacity ) * Math.min( 1, dt * FILL_EASE );
        if ( Math.abs( ud.fillOpacity - ud.fillTarget ) < 0.01 ) ud.fillOpacity = ud.fillTarget;
        ud.material.opacity = ud.fillOpacity;
    }

    easePosition( group, dt );
}

export function disposeBlockMesh( group ) {
    group.userData.material.dispose();
    group.userData.wireMaterial.dispose();
    activeWireMaterials.delete( group.userData.wireMaterial );
}
