import * as THREE from "three";
import { COURT_HALF, PERGOLA_HALF, ENTRANCE_W, plantingSpots } from "./layout.js";

// Set dressing for the dusk courtyard. Foliage uses the classic stylised-tree
// technique: a canvas "leaf cluster" texture (ragged, alpha-cut silhouette)
// mapped onto several intersecting billboard planes, so each canopy reads as a
// full, leafy volume from any angle -- no hard polygon facets, no flat puffs.

// --- placement bounds -------------------------------------------------------

const WALL_LIMIT = COURT_HALF - 0.5;
const LATTICE_PAD = PERGOLA_HALF + 0.8;
const ENTRANCE_PAD = ENTRANCE_W / 2 + 0.5;

function isLegal( x, z ) {
    if ( Math.abs( x ) > WALL_LIMIT || Math.abs( z ) > WALL_LIMIT ) return false;
    if ( Math.abs( x ) < LATTICE_PAD && Math.abs( z ) < LATTICE_PAD ) return false;
    return true;
}

// Tiny seeded RNG so the layout is deterministic between reloads.
function makeRandom( seed ) {
    let s = seed >>> 0;
    return function () {
        s = ( s * 1664525 + 1013904223 ) >>> 0;
        return s / 4294967296;
    };
}

// --- leaf-cluster textures --------------------------------------------------

// Draws a ragged, organic clump of small leaves on a transparent canvas. With
// alphaTest the gaps drop out, leaving an irregular leafy silhouette.
function buildFoliageCanvas( seed ) {
    const rand = makeRandom( seed );
    const size = 256;
    const canvas = document.createElement( "canvas" );
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext( "2d" );

    const cx = size / 2;
    const cy = size * 0.54;
    const leaves = 240;

    for ( let i = 0; i < leaves; i++ ) {
        const ang = rand() * Math.PI * 2;
        // denser toward the centre, ragged toward the rim
        const rr = Math.pow( rand(), 0.55 ) * ( size * 0.42 );
        const x = cx + Math.cos( ang ) * rr;
        const y = cy + Math.sin( ang ) * rr * 0.92;

        const w = 7 + rand() * 11;
        const h = 13 + rand() * 17;
        const rot = rand() * Math.PI;

        // colour: muted dusk greens, lighter toward the top of the clump, with
        // the occasional warm-olive leaf.
        const top = 1 - y / size;
        const warm = rand() < 0.08;
        const hue = warm ? 54 + rand() * 12 : 100 + rand() * 36;
        const sat = warm ? 38 : 36 + rand() * 22;
        const light = 11 + top * 13 + rand() * 7;

        ctx.save();
        ctx.translate( x, y );
        ctx.rotate( rot );
        ctx.fillStyle = `hsl( ${ hue }, ${ sat }%, ${ light }% )`;
        ctx.beginPath();
        ctx.ellipse( 0, 0, w / 2, h / 2, 0, 0, Math.PI * 2 );
        ctx.fill();
        ctx.restore();
    }

    return canvas;
}

// A few cached variants so trees don't all look identical.
const foliageTextures = [];

function foliageTexture( index ) {
    if ( foliageTextures[ index ] ) return foliageTextures[ index ];
    const tex = new THREE.CanvasTexture( buildFoliageCanvas( 1000 + index * 7919 ) );
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    foliageTextures[ index ] = tex;
    return tex;
}

function foliageMaterial( index, tint ) {
    return new THREE.MeshStandardMaterial( {
        map: foliageTexture( index ),
        color: tint,
        alphaTest: 0.45,            // crisp leafy silhouette, depth-writes normally
        side: THREE.DoubleSide,
        roughness: 1,
        metalness: 0,
        emissive: 0x0c140e,         // lift the foliage just out of total dusk shadow
        emissiveIntensity: 0.35
    } );
}

// --- trees ------------------------------------------------------------------

