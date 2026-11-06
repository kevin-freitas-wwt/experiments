import * as THREE from 'three';
import { G, sample } from './galaxy.js';

const SHELL = 1e8, N = 14000, BAND = 3000;

const material = ( tex, size, gain ) => new THREE.ShaderMaterial( {
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    uniforms: { map: { value: tex }, opacity: { value: 0 }, px: { value: size }, gain: { value: gain } },
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float bright; attribute vec3 tint; uniform float px; varying vec3 vCol; varying float vA;
void main() {
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
    gl_PointSize = px * ( 0.6 + 0.9 * bright );
    vCol = tint; vA = bright;
    #include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map; uniform float opacity; uniform float gain; varying vec3 vCol; varying float vA;
void main() {
    #include <logdepthbuf_fragment>
    vec4 t = texture2D( map, gl_PointCoord );
    gl_FragColor = vec4( vCol * t.rgb * t.a * vA * gain * opacity, 1.0 );
}`,
} );

// The night sky: a sample of the galaxy's own density, placed on a shell around the camera from wherever
// you are, so the band, bulge and clusters sit where the real systems are and shift as you cross the arms.
export class StarField {
    constructor( scene, seed, glow ) {
        let s = ( seed * 2654435761 ) >>> 0;
        const rng = () => ( s = ( s * 1664525 + 1013904223 ) >>> 0 ) / 4294967296;
        this.samples = sample( N + BAND, seed, rng );
        this.group = new THREE.Group();
        this.group.frustumCulled = false;
        this.stars = this.cloud( this.samples.slice( 0, N ), material( glow, 4.5, 1.5 ) );
        this.band = this.cloud( this.samples.slice( N ), material( glow, 52, 0.08 ) );
        this.group.add( this.band, this.stars );
        scene.add( this.group );
        this.last = null;
        this.place( new THREE.Vector3() );
    }

    cloud( pts, mat ) {
        const g = new THREE.BufferGeometry();
        g.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( pts.length * 3 ), 3 ) );
        g.setAttribute( 'tint', new THREE.BufferAttribute( new Float32Array( pts.flatMap( ( p ) => p.tint ) ), 3 ) );
        g.setAttribute( 'bright', new THREE.BufferAttribute( new Float32Array( pts.length ), 1 ) );
        const m = new THREE.Points( g, mat );
        m.frustumCulled = false;
        m.userData.pts = pts;
        return m;
    }

    // Re-aims every point from a home-local position; called when you have moved 1% of the galaxy.
    place( homeLocal ) {
        if ( this.last && this.last.distanceTo( homeLocal ) < 0.01 * G ) return;
        this.last = ( this.last || new THREE.Vector3() ).copy( homeLocal );
        for ( const m of [ this.stars, this.band ] ) {
            const pos = m.geometry.attributes.position, br = m.geometry.attributes.bright, pts = m.userData.pts;
            for ( let i = 0; i < pts.length; i++ ) {
                const p = pts[ i ], dx = p.x - homeLocal.x, dy = p.y - homeLocal.y, dz = p.z - homeLocal.z;
                const d = Math.hypot( dx, dy, dz ) || 1;
                pos.setXYZ( i, dx / d * SHELL, dy / d * SHELL, dz / d * SHELL );
                br.setX( i, Math.min( 1.6, Math.max( 0.12, 0.42 + 0.22 * Math.log10( ( 0.12 * G / d ) ** 2 ) ) ) );
            }
            pos.needsUpdate = true; br.needsUpdate = true;
        }
    }

    set opacity( v ) { this.stars.material.uniforms.opacity.value = v; this.band.material.uniforms.opacity.value = v; }
    get opacity() { return this.stars.material.uniforms.opacity.value; }
}
