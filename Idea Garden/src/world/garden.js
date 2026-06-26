import * as THREE from "three";
import { buildStructures } from "./structures.js";
import { buildLighting } from "./lighting.js";
import { buildPlanting } from "./planting.js";
import { buildWater } from "./water.js";
import { cardHangPoints } from "./layout.js";

// Orchestrates the courtyard: sets the dusk sky and fog, then assembles the
// world from its modules — structures (shell + lattice), lighting (lights +
// glow), and planting (periphery trees & plants). Returns the lattice hang
// points for the idea cards (built in fruit.js).

function addSky( scene ) {
    const geometry = new THREE.SphereGeometry( 400, 32, 16 );
    const material = new THREE.ShaderMaterial( {
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
            topColor: { value: new THREE.Color( 0x1c2746 ) },
            midColor: { value: new THREE.Color( 0x6a4a6e ) },
            bottomColor: { value: new THREE.Color( 0xe08a4e ) }
        },
        vertexShader: `
            varying vec3 vPosition;
            void main() {
                vPosition = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
            }
        `,
        fragmentShader: `
            varying vec3 vPosition;
            uniform vec3 topColor;
            uniform vec3 midColor;
            uniform vec3 bottomColor;
            void main() {
                float h = normalize( vPosition ).y * 0.5 + 0.5;
                vec3 lower = mix( bottomColor, midColor, smoothstep( 0.0, 0.45, h ) );
                vec3 color = mix( lower, topColor, smoothstep( 0.35, 0.85, h ) );
                gl_FragColor = vec4( color, 1.0 );
            }
        `
    } );
    scene.add( new THREE.Mesh( geometry, material ) );
}

function makeStarTexture() {
    const size = 64;
    const canvas = document.createElement( "canvas" );
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext( "2d" );
    const grad = ctx.createRadialGradient( 32, 32, 0, 32, 32, 32 );
    grad.addColorStop( 0, "rgba( 255, 255, 255, 1 )" );
    grad.addColorStop( 0.3, "rgba( 255, 255, 255, 0.6 )" );
    grad.addColorStop( 1, "rgba( 255, 255, 255, 0 )" );
    ctx.fillStyle = grad;
    ctx.fillRect( 0, 0, size, size );
    const texture = new THREE.CanvasTexture( canvas );
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

// A field of stars scattered across the upper sky, drifting gently. Fog is
// disabled on them so the haze never swallows them.
function addStars( scene ) {
    const count = 1400;
    const radius = 390;
    const positions = new Float32Array( count * 3 );
    const colors = new Float32Array( count * 3 );
    const color = new THREE.Color();

    for ( let i = 0; i < count; i++ ) {
        const theta = Math.random() * Math.PI * 2;
        const y = 0.06 + Math.random() * 0.94;          // keep them above the horizon
        const ring = Math.sqrt( Math.max( 0, 1 - y * y ) );
        positions[ i * 3 ] = Math.cos( theta ) * ring * radius;
        positions[ i * 3 + 1 ] = y * radius;
        positions[ i * 3 + 2 ] = Math.sin( theta ) * ring * radius;

        const warm = Math.random() < 0.15;
        color.setHSL( warm ? 0.09 : 0.6, warm ? 0.4 : 0.25, 0.7 + Math.random() * 0.3 );
        colors[ i * 3 ] = color.r;
        colors[ i * 3 + 1 ] = color.g;
        colors[ i * 3 + 2 ] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute( "position", new THREE.BufferAttribute( positions, 3 ) );
    geometry.setAttribute( "color", new THREE.BufferAttribute( colors, 3 ) );

    const material = new THREE.PointsMaterial( {
        map: makeStarTexture(),
        size: 2.6,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false
    } );

    const stars = new THREE.Points( geometry, material );
    stars.renderOrder = 1;
    scene.add( stars );
}

export function buildGarden( scene ) {
    // Gentle exponential haze for soft atmospheric depth.
    scene.fog = new THREE.FogExp2( 0x3c3550, 0.021 );

    addSky( scene );
    addStars( scene );
    buildStructures( scene );
    buildLighting( scene );
    buildPlanting( scene );
    buildWater( scene );

    return { hangPoints: cardHangPoints() };
}
