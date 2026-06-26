import * as THREE from "three";
import { stringLightSpans, lanternSpots, BEAM_Y } from "./layout.js";

// All illumination for the enclosed, dusk-lit Japanese courtyard: cool ambient
// fill, a low warm "last light" sun, draped string-light bulbs, scattered warm
// point lights, and stone lanterns. Every light gets a soft additive glow sprite.

export function buildLighting( scene ) {

    // ---------------------------------------------------------------------
    // 1. DUSK AMBIENT LIGHTING
    // ---------------------------------------------------------------------

    // Cool sky bleeding into warm reflected ground bounce.
    const hemi = new THREE.HemisphereLight( 0x46557a, 0x2a221c, 0.5 );
    scene.add( hemi );

    // Flat fill so deep shadows never go fully black at dusk.
    const ambient = new THREE.AmbientLight( 0x2b3450, 0.35 );
    scene.add( ambient );

    // The low, warm last light of the day, raking across the courtyard.
    const sun = new THREE.DirectionalLight( 0xff9446, 0.7 );
    sun.position.set( -16, 10, 20 );
    sun.castShadow = true;
    sun.shadow.mapSize.set( 2048, 2048 );
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0004;
    scene.add( sun );

    // ---------------------------------------------------------------------
    // 2. GLOW FACTORY
    // ---------------------------------------------------------------------

    const makeGlow = createGlowFactory();

    // ---------------------------------------------------------------------
    // 3. STRING LIGHTS
    // ---------------------------------------------------------------------

    // Shared bulb geometry/material for all the little draped bulbs.
    const bulbGeo = new THREE.SphereGeometry( 0.06, 8, 8 );
    const bulbMat = new THREE.MeshStandardMaterial( {
        color: 0x4a3a22,
        emissive: 0xffca73,
        emissiveIntensity: 1.6
    } );

    const spans = stringLightSpans();
    const SAG = 0.28;          // peak catenary dip at the middle of a span
    const SPACING = 0.6;       // distance between bulbs along a span

    for ( const span of spans ) {
        const length = span.a.distanceTo( span.b );
        const count = Math.max( 2, Math.round( length / SPACING ) );

        for ( let i = 0; i <= count; i++ ) {
            const fraction = i / count;
            const pos = new THREE.Vector3().lerpVectors( span.a, span.b, fraction );
            // Gentle catenary sag — deepest at the centre, zero at the ends.
            pos.y += -SAG * Math.sin( fraction * Math.PI );

            const bulb = new THREE.Mesh( bulbGeo, bulbMat );
            bulb.position.copy( pos );
            scene.add( bulb );

            const glow = makeGlow( 0xffca73, 0.55 );
            glow.position.copy( pos );
            scene.add( glow );
        }
    }

    // ---------------------------------------------------------------------
    // 4. REAL POINT LIGHTS
    // ---------------------------------------------------------------------

    // Scatter a handful of actual warm point lights near span midpoints so the
    // strings genuinely illuminate the courtyard (not just glow).
    const litSpans = spans.slice( 0, 6 );
    for ( const span of litSpans ) {
        const mid = new THREE.Vector3().addVectors( span.a, span.b ).multiplyScalar( 0.5 );
        const light = new THREE.PointLight( 0xff9a4e, 9, 12, 2 );
        light.position.set( mid.x, BEAM_Y - 0.2, mid.z );
        scene.add( light );
    }

    // ---------------------------------------------------------------------
    // 5. STONE LANTERNS
    // ---------------------------------------------------------------------

    for ( const spot of lanternSpots() ) {
        const lantern = buildStoneLantern( makeGlow );
        lantern.position.copy( spot );
        scene.add( lantern );
    }
}

// -------------------------------------------------------------------------
// GLOW FACTORY: a soft radial-gradient sprite texture, reused for every light.
// -------------------------------------------------------------------------

function createGlowFactory() {
    const size = 128;
    const canvas = document.createElement( "canvas" );
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext( "2d" );
    const half = size / 2;
    const gradient = ctx.createRadialGradient( half, half, 0, half, half, half );
    // Opaque warm white centre fading smoothly to fully transparent.
    gradient.addColorStop( 0.0, "rgba( 255, 244, 214, 1 )" );
    gradient.addColorStop( 0.25, "rgba( 255, 226, 170, 0.6 )" );
    gradient.addColorStop( 0.5, "rgba( 255, 200, 130, 0.25 )" );
    gradient.addColorStop( 1.0, "rgba( 255, 190, 120, 0 )" );
    ctx.fillStyle = gradient;
    ctx.fillRect( 0, 0, size, size );

    const texture = new THREE.CanvasTexture( canvas );
    texture.colorSpace = THREE.SRGBColorSpace;

    // Returns a fresh additive glow sprite tinted and scaled as requested.
    return function makeGlow( color, scale ) {
        const material = new THREE.SpriteMaterial( {
            map: texture,
            color: color,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        } );
        const sprite = new THREE.Sprite( material );
        sprite.scale.set( scale, scale, scale );
        return sprite;
    };
}

// -------------------------------------------------------------------------
// STONE LANTERN: a small stacked-stone Group with its own warm light + glow.
// -------------------------------------------------------------------------

function buildStoneLantern( makeGlow ) {
    const group = new THREE.Group();

    const stoneMat = new THREE.MeshStandardMaterial( {
        color: 0x8d8678,
        roughness: 0.9,
        metalness: 0.0
    } );

    // Short wide base.
    const baseGeo = new THREE.CylinderGeometry( 0.32, 0.38, 0.22, 12 );
    const base = new THREE.Mesh( baseGeo, stoneMat );
    base.position.y = 0.11;
    base.castShadow = true;
    group.add( base );

    // Thin shaft.
    const shaftGeo = new THREE.CylinderGeometry( 0.12, 0.14, 0.7, 10 );
    const shaft = new THREE.Mesh( shaftGeo, stoneMat );
    shaft.position.y = 0.22 + 0.35;
    shaft.castShadow = true;
    group.add( shaft );

    // Glowing "house" box near the top — this is the lit chamber.
    const houseY = 0.22 + 0.7 + 0.22;
    const houseGeo = new THREE.BoxGeometry( 0.34, 0.34, 0.34 );
    const houseMat = new THREE.MeshStandardMaterial( {
        color: 0x8d8678,
        emissive: 0xffb25a,
        emissiveIntensity: 1.4,
        roughness: 0.8
    } );
    const house = new THREE.Mesh( houseGeo, houseMat );
    house.position.y = houseY;
    house.castShadow = true;
    group.add( house );

    // Small 4-sided cone roof.
    const roofGeo = new THREE.ConeGeometry( 0.34, 0.26, 4 );
    const roof = new THREE.Mesh( roofGeo, stoneMat );
    roof.position.y = houseY + 0.17 + 0.13;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add( roof );

    // Actual warm light radiating from the chamber.
    const light = new THREE.PointLight( 0xffb25a, 5, 6, 2 );
    light.position.y = houseY;
    group.add( light );

    // Larger glow halo at the chamber.
    const glow = makeGlow( 0xffb25a, 1.6 );
    glow.position.y = houseY;
    group.add( glow );

    return group;
}
