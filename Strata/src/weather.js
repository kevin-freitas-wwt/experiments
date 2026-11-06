import * as THREE from 'three';

const N = 1400, W = 18, H = 14;

// Rain or snow falling through a box around the camera, oriented to the local up. Every drop lives in the
// shader: a seed per line, wrapped on time, so nothing is updated on the CPU but a few uniforms.
export class Precip {
    constructor( scene ) {
        const geo = new THREE.BufferGeometry();
        const seed = new Float32Array( N * 2 * 3 ), end = new Float32Array( N * 2 );
        for ( let i = 0; i < N; i++ ) {
            const s = [ Math.random(), Math.random(), Math.random() ];
            seed.set( s, i * 6 ); seed.set( s, i * 6 + 3 ); end[ i * 2 + 1 ] = 1;
        }
        geo.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( N * 2 * 3 ), 3 ) );
        geo.setAttribute( 'seed', new THREE.BufferAttribute( seed, 3 ) );
        geo.setAttribute( 'end', new THREE.BufferAttribute( end, 1 ) );
        this.u = { time: { value: 0 }, amount: { value: 0 }, snow: { value: 0 }, tint: { value: new THREE.Color( 0xdde6f0 ) } };
        const mat = new THREE.ShaderMaterial( {
            transparent: true, depthWrite: false, uniforms: this.u,
            vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 seed; attribute float end;
uniform float time; uniform float snow; uniform float amount;
varying float vA;
void main() {
    float speed = mix( 16.0, 1.6, snow ), len = mix( 0.7, 0.05, snow );
    float sway = snow * ( sin( time * 1.3 + seed.x * 40.0 ) * 0.5 + sin( time * 0.7 + seed.z * 30.0 ) * 0.3 );
    vec3 p = vec3( ( seed.x - 0.5 ) * ${W.toFixed( 1 )} + sway, mod( seed.y * ${H.toFixed( 1 )} - time * speed * ( 0.8 + seed.z * 0.4 ), ${H.toFixed( 1 )} ) - ${( H / 2 ).toFixed( 1 )} + end * len, ( seed.z - 0.5 ) * ${W.toFixed( 1 )} );
    float d = length( p.xz );
    vA = amount * ( 1.0 - smoothstep( ${( W * 0.3 ).toFixed( 1 )}, ${( W * 0.5 ).toFixed( 1 )}, d ) ) * step( seed.x * seed.z * 4.0, amount * 1.2 + 0.05 );
    gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
    #include <logdepthbuf_vertex>
}`,
            fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float snow; uniform vec3 tint; varying float vA;
void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4( tint, vA * mix( 0.45, 0.85, snow ) );
}`,
        } );
        this.mesh = new THREE.LineSegments( geo, mat );
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 6;
        this.mesh.visible = false;
        scene.add( this.mesh );
        this.amount = 0;
    }

    // target 0..1 precipitation, snow 0..1, frameQ the local frame (y up), pos the camera.
    update( dt, target, snow, frameQ, pos ) {
        this.amount += ( target - this.amount ) * Math.min( 1, dt * 0.5 );
        this.u.time.value += dt;
        this.u.amount.value = this.amount;
        this.u.snow.value += ( snow - this.u.snow.value ) * Math.min( 1, dt * 2 );
        this.mesh.visible = this.amount > 0.02;
        this.mesh.position.copy( pos );
        this.mesh.quaternion.copy( frameQ );
    }
}

// Aurora curtains: a band of animated light near each pole of an atmosphere world (about 68 degrees,
// a little above the air), green below shading to violet, additive and only where it is night.
const AURORA_VS = `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal; varying float vV;
void main() {
    vLocal = position; vV = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    #include <logdepthbuf_vertex>
}`;
const AURORA_FS = `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float time; uniform vec3 sunLocal; uniform float wall; uniform float night;
varying vec3 vLocal; varying float vV;
void main() {
    #include <logdepthbuf_fragment>
    float th = wall > 0.5 ? vLocal.x * 0.00006 : atan( vLocal.z, vLocal.x );
    float drift = sin( th * 1.7 + time * 0.07 ) * 2.0;
    float n = sin( th * 3.0 + time * 0.1 ) * 0.5 + sin( th * 7.3 - time * 0.23 + drift ) * 0.35 + sin( th * 19.0 + time * 0.5 + drift ) * 0.15;
    float env = smoothstep( 0.15, 0.75, 0.5 + 0.5 * sin( th * 0.9 + time * 0.05 ) + 0.25 * sin( th * 2.3 - time * 0.03 ) );
    float c = smoothstep( 0.25, 0.95, n * 0.5 + 0.5 ) * env;
    float tall = 0.55 + 0.45 * ( 0.5 + 0.5 * sin( th * 5.1 + time * 0.3 + drift ) );
    float v = vV / tall;
    float shape = pow( max( 1.0 - v, 0.0 ), 1.6 ) * smoothstep( 0.0, 0.3, v );
    vec3 col = mix( vec3( 0.25, 1.0, 0.5 ), vec3( 0.6, 0.3, 1.0 ), smoothstep( 0.25, 0.9, v ) );
    float dark = wall > 0.5 ? night : smoothstep( -0.02, -0.18, dot( normalize( vLocal ), sunLocal ) );
    gl_FragColor = vec4( col * c * shape * dark * 1.1, 1.0 );
}`;

function auroraMaterial( flat ) {
    return new THREE.ShaderMaterial( {
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { time: { value: 0 }, sunLocal: { value: new THREE.Vector3( 0, 1, 0 ) }, wall: { value: flat ? 1 : 0 }, night: { value: 0 } },
        vertexShader: AURORA_VS, fragmentShader: AURORA_FS,
    } );
}

export const AURORA_MATS = [];

export function addAuroras( body ) {
    const r = body.radius * 1.04 + 2500, lat = 68 * Math.PI / 180, rho = r * Math.cos( lat ), h = Math.max( 1500, body.radius * 0.05 );
    const mat = auroraMaterial( false );
    body.aurora = mat;
    AURORA_MATS.push( mat );
    for ( const sgn of [ 1, -1 ] ) {
        const geo = new THREE.CylinderGeometry( rho, rho, h, 128, 1, true );
        const mesh = new THREE.Mesh( geo, mat );
        mesh.position.y = sgn * r * Math.sin( lat );
        mesh.renderOrder = 3;
        mesh.frustumCulled = false;
        body.group.add( mesh );
    }
}

