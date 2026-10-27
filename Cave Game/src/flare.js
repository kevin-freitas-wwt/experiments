import * as THREE from "three";
import { seeded, noise3 } from "./noise.js";
import { CELL } from "./sections.js";

// A dropped road flare: a short red stick on the floor, a flickering red
// point light at its tip, and a column of soft white smoke.

const SMOKE = 32;
const SMOKE_LIFE = 3.2;

const smokeMaterial = new THREE.ShaderMaterial( {
    blending: THREE.NormalBlending,
    depthWrite: false,
    fragmentShader: `
        varying float vAge;
        void main() {
            float d = length( gl_PointCoord - 0.5 ) * 2.0;
            float soft = smoothstep( 1.0, 0.2, d );
            float fade = smoothstep( 0.0, 0.15, vAge ) * ( 1.0 - smoothstep( 0.5, 1.0, vAge ) );
            vec3 colour = mix( vec3( 1.0, 0.45, 0.35 ), vec3( 0.9, 0.9, 0.92 ), smoothstep( 0.0, 0.4, vAge ) );
            gl_FragColor = vec4( colour, soft * fade * 0.28 );
        }`,
    transparent: true,
    vertexShader: `
        attribute float age;
        varying float vAge;
        void main() {
            vAge = age;
            vec4 mv = modelViewMatrix * vec4( position, 1.0 );
            gl_PointSize = ( 0.35 + age * 1.6 ) * 260.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
        }`
} );

const stickMaterial = new THREE.MeshStandardMaterial( { color: 0x9b1c1c, roughness: 0.7 } );
const tipMaterial = new THREE.MeshStandardMaterial( { color: 0xff6a3a, emissive: 0xff2d12, emissiveIntensity: 6 } );

// Drops a flare somewhere on the floor of `cell`. The light goes on the level
// root rather than the cell, so cell culling never changes the shader's light
// count. Returns the light and a per-frame update.
export function buildFlare( cell, root ) {
    const rand = seeded( ( cell.x * 92821 ^ cell.y * 68917 ^ cell.z * 31337 ^ 0xf1a5e ) >>> 0 );
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3( 0, -1, 0 );
    const origin = new THREE.Vector3();
    let spot = new THREE.Vector3( 0, 0, 0 );

    cell.group.updateMatrixWorld( true );
    for ( let i = 0; i < 12; i++ ) {
        const x = ( rand() - 0.5 ) * 3.6;
        const z = ( rand() - 0.5 ) * 3.6;
        origin.set( cell.x * CELL + x, cell.y * CELL + CELL - 0.3, cell.z * CELL + z );
        ray.set( origin, down );
        ray.far = CELL;
        const hit = ray.intersectObjects( cell.meshes, false )[ 0 ];
        if ( hit && hit.point.y - cell.y * CELL < 1.2 ) {
            spot = hit.point.clone().sub( cell.group.position );
            break;
        }
    }

    const group = new THREE.Group();
    group.position.copy( spot );
    group.rotation.y = rand() * Math.PI * 2;
    cell.group.add( group );

    const stick = new THREE.Mesh( new THREE.CylinderGeometry( 0.035, 0.035, 0.32, 8 ), stickMaterial );
    stick.rotation.z = Math.PI / 2 - 0.12;
    stick.position.set( 0, 0.06, 0 );
    group.add( stick );

    const tip = new THREE.Mesh( new THREE.SphereGeometry( 0.05, 8, 6 ), tipMaterial );
    tip.position.set( 0.17, 0.085, 0 );
    group.add( tip );

    const light = new THREE.PointLight( 0xff3318, 14, 10, 2 );
    light.position.copy( tip.position ).add( group.position ).add( cell.group.position );
    light.position.y += 0.25;
    root.add( light );

    const positions = new Float32Array( SMOKE * 3 );
    const ages = new Float32Array( SMOKE );
    const drift = [];
    for ( let i = 0; i < SMOKE; i++ ) {
        ages[ i ] = ( i / SMOKE ) * SMOKE_LIFE;
        drift.push( { x: ( rand() - 0.5 ) * 0.25, z: ( rand() - 0.5 ) * 0.25, up: 0.45 + rand() * 0.3 } );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute( "position", new THREE.BufferAttribute( positions, 3 ) );
    geo.setAttribute( "age", new THREE.BufferAttribute( new Float32Array( SMOKE ), 1 ) );
    const smoke = new THREE.Points( geo, smokeMaterial );
    smoke.frustumCulled = false;
    group.add( smoke );

    const seed = rand() * 100;
    const ageAttr = geo.attributes.age;
    const posAttr = geo.attributes.position;

    function update( delta, elapsed ) {
        const flicker = 0.55 + noise3( elapsed * 9 + seed, 0, 0 ) * 0.6 + noise3( elapsed * 31, seed, 0 ) * 0.25;
        light.intensity = 14 * flicker;
        tipMaterial.emissiveIntensity = 4 + flicker * 4;

        for ( let i = 0; i < SMOKE; i++ ) {
            ages[ i ] += delta;
            if ( ages[ i ] >= SMOKE_LIFE ) {
                ages[ i ] -= SMOKE_LIFE;
            }
            const t = ages[ i ];
            const sway = Math.sin( t * 1.7 + i ) * 0.08 * t;
            posAttr.setXYZ( i, tip.position.x + drift[ i ].x * t + sway, tip.position.y + drift[ i ].up * t, tip.position.z + drift[ i ].z * t );
            ageAttr.setX( i, t / SMOKE_LIFE );
        }
        posAttr.needsUpdate = true;
        ageAttr.needsUpdate = true;
    }

    return { light, update };
}
