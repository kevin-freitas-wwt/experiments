import * as THREE from "three";
import { COURT_HALF, PERGOLA_HALF } from "./layout.js";

// Calm dusk water features placed in the periphery ring — between the central
// lattice ( ±PERGOLA_HALF ) and the courtyard walls ( ±COURT_HALF ). The water
// surfaces carry an animated normal map so the warm point lights and lantern
// glow shimmer across gentle, drifting ripples.

// A seamless, tileable water normal map built from a sum-of-sines height field.
// Integer frequencies keep it wrap-around; scrolling its offset makes it ripple.
function makeWaterNormalTexture( size ) {
    const canvas = document.createElement( "canvas" );
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext( "2d" );
    const image = ctx.createImageData( size, size );

    const waves = [];
    for ( let k = 0; k < 6; k++ ) {
        waves.push( {
            fx: 1 + Math.floor( Math.random() * 4 ),
            fy: 1 + Math.floor( Math.random() * 4 ),
            ph: Math.random() * Math.PI * 2,
            a: 0.6 / ( k + 1 )
        } );
    }

    function height( u, v ) {
        let s = 0;
        for ( const w of waves ) {
            s += w.a * Math.sin( 2 * Math.PI * ( w.fx * u + w.fy * v ) + w.ph );
        }
        return s;
    }

    const eps = 1 / size;
    for ( let y = 0; y < size; y++ ) {
        for ( let x = 0; x < size; x++ ) {
            const u = x / size;
            const v = y / size;
            const dx = height( u + eps, v ) - height( u - eps, v );
            const dy = height( u, v + eps ) - height( u, v - eps );
            let nx = -dx * 1.4;
            let ny = -dy * 1.4;
            let nz = 1;
            const len = Math.hypot( nx, ny, nz );
            nx /= len;
            ny /= len;
            nz /= len;
            const idx = ( y * size + x ) * 4;
            image.data[ idx ] = ( nx * 0.5 + 0.5 ) * 255;
            image.data[ idx + 1 ] = ( ny * 0.5 + 0.5 ) * 255;
            image.data[ idx + 2 ] = ( nz * 0.5 + 0.5 ) * 255;
            image.data[ idx + 3 ] = 255;
        }
    }
    ctx.putImageData( image, 0, 0 );

    const texture = new THREE.CanvasTexture( canvas );
    texture.colorSpace = THREE.NoColorSpace;   // normal data is linear, not sRGB
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

// Deep teal/indigo water — low roughness so the warm lights leave soft
// highlights, a touch of metalness for sheen, and the animated ripple normals.
function makeWaterMaterial( repeat ) {
    const normalMap = makeWaterNormalTexture( 128 );
    normalMap.repeat.set( repeat, repeat );
    return new THREE.MeshStandardMaterial( {
        color: 0x0e2630,
        roughness: 0.1,
        metalness: 0.0,
        transparent: true,
        opacity: 0.9,
        normalMap: normalMap,
        normalScale: new THREE.Vector2( 0.6, 0.6 )
    } );
}

// Drift the ripple normals from the render clock — no main-loop wiring needed.
function animateWater( mesh ) {
    const normalMap = mesh.material.normalMap;
    mesh.onBeforeRender = function () {
        const t = performance.now() * 0.001;
        normalMap.offset.set(
            0.04 * Math.sin( t * 0.25 ) + t * 0.012,
            0.04 * Math.cos( t * 0.21 ) + t * 0.009
        );
        const s = 0.55 + Math.sin( t * 0.8 ) * 0.12;
        mesh.material.normalScale.set( s, s );
    };
}

export function buildWater( scene ) {
    const group = new THREE.Group();
    group.name = "water";

    const stoneMat = new THREE.MeshStandardMaterial( {
        color: 0x6b6660,
        roughness: 0.9,
        metalness: 0.05
    } );

    buildKoiPond( group, stoneMat );
    buildTsukubai( group, stoneMat );

    scene.add( group );
    return group;
}

// --- 1. Koi pond: the main feature, tucked toward a back corner of the ring ---
function buildKoiPond( group, stoneMat ) {
    // Centre well inside the periphery: |x|,|z| > PERGOLA_HALF + 1 and
    // comfortably short of the walls ( COURT_HALF - 1 ).
    const cx = -( PERGOLA_HALF + 2.4 );   // -8.4
    const cz = -( PERGOLA_HALF + 2.4 );   // -8.4
    const radius = 2.0;

    const pond = new THREE.Group();
    pond.position.set( cx, 0, cz );

    // Low stone rim — a flat ring sitting just under the water's edge.
    const rim = new THREE.Mesh(
        new THREE.CylinderGeometry( radius + 0.35, radius + 0.5, 0.2, 40 ),
        stoneMat
    );
    rim.position.y = 0.04;
    rim.castShadow = true;
    rim.receiveShadow = true;
    pond.add( rim );

    // Calm water surface — a flat disk lying just above the rim's base.
    const water = new THREE.Mesh(
        new THREE.CircleGeometry( radius, 48 ),
        makeWaterMaterial( 3 )
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.06;
    water.receiveShadow = true;
    animateWater( water );
    pond.add( water );

    // A few smooth rounded stones around the perimeter for an organic edge.
    const stoneCount = 7;
    for ( let i = 0; i < stoneCount; i++ ) {
        const a = ( i / stoneCount ) * Math.PI * 2 + 0.3;
        const r = radius + 0.45;
        const stone = new THREE.Mesh(
            new THREE.SphereGeometry( 0.22 + ( i % 3 ) * 0.05, 12, 10 ),
            stoneMat
        );
        stone.position.set( Math.cos( a ) * r, 0.12, Math.sin( a ) * r );
        stone.scale.y = 0.6;   // flatten slightly so they read as river pebbles
        stone.castShadow = true;
        stone.receiveShadow = true;
        pond.add( stone );
    }

    // Lily pads — thin, flattened dark-green disks resting on the surface.
    const padMat = new THREE.MeshStandardMaterial( {
        color: 0x254a2b,
        roughness: 0.7,
        metalness: 0.0
    } );
    const pads = [
        { x:  0.6, z: -0.5, s: 0.45 },
        { x: -0.7, z:  0.4, s: 0.35 },
        { x:  0.1, z:  0.8, s: 0.4 }
    ];
    for ( const p of pads ) {
        const pad = new THREE.Mesh(
            new THREE.CircleGeometry( p.s, 20 ),
            padMat
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.set( p.x, 0.07, p.z );   // just above the water plane
        pad.receiveShadow = true;
        pond.add( pad );
    }

    group.add( pond );
}

// --- 2. Tsukubai: a small stone water basin set near a side wall ----------
function buildTsukubai( group, stoneMat ) {
    // Against the +X wall, away from the pond and well clear of the lattice.
    const bx = COURT_HALF - 2.0;          // 10
    const bz = PERGOLA_HALF + 1.8;        // 7.8

    const basin = new THREE.Group();
    basin.position.set( bx, 0, bz );

    // Short wide stone cylinder — the basin body.
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry( 0.55, 0.6, 0.5, 24 ),
        stoneMat
    );
    body.position.y = 0.25;
    body.castShadow = true;
    body.receiveShadow = true;
    basin.add( body );

    // Small darker water disk recessed on top.
    const water = new THREE.Mesh(
        new THREE.CircleGeometry( 0.45, 32 ),
        makeWaterMaterial( 1.4 )
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.48;
    water.receiveShadow = true;
    animateWater( water );
    basin.add( water );

    // Thin bamboo spout leaning over the basin.
    const spoutMat = new THREE.MeshStandardMaterial( {
        color: 0x7d8a45,
        roughness: 0.6,
        metalness: 0.0
    } );
    const spout = new THREE.Mesh(
        new THREE.CylinderGeometry( 0.05, 0.05, 1.1, 12 ),
        spoutMat
    );
    spout.rotation.z = Math.PI / 5;       // angled so the tip hangs over the water
    spout.position.set( 0.35, 0.7, 0 );
    spout.castShadow = true;
    basin.add( spout );

    group.add( basin );
}
