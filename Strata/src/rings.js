import * as THREE from 'three';

const REL = new THREE.Vector3();
import { hash2 } from './noise.js';
import { rockMat, instanceMat, fadeIn } from './materials.js';

const CAP = 3500, CELL = 2000;
const TINTS = [ [ 0xd9c7a6, 0xb89b74 ], [ 0xe6eef4, 0xb9cfe0 ], [ 0x9a948c, 0x6f6a64 ], [ 0xd8b08a, 0x8a5a3a ] ];

const discMaterial = ( lanes, colors, R, seedF ) => new THREE.ShaderMaterial( {
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { lanes: { value: lanes }, laneColor: { value: colors }, R: { value: R }, nearCut: { value: 6000 }, seedF: { value: seedF }, fade: { value: 1 } },
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vLocal; varying vec3 vWorld;
void main(){ vLocal = position.xy; vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec4 lanes[ 4 ]; uniform vec3 laneColor[ 4 ]; uniform float R; uniform float nearCut; uniform float seedF; uniform float fade;
varying vec2 vLocal; varying vec3 vWorld;
void main(){
#include <logdepthbuf_fragment>
    float r = length( vLocal ) / R;
    vec3 c = vec3( 0.0 ); float a = 0.0;
    for ( int i = 0; i < 4; i++ ) {
        vec4 L = lanes[ i ];
        if ( L.y > L.x && r >= L.x && r <= L.y ) {
            float t = ( r - L.x ) / ( L.y - L.x );
            float edge = smoothstep( 0.0, 0.1, t ) * smoothstep( 0.0, 0.1, 1.0 - t );
            float band = 0.72 + 0.28 * sin( r * L.w * 60.0 + seedF ) * sin( r * L.w * 11.0 + seedF * 0.5 );
            float gaps = step( 0.12, fract( r * L.w * 9.0 + seedF ) );
            a = max( a, L.z * edge * band * ( 0.35 + 0.65 * gaps ) );
            c = laneColor[ i ];
        }
    }
    if ( a <= 0.001 ) discard;
    a *= smoothstep( nearCut * 0.4, nearCut, distance( vWorld, cameraPosition ) ) * fade;
    gl_FragColor = vec4( c, a );
}`,
} );

export class RingField {
    constructor( space, body, seed ) {
        this.space = space; this.body = body; this.seed = seed;
        const r = ( i, j ) => hash2( i, j, seed );
        const R = body.radius;
        this.normal = new THREE.Vector3( ( r( 1, 1 ) - 0.5 ) * 0.9, 1, ( r( 1, 2 ) - 0.5 ) * 0.9 ).normalize();
        this.u = new THREE.Vector3( 1, 0, 0 ).cross( this.normal ).normalize();
        this.v = new THREE.Vector3().crossVectors( this.normal, this.u );
        const nLanes = 1 + Math.floor( r( 2, 1 ) * 4 );
        this.lanes = [];
        let edge = 1.35 + r( 2, 2 ) * 0.4;
        for ( let i = 0; i < nLanes && edge < 3.4; i++ ) {
            const width = 0.12 + r( 3, i ) * 0.55;
            const tint = TINTS[ Math.floor( r( 4, i ) * TINTS.length ) ];
            this.lanes.push( { r0: edge, r1: edge + width, thickness: 15 + r( 5, i ) * 260, density: 0.25 + r( 6, i ) * 0.75, opacity: 0.3 + r( 7, i ) * 0.5, band: 1 + r( 8, i ) * 5, color: tint[ 0 ], rock: tint[ 1 ] } );
            edge += width + 0.05 + r( 9, i ) * 0.35;
        }
        const lanesU = [ 0, 1, 2, 3 ].map( ( i ) => { const L = this.lanes[ i ]; return L ? new THREE.Vector4( L.r0, L.r1, L.opacity, L.band ) : new THREE.Vector4( 0, 0, 0, 0 ); } );
        const colorsU = [ 0, 1, 2, 3 ].map( ( i ) => new THREE.Color( this.lanes[ i ] ? this.lanes[ i ].color : 0 ) );
        const outer = this.lanes[ this.lanes.length - 1 ].r1;
        this.disc = new THREE.Mesh( new THREE.RingGeometry( R * this.lanes[ 0 ].r0 * 0.98, R * outer * 1.02, 160, 1 ), discMaterial( lanesU, colorsU, R, seed % 1000 ) );
        this.disc.quaternion.setFromUnitVectors( new THREE.Vector3( 0, 0, 1 ), this.normal );
        this.disc.position.copy( body.pos );
        this.disc.frustumCulled = false;
        space.scene.add( this.disc );
        this.inner = R * this.lanes[ 0 ].r0; this.outer = R * outer;
        this.mesh = new THREE.InstancedMesh( new THREE.IcosahedronGeometry( 1, 1 ), instanceMat, CAP );
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute( new Float32Array( CAP * 3 ).fill( 0.6 ), 3 );
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        space.scene.add( this.mesh );
        this.cells = new Map();
        this.rocks = [];
        this.lastKey = '';
    }

    laneAt( rr ) {
        const q = rr / this.body.radius;
        return this.lanes.find( ( L ) => q >= L.r0 && q <= L.r1 ) || null;
    }

    update( camPos ) {
        const rel = REL.copy( camPos ).sub( this.body.pos );
        const h = rel.dot( this.normal ), x = rel.dot( this.u ), z = rel.dot( this.v );
        const rr = Math.hypot( x, z ), a = Math.atan2( z, x );
        const range = 7000 * Math.max( 0.75, this.space.scale );
        this.disc.material.uniforms.fade.value = Math.min( 1, Math.max( 0.3, ( Math.abs( h ) - 400 ) / 3000 + ( rr < this.inner - 3000 || rr > this.outer + 3000 ? 1 : 0 ) ) );
        if ( Math.abs( h ) > range * 1.5 || rr < this.inner - range || rr > this.outer + range ) { if ( this.cells.size ) this.clear(); return; }
        const ir0 = Math.floor( ( rr - range ) / CELL ), ir1 = Math.floor( ( rr + range ) / CELL );
        const wanted = new Set();
        for ( let ir = ir0; ir <= ir1; ir++ ) {
            const rc = ( ir + 0.5 ) * CELL;
            if ( rc < this.inner - CELL || rc > this.outer + CELL ) continue;
            const nA = Math.max( 8, Math.ceil( 2 * Math.PI * rc / CELL ) ), da = Math.PI * 2 / nA;
            const span = Math.min( nA / 2, Math.ceil( range / ( rc * da ) ) + 1 );
            const ia0 = Math.floor( a / da );
            for ( let k = -span; k <= span; k++ ) {
                const ia = ( ( ia0 + k ) % nA + nA ) % nA;
                const key = `${ir}:${ia}`;
                wanted.add( key );
                if ( ! this.cells.has( key ) ) this.spawnCell( key, ir, ia, nA, da );
            }
        }
        for ( const key of [ ...this.cells.keys() ] ) if ( ! wanted.has( key ) ) this.dropCell( key );
        this.rebuild();
        this.near( camPos );
    }

    spawnCell( key, ir, ia, nA, da ) {
        const rocks = [];
        const r = ( i ) => hash2( ir * 7919 + ia, i, this.seed );
        const rc0 = ir * CELL, a0 = ia * da;
        const lane = this.laneAt( rc0 + CELL / 2 );
        if ( lane ) {
            const area = ( rc0 + CELL / 2 ) * da * CELL / 1e6;
            const n = Math.round( area * lane.density * 28 * ( 0.6 + r( 0 ) * 0.8 ) );
            for ( let i = 0; i < n && rocks.length < 400; i++ ) {
                const rr = rc0 + r( i * 4 + 1 ) * CELL, aa = a0 + r( i * 4 + 2 ) * da;
                if ( ! this.laneAt( rr ) ) continue;
                const hh = ( r( i * 4 + 3 ) - 0.5 ) * 2 * lane.thickness;
                const radius = 1.5 + Math.pow( r( i * 4 + 4 ), 3 ) * 45;
                const pos = this.body.pos.clone().addScaledVector( this.u, Math.cos( aa ) * rr ).addScaledVector( this.v, Math.sin( aa ) * rr ).addScaledVector( this.normal, hh );
                const size = 8 + Math.floor( r( i * 4 + 5 ) * 8 );
                rocks.push( { id: `${key}/${i}`, i: ( ir * 131 + ia * 17 + i ) >>> 0, ring: this, pos, off: pos.clone().sub( this.body.pos ), radius, size, voxel: radius / ( 0.42 * size ), color: lane.rock, mesh: null, want: false, vol: null, frame: null, rot: new THREE.Euler( r( i * 4 + 6 ) * 6, r( i * 4 + 7 ) * 6, 0 ), spin: new THREE.Vector3( r( i * 4 + 8 ) - 0.5, r( i * 4 + 9 ) - 0.5, 0 ).multiplyScalar( 0.2 ) } );
            }
        }
        this.cells.set( key, rocks );
    }

    dropCell( key ) {
        for ( const rk of this.cells.get( key ) ) this.unload( rk );
        this.cells.delete( key );
    }

    unload( rk ) {
        rk.want = false;
        if ( rk.mesh ) { this.space.scene.remove( rk.mesh, rk.frame ); rk.mesh.geometry.dispose(); rk.mesh = null; rk.frame = null; }
    }

    rebuild() {
        const d = new THREE.Object3D(), color = new THREE.Color();
        let n = 0;
        this.rocks = [];
        for ( const rocks of this.cells.values() ) for ( const rk of rocks ) {
            if ( n >= CAP ) break;
            this.rocks.push( rk );
            d.position.copy( rk.pos );
            d.rotation.copy( rk.rot );
            d.scale.setScalar( rk.mesh ? 0.0001 : rk.radius );
            d.updateMatrix();
            this.mesh.setMatrixAt( n, d.matrix );
            this.mesh.setColorAt( n, color.set( rk.color ) );
            n++;
        }
        this.mesh.count = n;
        this.mesh.instanceMatrix.needsUpdate = true;
        if ( this.mesh.instanceColor ) this.mesh.instanceColor.needsUpdate = true;
    }

    near( camPos ) {
        const nearR = 900 * Math.max( 0.75, this.space.scale );
        for ( const rk of this.rocks ) {
            const d = rk.pos.distanceTo( camPos );
            if ( d < nearR && rk.radius > 4 && ! rk.want ) {
                rk.want = true;
                this.space.pool.submit( { type: 'rock', size: rk.size, seed: ( this.seed + rk.i ) % 100000, i: rk.i, color: [ rk.color >> 16 & 255, rk.color >> 8 & 255, rk.color & 255 ] }, { priority: d / 50, tag: 'rock' } ).then( ( data ) => {
                    if ( ! rk.want ) return;
                    const g = new THREE.BufferGeometry();
                    g.setAttribute( 'position', new THREE.BufferAttribute( data.pos, 3 ) );
                    g.setAttribute( 'color', new THREE.BufferAttribute( data.col, 3, true ) );
                    g.setAttribute( 'normal', new THREE.BufferAttribute( data.nrm, 3, true ) );
                    g.setIndex( new THREE.BufferAttribute( data.idx, 1 ) );
                    g.computeBoundingSphere();
                    rk.mesh = new THREE.Mesh( g, rockMat );
                    rk.mesh.position.copy( rk.pos );
                    rk.mesh.scale.setScalar( rk.voxel );
                    rk.mesh.rotation.copy( rk.rot );
                    rk.vol = data.vol;
                    rk.frame = new THREE.Group();
                    rk.frame.position.copy( rk.pos );
                    rk.frame.rotation.copy( rk.rot );
                    this.space.scene.add( rk.mesh, rk.frame );
                    fadeIn( rk.mesh, 0.4 );
                    this.rebuild();
                } );
            } else if ( d > nearR * 1.6 && rk.want ) { this.unload( rk ); this.rebuild(); }
        }
    }

    tick( dt ) {
        for ( const rk of this.rocks ) if ( rk.mesh ) { rk.rot.x += rk.spin.x * dt; rk.rot.y += rk.spin.y * dt; rk.mesh.rotation.copy( rk.rot ); rk.frame.rotation.copy( rk.rot ); }
    }

    rebase( delta ) {
        this.disc.position.sub( delta );
        for ( const rocks of this.cells.values() ) for ( const rk of rocks ) { rk.pos.sub( delta ); if ( rk.mesh ) { rk.mesh.position.sub( delta ); rk.frame.position.sub( delta ); } }
        this.rebuild();
    }

    clear() {
        for ( const key of [ ...this.cells.keys() ] ) this.dropCell( key );
        this.rebuild();
    }

    dispose() {
        this.clear();
        this.space.scene.remove( this.disc, this.mesh );
        this.disc.geometry.dispose();
        this.disc.material.dispose();
    }
}
