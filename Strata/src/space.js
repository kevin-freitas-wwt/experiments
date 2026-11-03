import * as THREE from 'three';
import { hash2 } from './noise.js';
import { bodyMat, rockMat, fadeIn } from './materials.js';
import { KINDS as SURFACE, surfaceAt } from './planet.js';

const KINDS = [ 'gas', 'lush', 'icy', 'rocky', 'ember' ];
const NAMES = [ 'Oriel', 'Tamsin', 'Halvard', 'Nerys', 'Cordan', 'Ilse', 'Brannoc', 'Sable', 'Ysolde', 'Marrow' ];
const DETAILS = [ 2, 4, 6, 7 ];
const PATCH_N = 97;

const rimMaterial = ( color ) => new THREE.ShaderMaterial( {
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { tint: { value: new THREE.Color( color ) }, fade: { value: 1 } },
    vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4( position, 1.0 ); vN = normalize( normalMatrix * normal ); vV = normalize( -mv.xyz ); gl_Position = projectionMatrix * mv;\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform vec3 tint; uniform float fade; varying vec3 vN; varying vec3 vV; void main(){\n#include <logdepthbuf_fragment>\nfloat f = pow( 1.0 - max( 0.0, dot( vN, vV ) ), 3.0 ); gl_FragColor = vec4( tint, f * 0.9 * fade ); }',
} );

function glowTexture() {
    const c = document.createElement( 'canvas' );
    c.width = c.height = 64;
    const g = c.getContext( '2d' ), grd = g.createRadialGradient( 32, 32, 0, 32, 32, 32 );
    grd.addColorStop( 0, 'rgba(255,255,255,1)' );
    grd.addColorStop( 0.25, 'rgba(255,240,210,0.8)' );
    grd.addColorStop( 1, 'rgba(255,220,160,0)' );
    g.fillStyle = grd;
    g.fillRect( 0, 0, 64, 64 );
    return new THREE.CanvasTexture( c );
}

export class Space {
    constructor( scene, pool, seed, radius, sunDir ) {
        this.scene = scene; this.pool = pool; this.seed = seed;
        this.scale = radius / 8;
        this.glow = glowTexture();
        this.makeBodies();
        this.makeRocks();
        this.makeShips();
        this.makeSky( sunDir );
        this.timer = 0;
    }

    rnd( i, j ) {
        return hash2( i, j, this.seed + 4242 );
    }

    makeBodies() {
        this.bodies = [];
        const n = 5;
        for ( let i = 0; i < n; i++ ) {
            const kind = KINDS[ i ], gas = kind === 'gas';
            const radius = gas ? 9000 : 1600 + this.rnd( i, 1 ) * 4800;
            const dist = 36000 + i * 16000 + this.rnd( i, 2 ) * 9000;
            const az = ( i / n ) * Math.PI * 2 + this.rnd( i, 3 ) * 1.1, el = 0.14 + this.rnd( i, 4 ) * 0.6;
            const pos = new THREE.Vector3( Math.cos( az ) * Math.cos( el ) * dist, Math.sin( el ) * dist + radius, Math.sin( az ) * Math.cos( el ) * dist );
            const group = new THREE.Group();
            group.position.copy( pos );
            const mesh = new THREE.Mesh( new THREE.IcosahedronGeometry( radius, 1 ), bodyMat );
            group.add( mesh );
            const body = { i, kind, name: NAMES[ ( this.seed + i * 3 ) % NAMES.length ], radius, pos, group, mesh, level: -1, want: -1, geos: new Map(), spin: 0.004 + this.rnd( i, 5 ) * 0.01, seed: this.seed + i * 17, patch: null, patchWant: 0 };
            if ( kind !== 'rocky' && kind !== 'ember' ) {
                const shellR = gas ? radius * 1.045 : radius * ( 1 + SURFACE[ kind ].amp * 2 ) * 1.015;
                const rim = new THREE.Mesh( new THREE.SphereGeometry( shellR, 48, 32 ), rimMaterial( gas ? 0xf0cc8a : kind === 'icy' ? 0xbfe0ff : 0x7fb4ff ) );
                rim.userData.shellR = shellR;
                group.add( rim );
                body.rim = rim;
            }
            if ( gas ) {
                const ring = new THREE.Mesh( new THREE.RingGeometry( radius * 1.5, radius * 2.4, 128 ), new THREE.MeshBasicMaterial( { color: 0xd9c7a6, side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthWrite: false } ) );
                ring.rotation.x = Math.PI / 2 + 0.35;
                ring.rotation.y = 0.4;
                group.add( ring );
                body.ringNormal = new THREE.Vector3( 0, 1, 0 ).applyEuler( ring.rotation );
            }
            this.scene.add( group );
            this.bodies.push( body );
            this.requestBody( body, 0 );
        }
    }

    requestBody( body, level ) {
        body.want = level;
        if ( body.geos.has( level ) ) { this.applyBody( body, level ); return; }
        this.pool.submit( { type: 'body', kind: body.kind, radius: body.radius, detail: DETAILS[ level ], seed: body.seed, level, i: body.i }, { priority: 50 - level * 10, tag: 'body' } )
            .then( ( data ) => {
                const g = new THREE.BufferGeometry();
                g.setAttribute( 'position', new THREE.BufferAttribute( data.pos, 3 ) );
                g.setAttribute( 'color', new THREE.BufferAttribute( data.col, 3, true ) );
                g.setIndex( new THREE.BufferAttribute( data.idx, 1 ) );
                g.computeVertexNormals();
                g.computeBoundingSphere();
                body.geos.set( level, g );
                if ( body.want === level ) this.applyBody( body, level );
            } );
    }

    applyBody( body, level ) {
        const g = body.geos.get( level );
        if ( ! g || body.level === level ) return;
        const old = body.mesh, first = body.level < 0;
        const next = new THREE.Mesh( g, bodyMat );
        body.group.add( next );
        body.mesh = next;
        body.level = level;
        if ( first ) { body.group.remove( old ); old.geometry.dispose(); return; }
        fadeIn( next, 0.7, () => body.group.remove( old ) );
    }

    surfaceRadius( body, worldPos ) {
        const local = body.group.worldToLocal( worldPos.clone() ).normalize();
        return surfaceAt( body.kind, SURFACE[ body.kind ], local.toArray(), body.seed, body.radius, 6 ).r;
    }

    updatePatch( body, camPos ) {
        const d = camPos.distanceTo( body.pos ), alt = Math.max( 0, d - this.surfaceRadius( body, camPos ) );
        const wantPatch = d / body.radius < 1.6 * this.scale && body.kind !== 'gas';
        if ( ! wantPatch ) {
            if ( body.patch ) { body.group.remove( body.patch ); body.patch.geometry.dispose(); body.patch = null; }
            return;
        }
        const local = body.group.worldToLocal( camPos.clone() ).normalize();
        const ang = Math.min( 0.5, Math.max( 0.025, alt / body.radius * 2.2 + 0.015 ) );
        const p = body.patch;
        if ( p && p.userData.center.angleTo( local ) < p.userData.ang * 0.35 && Math.abs( Math.log( ang / p.userData.ang ) ) < 0.3 ) return;
        const stamp = ++body.patchWant;
        this.pool.submit( { type: 'patch', kind: body.kind, radius: body.radius, seed: body.seed, center: local.toArray(), ang, n: PATCH_N }, { priority: 1, tag: 'patch' } ).then( ( data ) => {
            if ( stamp !== body.patchWant ) return;
            const g = new THREE.BufferGeometry();
            g.setAttribute( 'position', new THREE.BufferAttribute( data.pos, 3 ) );
            g.setAttribute( 'color', new THREE.BufferAttribute( data.col, 3, true ) );
            g.setIndex( new THREE.BufferAttribute( data.idx, 1 ) );
            g.computeVertexNormals();
            g.computeBoundingSphere();
            const m = new THREE.Mesh( g, bodyMat );
            m.userData.center = local.clone();
            m.userData.ang = ang;
            const old = body.patch;
            body.patch = m;
            body.group.add( m );
            fadeIn( m, 0.5, () => { if ( old ) { body.group.remove( old ); old.geometry.dispose(); } } );
        } );
    }

    makeRocks() {
        const gas = this.bodies[ 0 ], n = 110;
        this.rocks = [];
        const u = new THREE.Vector3( 1, 0, 0 ).cross( gas.ringNormal ).normalize(), v = gas.ringNormal.clone().cross( u );
        this.rockFar = new THREE.InstancedMesh( new THREE.IcosahedronGeometry( 1, 1 ), rockMat, n );
        this.rockFar.instanceColor = new THREE.InstancedBufferAttribute( new Float32Array( n * 3 ), 3 );
        const d = new THREE.Object3D();
        for ( let i = 0; i < n; i++ ) {
            const belt = i < 80;
            const size = 12 + Math.floor( this.rnd( i, 20 ) * 10 ), voxel = 3 + this.rnd( i, 21 ) * 9;
            let pos;
            if ( belt ) {
                const a = this.rnd( i, 22 ) * Math.PI * 2, r = gas.radius * ( 2.7 + this.rnd( i, 23 ) * 1.6 );
                pos = gas.pos.clone().addScaledVector( u, Math.cos( a ) * r ).addScaledVector( v, Math.sin( a ) * r ).addScaledVector( gas.ringNormal, ( this.rnd( i, 24 ) - 0.5 ) * 1200 );
            } else {
                const a = this.rnd( i, 25 ) * Math.PI * 2, r = 20000 + this.rnd( i, 26 ) * 70000;
                pos = new THREE.Vector3( Math.cos( a ) * r, 6000 + this.rnd( i, 27 ) * 30000, Math.sin( a ) * r );
            }
            const rock = { i, size, voxel, pos, radius: size * voxel * 0.42, mesh: null, want: false, spin: new THREE.Vector3( this.rnd( i, 28 ) - 0.5, this.rnd( i, 29 ) - 0.5, this.rnd( i, 30 ) - 0.5 ).multiplyScalar( 0.3 ), rot: new THREE.Euler( 0, 0, 0 ) };
            d.position.copy( pos );
            d.scale.setScalar( rock.radius * 0.9 );
            d.updateMatrix();
            this.rockFar.setMatrixAt( i, d.matrix );
            this.rockFar.setColorAt( i, new THREE.Color( 0xb0a89c ) );
            this.rocks.push( rock );
        }
        this.rockFar.frustumCulled = false;
        this.scene.add( this.rockFar );
    }

    makeShips() {
        this.ships = [];
        const spriteMat = new THREE.SpriteMaterial( { map: this.glow, color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true } );
        for ( let i = 0; i < 10; i++ ) {
            const host = this.bodies[ 1 + ( i % 4 ) ];
            const ship = {
                i, host, group: new THREE.Group(), mesh: null,
                orbitR: host.radius * ( 1.35 + this.rnd( i, 40 ) * 0.9 ), angle: this.rnd( i, 41 ) * Math.PI * 2,
                tilt: ( this.rnd( i, 42 ) - 0.5 ) * 1.2, speed: 80 + this.rnd( i, 43 ) * 160, voxel: 2 + this.rnd( i, 44 ) * 2.5,
            };
            ship.omega = ship.speed / ship.orbitR;
            const sprite = new THREE.Sprite( spriteMat );
            sprite.scale.setScalar( 60 );
            ship.sprite = sprite;
            ship.group.add( sprite );
            this.scene.add( ship.group );
            this.ships.push( ship );
            this.pool.submit( { type: 'ship', seed: this.seed * 7 + i }, { priority: 40, tag: 'ship' } ).then( ( data ) => {
                const g = new THREE.BufferGeometry();
                g.setAttribute( 'position', new THREE.BufferAttribute( data.pos, 3 ) );
                g.setAttribute( 'color', new THREE.BufferAttribute( data.col, 3, true ) );
                g.setAttribute( 'normal', new THREE.BufferAttribute( data.nrm, 3, true ) );
                g.setIndex( new THREE.BufferAttribute( data.idx, 1 ) );
                g.computeBoundingSphere();
                const m = new THREE.Mesh( g, rockMat );
                m.scale.setScalar( ship.voxel );
                ship.mesh = m;
                sprite.position.set( 0, 0, -9 * ship.voxel );
                ship.group.add( m );
            } );
        }
    }

    makeSky( sunDir ) {
        const n = 3000, pos = new Float32Array( n * 3 ), col = new Float32Array( n * 3 );
        for ( let i = 0; i < n; i++ ) {
            const u = this.rnd( i, 60 ) * 2 - 1, a = this.rnd( i, 61 ) * Math.PI * 2, s = Math.sqrt( 1 - u * u );
            pos.set( [ Math.cos( a ) * s * 240000, u * 240000, Math.sin( a ) * s * 240000 ], i * 3 );
            const w = 0.55 + this.rnd( i, 62 ) * 0.45, warm = this.rnd( i, 63 );
            col.set( [ w, w * ( 0.92 + warm * 0.08 ), w * ( 0.85 + ( 1 - warm ) * 0.15 ) ], i * 3 );
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
        g.setAttribute( 'color', new THREE.BufferAttribute( col, 3 ) );
        this.starMat = new THREE.PointsMaterial( { size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false } );
        this.stars = new THREE.Points( g, this.starMat );
        this.stars.frustumCulled = false;
        this.scene.add( this.stars );
        this.sunDir = sunDir.clone().normalize();
        this.sun = new THREE.Sprite( new THREE.SpriteMaterial( { map: this.glow, color: 0xfff3dc, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true } ) );
        this.sun.scale.setScalar( 26000 );
        this.scene.add( this.sun );
    }

    resolve( pos ) {
        let hit = null;
        for ( const b of this.bodies ) {
            const d = pos.distanceTo( b.pos );
            if ( d > b.radius * 1.4 ) continue;
            const r = ( b.kind === 'gas' ? b.radius * 1.02 : this.surfaceRadius( b, pos ) ) + 2;
            if ( d < r ) { pos.sub( b.pos ).setLength( r ).add( b.pos ); hit = b; }
        }
        return hit;
    }

    nearest( pos ) {
        let best = null;
        for ( const b of this.bodies ) {
            let d = pos.distanceTo( b.pos ) - b.radius;
            if ( d < b.radius * 0.4 && b.kind !== 'gas' ) d = pos.distanceTo( b.pos ) - this.surfaceRadius( b, pos );
            if ( ! best || d < best.d ) best = { name: b.name, kind: b.kind, d };
        }
        return best;
    }

    nearestRock( pos ) {
        let best = null;
        for ( const r of this.rocks ) { const d = r.pos.distanceTo( pos ); if ( ! best || d < best.d ) best = { rock: r, d }; }
        return best.rock;
    }

    nearestShip( pos ) {
        let best = null;
        for ( const s of this.ships ) { const d = s.group.position.distanceTo( pos ); if ( ! best || d < best.d ) best = { ship: s, d }; }
        return best.ship;
    }

    update( dt, camPos, space ) {
        this.starMat.opacity = space * space;
        this.stars.position.copy( camPos );
        this.sun.position.copy( camPos ).addScaledVector( this.sunDir, 200000 );
        this.sun.material.opacity = 0.35 + space * 0.65;
        for ( const b of this.bodies ) {
            b.group.rotation.y += b.spin * dt;
            if ( b.rim ) b.rim.material.uniforms.fade.value = Math.min( 1, Math.max( 0, ( camPos.distanceTo( b.pos ) - b.rim.userData.shellR ) / ( b.radius * 0.4 ) ) );
        }
        for ( const s of this.ships ) {
            s.angle += s.omega * dt;
            const h = s.host;
            const local = new THREE.Vector3( Math.cos( s.angle ) * s.orbitR, Math.sin( s.angle ) * s.orbitR * Math.sin( s.tilt ), Math.sin( s.angle ) * s.orbitR * Math.cos( s.tilt ) );
            const next = new THREE.Vector3( Math.cos( s.angle + 0.01 ) * s.orbitR, Math.sin( s.angle + 0.01 ) * s.orbitR * Math.sin( s.tilt ), Math.sin( s.angle + 0.01 ) * s.orbitR * Math.cos( s.tilt ) );
            s.group.position.copy( h.pos ).add( local );
            s.group.lookAt( h.pos.clone().add( next ) );
            const d = s.group.position.distanceTo( camPos );
            s.group.visible = d < 120000;
            s.sprite.scale.setScalar( Math.max( 40, d * 0.004 ) );
        }
        for ( const r of this.rocks ) if ( r.mesh ) { r.rot.x += r.spin.x * dt; r.rot.y += r.spin.y * dt; r.rot.z += r.spin.z * dt; r.mesh.rotation.copy( r.rot ); }
        this.timer -= dt;
        if ( this.timer > 0 ) return;
        this.timer = 0.5;
        for ( const b of this.bodies ) {
            const d = camPos.distanceTo( b.pos ) / b.radius, sc = Math.max( 0.75, this.scale );
            const level = d < 3 * sc ? 3 : d < 7 * sc ? 2 : d < 30 * sc ? 1 : 0;
            if ( level !== b.level && level !== b.want ) this.requestBody( b, level );
            this.updatePatch( b, camPos );
        }
        const nearR = 4000 * this.scale;
        const dummy = new THREE.Object3D();
        let dirty = false;
        for ( const r of this.rocks ) {
            const d = r.pos.distanceTo( camPos );
            if ( d < nearR && ! r.want ) {
                r.want = true;
                this.pool.submit( { type: 'rock', size: r.size, seed: this.seed * 3 + r.i, i: r.i }, { priority: d / 100, tag: 'rock' } ).then( ( data ) => {
                    if ( ! r.want ) return;
                    const g = new THREE.BufferGeometry();
                    g.setAttribute( 'position', new THREE.BufferAttribute( data.pos, 3 ) );
                    g.setAttribute( 'color', new THREE.BufferAttribute( data.col, 3, true ) );
                    g.setAttribute( 'normal', new THREE.BufferAttribute( data.nrm, 3, true ) );
                    g.setIndex( new THREE.BufferAttribute( data.idx, 1 ) );
                    g.computeBoundingSphere();
                    r.mesh = new THREE.Mesh( g, rockMat );
                    r.mesh.position.copy( r.pos );
                    r.mesh.scale.setScalar( r.voxel );
                    this.scene.add( r.mesh );
                    fadeIn( r.mesh, 0.5 );
                } );
            } else if ( d > nearR * 2 && r.want ) {
                r.want = false;
                if ( r.mesh ) { this.scene.remove( r.mesh ); r.mesh.geometry.dispose(); r.mesh = null; }
            }
            dummy.position.copy( r.pos );
            dummy.scale.setScalar( r.mesh ? 0.0001 : r.radius * 0.9 );
            dummy.updateMatrix();
            this.rockFar.setMatrixAt( r.i, dummy.matrix );
            dirty = true;
        }
        if ( dirty ) this.rockFar.instanceMatrix.needsUpdate = true;
    }

    get stats() {
        return { rocks: this.rocks.filter( ( r ) => r.mesh ).length, bodies: this.bodies.map( ( b ) => b.level ).join( '' ) };
    }
}
