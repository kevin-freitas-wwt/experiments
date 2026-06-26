import * as THREE from "three";
import { COURT_HALF, WALL_H, ENTRANCE_W, PERGOLA_HALF, POST_LINES, BEAM_Y, POST_TOP, BRICK_HALF } from "./layout.js";
import { makeGravelTexture, makeBrickTexture, makeWallTexture } from "../util/textures.js";

// Builds the static, non-interactive shell of the courtyard: ground, paving,
// the enclosing walls and the overhead pergola lattice. Everything is parented
// to the scene passed in. Lighting, planting and cards live in other modules.
export function buildStructures( scene ) {

    // --- 1. GROUND ---------------------------------------------------------
    // A wide mossy-gravel plane well past the walls so the horizon never shows.
    const gravelTex = makeGravelTexture();
    gravelTex.repeat.set( 40, 40 );

    const groundGeo = new THREE.PlaneGeometry( 200, 200 );
    const groundMat = new THREE.MeshStandardMaterial( { map: gravelTex, roughness: 1 } );
    const ground = new THREE.Mesh( groundGeo, groundMat );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add( ground );

    // --- 2. BRICK PAVING ---------------------------------------------------
    // Central square of running-bond brick, lifted a hair above the gravel.
    const brickTex = makeBrickTexture();
    brickTex.repeat.set( BRICK_HALF, BRICK_HALF );

    const brickGeo = new THREE.PlaneGeometry( BRICK_HALF * 2, BRICK_HALF * 2 );
    const brickMat = new THREE.MeshStandardMaterial( { map: brickTex, roughness: 1 } );
    const brick = new THREE.Mesh( brickGeo, brickMat );
    brick.rotation.x = -Math.PI / 2;
    brick.position.y = 0.02;
    brick.receiveShadow = true;
    scene.add( brick );

    // --- 3. PERIMETER WALLS ------------------------------------------------
    const wallThickness = 0.3;
    const wallTex = makeWallTexture();
    wallTex.repeat.set( 8, 1.5 );
    const wallMat = new THREE.MeshStandardMaterial( { map: wallTex, color: 0xcabfa4, roughness: 1 } );
    const capMat = new THREE.MeshStandardMaterial( { color: 0x2a221d, roughness: 1 } );
    const capH = 0.12;          // thin dark coping on top of each wall
    const capOverhang = 0.1;    // cap is slightly wider than the wall

    // Helper: add one wall segment plus its coping cap. width runs along the
    // wall's length, depth is its thickness; (cx, cz) is the segment centre.
    function addWallSegment( cx, cz, width, depth ) {
        const wallGeo = new THREE.BoxGeometry( width, WALL_H, depth );
        const wall = new THREE.Mesh( wallGeo, wallMat );
        wall.position.set( cx, WALL_H / 2, cz );
        wall.castShadow = true;
        wall.receiveShadow = true;
        scene.add( wall );

        const capGeo = new THREE.BoxGeometry( width + capOverhang, capH, depth + capOverhang );
        const cap = new THREE.Mesh( capGeo, capMat );
        cap.position.set( cx, WALL_H + capH / 2, cz );
        cap.castShadow = true;
        scene.add( cap );
    }

    // Full span of a side, measured corner-to-corner including thickness.
    const span = COURT_HALF * 2 + wallThickness;

    // All four walls are solid runs — the courtyard is fully enclosed.
    addWallSegment( 0, -COURT_HALF, span, wallThickness );          // back (-Z)
    addWallSegment( 0,  COURT_HALF, span, wallThickness );          // front (+Z)
    addWallSegment( -COURT_HALF, 0, wallThickness, COURT_HALF * 2 );// left (-X)
    addWallSegment(  COURT_HALF, 0, wallThickness, COURT_HALF * 2 );// right (+X)

    // --- 4. PERGOLA / OVERHEAD LATTICE -------------------------------------
    const woodMat = new THREE.MeshStandardMaterial( { color: 0x332217, roughness: 0.85 } );
    const postSize = 0.16;
    const beamW = 0.16;
    const beamH = 0.18;

    // POSTS: only around the perimeter of the lattice grid.
    const postGeo = new THREE.BoxGeometry( postSize, POST_TOP, postSize );
    for ( const x of POST_LINES ) {
        for ( const z of POST_LINES ) {
            const onEdge = Math.abs( x ) === PERGOLA_HALF || Math.abs( z ) === PERGOLA_HALF;
            if ( !onEdge ) {
                continue;
            }
            // Leave the central walkway axis clear of posts.
            if ( x === 0 && Math.abs( z ) === PERGOLA_HALF ) {
                continue;
            }
            const post = new THREE.Mesh( postGeo, woodMat );
            post.position.set( x, POST_TOP / 2, z );
            post.castShadow = true;
            scene.add( post );
        }
    }

    // BEAMS: an overhead grid sitting at BEAM_Y. One run along X per z-line and
    // one run along Z per x-line, each spanning the full lattice width.
    const beamLen = PERGOLA_HALF * 2;
    const beamXGeo = new THREE.BoxGeometry( beamLen, beamH, beamW ); // runs along X
    const beamZGeo = new THREE.BoxGeometry( beamW, beamH, beamLen ); // runs along Z

    for ( const z of POST_LINES ) {
        const beam = new THREE.Mesh( beamXGeo, woodMat );
        beam.position.set( 0, BEAM_Y, z );
        beam.castShadow = true;
        scene.add( beam );
    }
    for ( const x of POST_LINES ) {
        const beam = new THREE.Mesh( beamZGeo, woodMat );
        beam.position.set( x, BEAM_Y, 0 );
        beam.castShadow = true;
        scene.add( beam );
    }

    // Thin slats just above the beams for a touch of lattice detail.
    const slatGeo = new THREE.BoxGeometry( beamLen, 0.04, 0.05 );
    const slatY = BEAM_Y + beamH / 2 + 0.03;
    for ( let sx = -PERGOLA_HALF + 1; sx <= PERGOLA_HALF - 1; sx += 1 ) {
        const slat = new THREE.Mesh( slatGeo, woodMat );
        slat.position.set( 0, slatY, sx );
        slat.castShadow = true;
        scene.add( slat );
    }
}