// A tree: a smooth tapered trunk topped by a canopy of intersecting leaf cards.
function makeSoftTree( x, z, scale ) {
    const tree = new THREE.Group();
    tree.position.set( x, 0, z );

    const rand = makeRandom( Math.round( ( x + 100 ) * 73 + ( z + 100 ) * 17 ) );

    // trunk
    const trunkH = 2.2 * scale;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry( 0.12 * scale, 0.2 * scale, trunkH, 8 ),
        new THREE.MeshStandardMaterial( { color: 0x53412f, roughness: 0.95 } )
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    tree.add( trunk );

    // canopy: intersecting leaf cards forming a rounded volume
    const tint = new THREE.Color().setHSL(
        ( 100 + ( rand() - 0.5 ) * 30 ) / 360, 0.28, 0.42
    );
    const variant = Math.floor( rand() * 3 );
    const centerY = trunkH + 0.7 * scale;
    const cardCount = 8 + Math.floor( rand() * 3 );

    for ( let i = 0; i < cardCount; i++ ) {
        const w = ( 2.4 + rand() * 1.4 ) * scale;
        const h = ( 2.3 + rand() * 1.2 ) * scale;
        const card = new THREE.Mesh(
            new THREE.PlaneGeometry( w, h ),
            foliageMaterial( ( variant + i ) % 3, tint )
        );

        // spread cards through the canopy volume and fan their facings
        const ang = ( i / cardCount ) * Math.PI * 2 + rand() * 0.6;
        const spread = rand() * 0.7 * scale;
        card.position.set(
            Math.cos( ang ) * spread,
            centerY + ( rand() - 0.5 ) * 1.1 * scale,
            Math.sin( ang ) * spread
        );
        card.rotation.set(
            ( rand() - 0.5 ) * 0.7,
            ang,
            ( rand() - 0.5 ) * 0.4
        );
        tree.add( card );
    }

    // a couple of near-horizontal cards cap the crown so there is no gap on top
    for ( let i = 0; i < 2; i++ ) {
        const s = ( 2.2 + rand() * 1.0 ) * scale;
        const cap = new THREE.Mesh(
            new THREE.PlaneGeometry( s, s ),
            foliageMaterial( variant, tint )
        );
        cap.position.set(
            ( rand() - 0.5 ) * 0.5 * scale,
            centerY + 0.9 * scale,
            ( rand() - 0.5 ) * 0.5 * scale
        );
        cap.rotation.set( Math.PI / 2 + ( rand() - 0.5 ) * 0.4, rand() * Math.PI, 0 );
        tree.add( cap );
    }

    return tree;
}

// --- shrubs -----------------------------------------------------------------

// A low bush: a few small intersecting leaf cards near the ground.
function makeShrub( x, z, rand ) {
    const shrub = new THREE.Group();
    shrub.position.set( x, 0, z );

    const tint = new THREE.Color().setHSL( 110 / 360, 0.3, 0.38 );
    const cards = 3 + Math.floor( rand() * 2 );
    for ( let i = 0; i < cards; i++ ) {
        const s = 0.8 + rand() * 0.7;
        const card = new THREE.Mesh(
            new THREE.PlaneGeometry( s, s * 0.85 ),
            foliageMaterial( i % 3, tint )
        );
        card.position.set( ( rand() - 0.5 ) * 0.5, s * 0.42, ( rand() - 0.5 ) * 0.5 );
        card.rotation.set( ( rand() - 0.5 ) * 0.4, ( i / cards ) * Math.PI * 2, 0 );
        shrub.add( card );
    }
    return shrub;
}

// --- smooth stones ----------------------------------------------------------

// A rounded, matte-grey stone using a smooth high-subdivision sphere, flattened
// and half-buried.
function makeStone( x, z, rand ) {
    const radius = 0.4 + rand() * 0.35;
    const stone = new THREE.Mesh(
        new THREE.IcosahedronGeometry( radius, 3 ),
        new THREE.MeshStandardMaterial( { color: 0x6b6660, roughness: 1 } )
    );
    stone.scale.set( 1.1, 0.6, 1.0 );
    stone.position.set( x, radius * 0.18, z );
    stone.rotation.y = rand() * Math.PI;
    stone.castShadow = true;
    return stone;
}

// --- build ------------------------------------------------------------------

export function buildPlanting( scene ) {
    const group = new THREE.Group();
    group.name = "planting";

    const spots = plantingSpots();

    // 1. A tree at each periphery spot, with scale + position variation.
    for ( const spot of spots ) {
        const rand = makeRandom( Math.round( ( spot.x + 50 ) * 91 + ( spot.z + 50 ) * 31 ) );
        const scale = 1.0 + rand() * 0.6;
        const tx = spot.x + ( rand() - 0.5 ) * 0.6;
        const tz = spot.z + ( rand() - 0.5 ) * 0.6;
        const x = isLegal( tx, tz ) ? tx : spot.x;
        const z = isLegal( tx, tz ) ? tz : spot.z;
        group.add( makeSoftTree( x, z, scale ) );
    }

    // 2. Shrubs and stones scattered around the trees.
    const shrubOffsets = [ [ -1.6, 0.8 ], [ 1.5, -1.1 ], [ 0.6, 1.7 ] ];
    for ( const spot of spots ) {
        const rand = makeRandom( Math.round( ( spot.x + 7 ) * 113 + ( spot.z + 7 ) * 53 ) );
        for ( const [ ox, oz ] of shrubOffsets ) {
            const x = spot.x + ox + ( rand() - 0.5 ) * 0.4;
            const z = spot.z + oz + ( rand() - 0.5 ) * 0.4;
            if ( isLegal( x, z ) ) group.add( makeShrub( x, z, rand ) );
        }
    }

    const stoneSpots = [
        [ -( COURT_HALF - 3.0 ), -( COURT_HALF - 1.4 ) ],
        [ COURT_HALF - 1.4, -( COURT_HALF - 3.0 ) ],
        [ COURT_HALF - 2.8, COURT_HALF - 2.8 ]
    ];
    for ( const [ x, z ] of stoneSpots ) {
        if ( isLegal( x, z ) ) {
            const rand = makeRandom( Math.round( ( x + 500 ) * 37 + ( z + 500 ) * 97 ) );
            group.add( makeStone( x, z, rand ) );
        }
    }

    scene.add( group );
    return group;
}
