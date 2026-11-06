import * as THREE from 'three';
import { hash2 } from './noise.js';
import { bodyMat, rockMat, instanceMat, fadeIn, hazed } from './materials.js';
import { addClouds } from './clouds.js';
import { StarField } from './starfield.js';
import { densityAt } from './galaxy.js';
import { KINDS as SURFACE, surfaceAt, octavesFor } from './planet.js';
import { RingField } from './rings.js';

const KINDS = [ 'lush', 'icy', 'rocky', 'ember' ];
const NAMES = [ 'Oriel', 'Tamsin', 'Halvard', 'Nerys', 'Cordan', 'Ilse', 'Brannoc', 'Sable', 'Ysolde', 'Marrow', 'Quill', 'Vesper', 'Ashdown', 'Lorn', 'Kestrel', 'Pembray', 'Solenne', 'Thackery', 'Wren', 'Ismay' ];
const STAR_NAMES = [ 'Aldric', 'Bellane', 'Corvane', 'Dunmore', 'Elsinor', 'Fairweather', 'Galloway', 'Harrow', 'Inverleith', 'Jessamy', 'Kinloch', 'Lammas', 'Morrow', 'Nethercote', 'Orrin', 'Penhallow', 'Quenby', 'Rosslyn', 'Sorrel', 'Tarrant' ];
const DETAILS = [ 2, 4, 6, 7 ];
export const ROCK_TINTS = [ [ 0x8a, 0x84, 0x7a ], [ 0x6e, 0x66, 0x5e ], [ 0x9c, 0x8c, 0x78 ], [ 0xa6, 0x6a, 0x48 ], [ 0x5e, 0x5a, 0x66 ] ];
const rgbHex = ( c ) => ( c[ 0 ] << 16 ) | ( c[ 1 ] << 8 ) | c[ 2 ];
// Main-sequence spectral classes: share of stars, luminosity range (Sun = 1), colour, visual radius. Habitable-zone distance scales with sqrt(L).
const STARS = [
    { cls: 'M', share: 0.72, lum: [ 0.03, 0.1 ], color: 0xffb080, radius: 3500, name: 'red dwarf' },
    { cls: 'K', share: 0.12, lum: [ 0.15, 0.5 ], color: 0xffd0a0, radius: 5000, name: 'orange dwarf' },
    { cls: 'G', share: 0.08, lum: [ 0.6, 1.5 ], color: 0xfff3dc, radius: 6000, name: 'yellow dwarf' },
    { cls: 'F', share: 0.05, lum: [ 1.6, 4.5 ], color: 0xf4f6ff, radius: 7500, name: 'white star' },
    { cls: 'A', share: 0.03, lum: [ 5, 20 ], color: 0xbfd4ff, radius: 10000, name: 'blue-white star' },
];
const HZ_BASE = 3e6;
const PATCH_N = 97;
export const CELL = 6e7;

const SCRATCH = new THREE.Vector3(), AIRLOCK_P = new THREE.Vector3(), TMPQ = new THREE.Quaternion();

const PLACEHOLDER = { lush: 0x55704e, icy: 0xcfd9df, rocky: 0x7f7b73, ember: 0x4a3b36 }, placeholders = {};
const placeholderMat = ( kind ) => placeholders[ kind ] || ( placeholders[ kind ] = hazed( new THREE.MeshLambertMaterial( { color: PLACEHOLDER[ kind ] } ) ) );

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

function voxelGeometry( data ) {
    const g = new THREE.BufferGeometry();
    g.setAttribute( 'position', new THREE.BufferAttribute( data.pos, 3 ) );
    g.setAttribute( 'color', new THREE.BufferAttribute( data.col, 3, true ) );
    g.setAttribute( 'normal', new THREE.BufferAttribute( data.nrm, 3, true ) );
    g.setIndex( new THREE.BufferAttribute( data.idx, 1 ) );
    g.computeBoundingSphere();
    return g;
}

class System {
    constructor( space, key, center, seed, home ) {
        this.space = space; this.key = key; this.center = center; this.seed = seed; this.home = home;
        this.scene = space.scene; this.pool = space.pool;
        this.name = STAR_NAMES[ seed % STAR_NAMES.length ] + ( home ? '' : ` ${seed % 97}` );
        this.bodies = []; this.rocks = []; this.ships = []; this.stations = [];
        this.makeStar();
        this.makeBodies();
        this.makeRocks();
        this.makeVessels();
    }

    rnd( i, j ) {
        return hash2( i, j, this.seed + 4242 );
    }

    makeStar() {
        let roll = this.home ? 0.9 : this.rnd( 0, 1 ), type = STARS[ 2 ];
        if ( ! this.home ) for ( const t of STARS ) { if ( roll < t.share ) { type = t; break; } roll -= t.share; }
        this.starType = type;
        this.lum = type.lum[ 0 ] + this.rnd( 0, 2 ) * ( type.lum[ 1 ] - type.lum[ 0 ] );
        this.hz = this.home ? 1500000 : HZ_BASE * Math.sqrt( this.lum );
        this.frost = this.hz * 2.7;
        this.starRadius = type.radius * ( 0.85 + this.rnd( 0, 3 ) * 0.3 );
        this.starColor = type.color;
        this.starPos = this.home ? this.center.clone().addScaledVector( this.space.sunDir, 300000 ) : this.center.clone();
        this.star = new THREE.Sprite( new THREE.SpriteMaterial( { map: this.space.glow, color: type.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true } ) );
        this.star.scale.setScalar( this.starRadius * ( 3 + Math.sqrt( this.lum ) ) );
        this.star.position.copy( this.starPos );
        this.starBall = new THREE.Mesh( new THREE.SphereGeometry( this.starRadius, 24, 16 ), new THREE.MeshBasicMaterial( { color: type.color } ) );
        this.starBall.position.copy( this.starPos );
        this.scene.add( this.star, this.starBall );
    }

    // Kind by equilibrium temperature: inside half the habitable distance things are molten or baked bare,
    // the habitable band holds lush worlds if they are big enough to keep air, cold rocky worlds sit between
    // there and the frost line, and everything beyond the frost line is ice. Rings favour the cold outer planets.
    planetKind( q, radius ) {
        if ( q < 0.45 ) return this.rnd( Math.round( q * 100 ), 13 ) < 0.6 ? 'ember' : 'rocky';
        if ( q < 0.8 ) return 'rocky';
        if ( q < 1.6 ) return radius > 2400 ? 'lush' : 'rocky';
        if ( q < 2.7 ) return this.rnd( Math.round( q * 100 ), 14 ) < 0.5 ? 'rocky' : 'icy';
        return 'icy';
    }

    makeBodies() {
        const maxN = this.starType.cls === 'M' ? 7 : this.starType.cls === 'K' ? 8 : 8;
        const n = Math.min( maxN, ( this.home ? 4 : 2 ) + Math.floor( this.rnd( 1, 1 ) * ( this.home ? 4 : 7 ) ) );
        this.rings = [];
        this.moons = [];
        const inner = this.home ? 280000 : Math.max( this.hz * 0.22, this.starRadius * 4 );
        const spread = this.home ? 1.6 : this.starType.cls === 'M' ? 1.6 : 1.9;
        const plane = new THREE.Vector3( ( this.rnd( 1, 2 ) - 0.5 ) * 0.4, 1, ( this.rnd( 1, 3 ) - 0.5 ) * 0.4 ).normalize();
        const pu = new THREE.Vector3( 1, 0, 0 ).cross( plane ).normalize(), pv = plane.clone().cross( pu );
        // Radii on a rough power law, 1.3 km to 100 km. Orbits are spaced so no planet is wider than about
        // 1.5 degrees from any other (forty radii apart); the home system keeps one showpiece, a 20 to 30 km
        // ringed world 300 km out, and everything else beyond it.
        let prevDist = 0, prevR = 0;
        for ( let i = 0; i < n; i++ ) {
            const u = this.rnd( i, 3 ), big = this.rnd( i, 12 );
            const showpiece = this.home && i === 0;
            const radius = showpiece ? 20000 + u * 10000 : big < 0.12 ? 40000 + u * 60000 : big < 0.4 ? 9000 + u * 31000 : 1300 + u * 7700;
            const gap = 40 * Math.max( prevR, radius ) + 40000;
            const dist = showpiece ? inner + u * 60000 : Math.max( inner * Math.pow( spread, i ) * ( 0.88 + this.rnd( i, 4 ) * 0.24 ), prevDist + gap );
            if ( dist > 2.5e7 ) continue;
            prevDist = dist; prevR = radius;
            const az = this.rnd( i, 5 ) * Math.PI * 2;
            let pos;
            if ( this.home ) {
                const el = 0.14 + this.rnd( i, 6 ) * 0.6;
                pos = new THREE.Vector3( Math.cos( az ) * Math.cos( el ) * dist, Math.sin( el ) * dist + radius, Math.sin( az ) * Math.cos( el ) * dist ).add( this.center );
            } else {
                const tilt = ( this.rnd( i, 6 ) - 0.5 ) * 0.12 * dist;
                pos = this.starPos.clone().addScaledVector( pu, Math.cos( az ) * dist ).addScaledVector( pv, Math.sin( az ) * dist ).addScaledVector( plane, tilt );
            }
            // Home orbits are measured from the home world, so temperature uses the true distance to its sun.
            const q = ( this.home ? pos.distanceTo( this.starPos ) : dist ) / this.hz;
            const kind = this.planetKind( q, radius );
            const body = this.addBody( i, kind, q, radius, pos );
            if ( this.rnd( i, 8 ) < ( this.home && i === 0 ? 1 : q > 2.7 ? 0.22 : 0.05 ) ) {
                body.rings = new RingField( this.space, body, ( this.seed * 13 + i * 101 ) % 1000003 );
                body.ringNormal = body.rings.normal;
                this.rings.push( body.rings );
            }
        }
        this.makeMoons();
    }

    addBody( i, kind, q, radius, pos ) {
        const group = new THREE.Group();
        group.position.copy( pos );
        // Placeholder until the first detail level arrives: a flat tint of the kind, so a body never shows as
        // a black hole with its clouds floating over it while its mesh is queued.
        const mesh = new THREE.Mesh( new THREE.IcosahedronGeometry( radius, 2 ), placeholderMat( kind ) );
        group.add( mesh );
        const body = { i, kind, q, system: this, name: NAMES[ ( this.seed + i * 3 ) % NAMES.length ], radius, pos, group, mesh, level: -1, want: -1, geos: new Map(), spin: Math.min( ( 2 * Math.PI ) / ( 1200 + this.rnd( i, 7 ) * 1800 ), 60 / radius ), seed: this.seed + i * 17, patch: null, patchWant: 0 };
        if ( kind !== 'rocky' && kind !== 'ember' ) {
            // The atmosphere sphere sits above the cloud shell (which is above the peaks).
            const shellR = radius * ( 1 + SURFACE[ kind ].amp * 4 ) + Math.max( 1500, radius * 0.02 );
            const rim = new THREE.Mesh( new THREE.SphereGeometry( shellR, 48, 32 ), rimMaterial( kind === 'icy' ? 0xbfe0ff : 0x7fb4ff ) );
            rim.userData.shellR = shellR;
            group.add( rim );
            body.rim = rim;
        }
        addClouds( body, this.rnd( i, 80 ) );
        this.scene.add( group );
        this.bodies.push( body );
        this.space.requestBody( body, 0 );
        return body;
    }

    // Moons: ordinary bodies (same detail levels, shells and tiles) that orbit a planet beyond its rings,
    // once every 10 to 40 minutes. Bigger planets carry more; a moon is a twentieth to a sixth of its host.
    makeMoons() {
        const planets = this.bodies.slice();
        let i = planets.length;
        for ( const host of planets ) {
            if ( host.radius < 8000 ) continue;
            const roll = this.rnd( host.i, 70 ), n = roll < 0.4 ? 0 : roll < 0.8 ? 1 : host.radius > 30000 ? 3 : 2;
            const inner = Math.max( host.radius * 2.6, host.rings ? host.rings.outer * 1.4 : 0 );
            const plane = new THREE.Vector3( this.rnd( host.i, 71 ) - 0.5, 1, this.rnd( host.i, 72 ) - 0.5 ).normalize();
            for ( let m = 0; m < n; m++, i++ ) {
                const radius = Math.max( 700, host.radius * ( 0.05 + this.rnd( i, 3 ) * 0.11 ) );
                const orbit = { host, orbitR: inner + host.radius * ( 1.2 * m + this.rnd( i, 4 ) * 0.8 ) + radius * 3, angle: this.rnd( i, 5 ) * Math.PI * 2, tilt: Math.acos( plane.y ) * ( this.rnd( i, 6 ) < 0.5 ? 1 : -1 ) };
                orbit.omega = Math.min( ( 2 * Math.PI ) / ( 600 + this.rnd( i, 9 ) * 1800 ), 60 / orbit.orbitR ) * ( this.rnd( i, 10 ) < 0.85 ? 1 : -1 );
                const pos = this.space.orbitPoint( orbit, orbit.angle, new THREE.Vector3() );
                const body = this.addBody( i, this.planetKind( host.q, radius ), host.q, radius, pos );
                body.orbit = orbit;
                this.moons.push( body );
            }
        }
    }

    makeRocks() {
        const n = 30 + Math.floor( this.rnd( 3, 1 ) * 190 );
        const ringed = this.bodies.find( ( b ) => b.ringNormal );
        const host = this.home && ringed ? ringed : { pos: this.starPos, radius: this.frost / 2.7 * 0.8 };
        const normal = host.ringNormal || new THREE.Vector3( this.rnd( 3, 2 ) - 0.5, 1, this.rnd( 3, 3 ) - 0.5 ).normalize();
        const u = new THREE.Vector3( 1, 0, 0 ).cross( normal ).normalize(), v = normal.clone().cross( u );
        const beltShare = 0.5 + this.rnd( 3, 4 ) * 0.4;
        this.rockFar = new THREE.InstancedMesh( new THREE.IcosahedronGeometry( 1, 1 ), instanceMat, n );
        this.rockFar.instanceColor = new THREE.InstancedBufferAttribute( new Float32Array( n * 3 ), 3 );
        const d = new THREE.Object3D();
        for ( let i = 0; i < n; i++ ) {
            const belt = i < n * beltShare;
            const size = 12 + Math.floor( this.rnd( i, 20 ) * 10 ), voxel = 3 + this.rnd( i, 21 ) * 9;
            let pos;
            if ( belt ) {
                const a = this.rnd( i, 22 ) * Math.PI * 2, r = host.radius * ( 2.7 + this.rnd( i, 23 ) * 1.6 );
                pos = host.pos.clone().addScaledVector( u, Math.cos( a ) * r ).addScaledVector( v, Math.sin( a ) * r ).addScaledVector( normal, ( this.rnd( i, 24 ) - 0.5 ) * 1200 );
            } else {
                const a = this.rnd( i, 25 ) * Math.PI * 2, r = 20000 + this.rnd( i, 26 ) * 90000;
                pos = new THREE.Vector3( Math.cos( a ) * r, ( this.home ? 6000 : -20000 ) + this.rnd( i, 27 ) * 40000, Math.sin( a ) * r ).add( this.center );
            }
            const tint = ROCK_TINTS[ Math.floor( this.rnd( i, 31 ) * ROCK_TINTS.length ) ];
            const rock = { i, system: this, size, voxel, pos, color: tint, radius: size * voxel * 0.42, mesh: null, want: false, spin: new THREE.Vector3( this.rnd( i, 28 ) - 0.5, this.rnd( i, 29 ) - 0.5, this.rnd( i, 30 ) - 0.5 ).multiplyScalar( 0.3 ), rot: new THREE.Euler( 0, 0, 0 ) };
            d.position.copy( pos );
            d.scale.setScalar( rock.radius * 0.9 );
            d.updateMatrix();
            this.rockFar.setMatrixAt( i, d.matrix );
            this.rockFar.setColorAt( i, new THREE.Color( rgbHex( tint ) ).multiplyScalar( 0.95 ) );
            this.rocks.push( rock );
        }
        this.rockFar.frustumCulled = false;
        this.scene.add( this.rockFar );
    }

    makeVessels() {
        const spriteMat = new THREE.SpriteMaterial( { map: this.space.glow, color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true } );
        const nShips = 4 + Math.floor( this.rnd( 4, 1 ) * 17 );
        for ( let i = 0; i < nShips; i++ ) {
            const roll = this.rnd( i, 45 ), cls = roll < 0.55 ? 'small' : roll < 0.85 ? 'medium' : 'capital';
            const host = this.bodies[ Math.floor( this.rnd( i, 46 ) * this.bodies.length ) ];
            const voxel = cls === 'small' ? 2 + this.rnd( i, 44 ) * 2 : cls === 'medium' ? 3 + this.rnd( i, 44 ) * 2 : 5 + this.rnd( i, 44 ) * 2;
            const speed = cls === 'small' ? 80 + this.rnd( i, 43 ) * 160 : cls === 'medium' ? 60 + this.rnd( i, 43 ) * 80 : 30 + this.rnd( i, 43 ) * 30;
            const ship = {
                i, cls, host, system: this, group: new THREE.Group(), mesh: null, voxel, speed, seed: this.seed * 7 + i,
                orbitR: host.radius * ( 1.35 + this.rnd( i, 40 ) * 0.9 ), angle: this.rnd( i, 41 ) * Math.PI * 2, tilt: ( this.rnd( i, 42 ) - 0.5 ) * 1.2,
            };
            ship.omega = ship.speed / ship.orbitR;
            ship.sprite = new THREE.Sprite( spriteMat );
            ship.group.add( ship.sprite );
            this.scene.add( ship.group );
            this.ships.push( ship );
            this.pool.submit( { type: 'ship', seed: ship.seed, cls }, { priority: 40, tag: 'ship' } ).then( ( data ) => {
                if ( this.disposed ) return;
                const m = new THREE.Mesh( voxelGeometry( data ), rockMat );
                m.scale.setScalar( voxel );
                ship.mesh = m;
                ship.sprite.position.set( 0, 0, -( cls === 'capital' ? 48 : cls === 'medium' ? 20 : 9 ) * voxel );
                ship.group.add( m );
                const W = cls === 'capital' ? 34 : cls === 'medium' ? 17 : 9;
                this.space.airlock( ship, new THREE.Vector3( W / 2 * voxel + 2, 0, 0 ) );
            } );
        }
        const hosts = this.bodies;
        const nSt = hosts.length ? Math.floor( this.rnd( 5, 1 ) * Math.min( 5, hosts.length + 1 ) ) + ( this.home ? 1 : 0 ) : 0;
        for ( let i = 0; i < nSt; i++ ) {
            const host = hosts[ i % hosts.length ];
            const st = { i, host, system: this, name: `${host.name} Station`, group: new THREE.Group(), mesh: null, voxel: 7 + this.rnd( i, 50 ) * 3, seed: this.seed * 11 + i,
                orbitR: host.radius * ( 1.9 + this.rnd( i, 51 ) * 0.5 ), angle: this.rnd( i, 52 ) * Math.PI * 2, tilt: ( this.rnd( i, 53 ) - 0.5 ) * 0.8, spin: 0.015 + this.rnd( i, 54 ) * 0.02 };
            st.omega = 25 / st.orbitR;
            this.scene.add( st.group );
            this.stations.push( st );
            this.pool.submit( { type: 'station', seed: st.seed }, { priority: 45, tag: 'ship' } ).then( ( data ) => {
                if ( this.disposed ) return;
                const m = new THREE.Mesh( voxelGeometry( data ), rockMat );
                m.scale.setScalar( st.voxel );
                st.mesh = m;
                st.group.add( m );
                this.space.airlock( st, new THREE.Vector3( 0, 13 * st.voxel + 2, 0 ) );
            } );
        }
    }

    // Home only: the sun circles the home world, so its position follows the current sun direction.
    setSunDir( dir ) {
        this.starPos.copy( this.center ).addScaledVector( dir, 300000 );
        this.star.position.copy( this.starPos );
        this.starBall.position.copy( this.starPos );
    }

    rebase( delta ) {
        this.center.sub( delta );
        this.starPos.sub( delta );
        this.star.position.sub( delta );
        this.starBall.position.sub( delta );
        for ( const b of this.bodies ) { b.pos.sub( delta ); b.group.position.sub( delta ); }
        for ( const rg of this.rings ) rg.rebase( delta );
        for ( const r of this.rocks ) { r.pos.sub( delta ); if ( r.mesh ) { r.mesh.position.sub( delta ); r.frame.position.sub( delta ); } }
        this.rockDirty = true;
    }

    dispose() {
        this.disposed = true;
        this.scene.remove( this.star, this.starBall, this.rockFar );
        for ( const rg of this.rings ) rg.dispose();
        for ( const b of this.bodies ) { this.scene.remove( b.group ); b.group.traverse( ( o ) => o.geometry && o.geometry.dispose() ); for ( const g of b.geos.values() ) g.dispose(); }
        for ( const r of this.rocks ) if ( r.mesh ) { this.scene.remove( r.mesh, r.frame ); r.mesh.geometry.dispose(); }
        for ( const v of [ ...this.ships, ...this.stations ] ) { this.scene.remove( v.group ); v.group.traverse( ( o ) => o.geometry && o.geometry.dispose() ); }
    }
}

export class Space {
    constructor( scene, pool, seed, radius, sunDir ) {
        this.scene = scene; this.pool = pool; this.seed = seed;
        this.scale = radius / 8;
        this.glow = glowTexture();
        this.sunDir = sunDir.clone().normalize();
        this.systems = new Map();
        this.offset = new THREE.Vector3();
        this.makeSky();
        this.timer = 0;
        this.home = this.loadSystem( 0, 0, 0, true );
        this.refresh( new THREE.Vector3() );
    }

    get bodies() { return [ ...this.systems.values() ].flatMap( ( s ) => s.bodies ); }
    get rocks() { return [ ...this.systems.values() ].flatMap( ( s ) => [ ...s.rocks, ...s.rings.flatMap( ( rg ) => rg.rocks ) ] ); }
    get ships() { return [ ...this.systems.values() ].flatMap( ( s ) => s.ships ); }
    get stations() { return [ ...this.systems.values() ].flatMap( ( s ) => s.stations ); }

    cellCenter( i, j, k ) {
        if ( i === 0 && j === 0 && k === 0 ) return new THREE.Vector3( 0, 0, 0 ).sub( this.offset );
        const h = ( n ) => hash2( i * 73 + j * 31 + k * 17, n, this.seed + 99 );
        return new THREE.Vector3( ( i + 0.5 + ( h( 1 ) - 0.5 ) * 0.5 ) * CELL, ( j + ( h( 2 ) - 0.5 ) * 0.3 ) * CELL, ( k + 0.5 + ( h( 3 ) - 0.5 ) * 0.5 ) * CELL ).sub( this.offset );
    }

    // A cell holds a system with a probability set by the galaxy's density there (about one cell in three at home).
    hasSystem( i, j, k ) {
        if ( i === 0 && j === 0 && k === 0 ) return true;
        const c = this.cellCenter( i, j, k ), d = densityAt( c.x + this.offset.x, c.y + this.offset.y, c.z + this.offset.z, this.seed );
        return hash2( i * 73 + j * 31 + k * 17, 9, this.seed + 5 ) < Math.min( 0.85, 0.3 * d );
    }

    loadSystem( i, j, k, home = false ) {
        const key = `${i},${j},${k}`;
        if ( this.systems.has( key ) ) return this.systems.get( key );
        const seed = home ? this.seed : ( this.seed * 31 + ( ( i * 92837111 ) ^ ( j * 689287499 ) ^ ( k * 283923481 ) ) ) >>> 0;
        const sys = new System( this, key, this.cellCenter( i, j, k ), seed % 1000003, home );
        this.systems.set( key, sys );
        return sys;
    }

    refresh( camPos ) {
        const abs = SCRATCH.copy( camPos ).add( this.offset );
        const ci = Math.floor( abs.x / CELL ), cj = Math.round( abs.y / CELL ), ck = Math.floor( abs.z / CELL );
        const wanted = new Set();
        for ( let i = ci - 2; i <= ci + 2; i++ ) for ( let j = cj - 2; j <= cj + 2; j++ ) for ( let k = ck - 2; k <= ck + 2; k++ ) {
            const c = this.cellCenter( i, j, k );
            if ( ( c.distanceTo( camPos ) < CELL * 1.1 || ( i === 0 && j === 0 && k === 0 ) ) && this.hasSystem( i, j, k ) ) { wanted.add( `${i},${j},${k}` ); this.loadSystem( i, j, k ); }
        }
        for ( const [ key, sys ] of this.systems ) if ( ! wanted.has( key ) && ! sys.home ) { sys.dispose(); this.systems.delete( key ); }
        this.homeLoaded = wanted.has( '0,0,0' );
    }

    nearestSystem( pos ) {
        let best = null;
        for ( const s of this.systems.values() ) { const d = s.center.distanceTo( pos ); if ( ! best || d < best.d ) best = { system: s, d }; }
        return best && best.system;
    }

    rebase( delta ) {
        this.offset.add( delta );
        for ( const s of this.systems.values() ) s.rebase( delta );
    }

    requestBody( body, level ) {
        body.want = level;
        if ( body.geos.has( level ) ) { this.applyBody( body, level ); return; }
        this.pool.submit( { type: 'body', kind: body.kind, radius: body.radius, detail: DETAILS[ level ], seed: body.seed, level, i: body.i }, { priority: level === 0 ? -5000 : 50 - level * 10, tag: 'body' } )
            .then( ( data ) => {
                if ( body.system.disposed ) return;
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

    // Cached per body against the last query point: every caller in a frame asks about the same spot.
    surfaceRadius( body, worldPos ) {
        const c = body.srCache || ( body.srCache = { pos: new THREE.Vector3( Infinity, 0, 0 ), bpos: new THREE.Vector3(), r: 0 } );
        if ( c.pos.distanceToSquared( worldPos ) < 0.04 && c.bpos.equals( body.pos ) ) return c.r;
        c.pos.copy( worldPos ); c.bpos.copy( body.pos );
        const local = body.group.worldToLocal( SCRATCH.copy( worldPos ) ).normalize();
        c.r = surfaceAt( body.kind, SURFACE[ body.kind ], [ local.x, local.y, local.z ], body.seed, body.radius, octavesFor( body.radius, 6 ) ).r;
        return c.r;
    }

    updatePatch( body, camPos ) {
        const d = camPos.distanceTo( body.pos ), alt = Math.max( 0, d - this.surfaceRadius( body, camPos ) );
        const wantPatch = d / body.radius < 1.6 * this.scale;
        if ( ! wantPatch ) {
            if ( body.patch ) { body.group.remove( body.patch ); body.patch.geometry.dispose(); body.patch = null; }
            return;
        }
        const local = body.group.worldToLocal( SCRATCH.copy( camPos ) ).normalize();
        const ang = Math.min( 0.5, Math.max( 0.025, alt / body.radius * 2.2 + 0.015 ) );
        const p = body.patch;
        if ( p && p.userData.center.angleTo( local ) < p.userData.ang * 0.35 && Math.abs( Math.log( ang / p.userData.ang ) ) < 0.3 ) return;
        const stamp = ++body.patchWant;
        this.pool.submit( { type: 'patch', kind: body.kind, radius: body.radius, seed: body.seed, center: local.toArray(), ang, n: PATCH_N }, { priority: 1, tag: 'patch' } ).then( ( data ) => {
            if ( stamp !== body.patchWant || body.system.disposed ) return;
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

    airlock( vessel, local ) {
        const mark = new THREE.Group();
        mark.position.copy( local );
        const door = new THREE.Mesh( new THREE.BoxGeometry( 3, 4, 3 ), new THREE.MeshBasicMaterial( { color: 0xe0802a } ) );
        const beacon = new THREE.Sprite( new THREE.SpriteMaterial( { map: this.glow, color: 0x9fe8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true } ) );
        beacon.scale.setScalar( 14 );
        mark.add( door, beacon );
        vessel.group.add( mark );
        vessel.airlock = mark;
    }

    nearestAirlock( pos ) {
        let best = null;
        const p = new THREE.Vector3();
        for ( const v of [ ...this.ships, ...this.stations ] ) {
            if ( ! v.airlock ) continue;
            v.airlock.getWorldPosition( p );
            const d = p.distanceTo( pos );
            if ( ! best || d < best.d ) { best = { vessel: v, point: AIRLOCK_P.copy( p ), d }; }
        }
        return best;
    }

    airlockPoint( vessel, out = new THREE.Vector3() ) {
        return vessel.airlock.getWorldPosition( out );
    }

    nearestRock( pos, withMesh = false ) {
        let best = null;
        for ( const r of this.rocks ) { if ( withMesh && ! r.mesh ) continue; const d = r.pos.distanceTo( pos ); if ( ! best || d < best.d ) best = { rock: r, d }; }
        return best && best.rock;
    }

    orbitPoint( o, angle, out ) {
        return out.set( Math.cos( angle ) * o.orbitR, Math.sin( angle ) * o.orbitR * Math.sin( o.tilt ), Math.sin( angle ) * o.orbitR * Math.cos( o.tilt ) ).add( o.host.pos );
    }

    nearestStation( pos ) {
        let best = null;
        for ( const s of this.stations ) { const d = s.group.position.distanceTo( pos ); if ( ! best || d < best.d ) best = { station: s, d }; }
        return best && best.station;
    }

    nearestShip( pos ) {
        let best = null;
        for ( const s of this.ships ) { const d = s.group.position.distanceTo( pos ); if ( ! best || d < best.d ) best = { ship: s, d }; }
        return best && best.ship;
    }

    makeSky() {
        this.starField = new StarField( this.scene, this.seed, this.glow );
        this.stars = this.starField.group;
        this.starMat = this.starField;
    }

    resolve( pos ) {
        let hit = null;
        for ( const b of this.bodies ) {
            const d = pos.distanceTo( b.pos );
            if ( d > b.radius * 1.4 ) continue;
            const r = this.surfaceRadius( b, pos ) + 2;
            if ( d < r ) { pos.sub( b.pos ).setLength( r ).add( b.pos ); hit = b; }
        }
        for ( const s of this.systems.values() ) {
            const r = s.starRadius * 1.5, d = pos.distanceTo( s.starPos );
            if ( d < r ) { pos.sub( s.starPos ).setLength( r ).add( s.starPos ); hit = s; }
        }
        return hit;
    }

    nearest( pos ) {
        let best = null;
        for ( const b of this.bodies ) {
            let d = pos.distanceTo( b.pos ) - b.radius;
            if ( d < b.radius * 0.4 ) d = pos.distanceTo( b.pos ) - this.surfaceRadius( b, pos );
            if ( ! best || d < best.d ) best = { name: b.name, kind: b.kind, d };
        }
        for ( const s of this.systems.values() ) {
            const d = pos.distanceTo( s.starPos ) - s.starRadius;
            if ( ! best || d < best.d ) best = { name: s.name, kind: s.starType.name, d };
        }
        return best;
    }

    update( dt, camPos, space ) {
        this.starMat.opacity = Math.max( space * space, ( this.night || 0 ) ** 2 * 0.85 );
        const ahead = new THREE.Vector3();
        for ( const sys of this.systems.values() ) {
            sys.star.material.opacity = ( sys.home ? 0.35 + space * 0.65 : 1 ) * ( sys === this.lit ? 1 : 1 - ( this.skyVeil || 0 ) );
            for ( const b of sys.bodies ) {
                b.group.rotation.y += b.spin * dt;
                if ( b.orbit ) { b.orbit.angle += b.orbit.omega * dt; this.orbitPoint( b.orbit, b.orbit.angle, b.pos ); b.group.position.copy( b.pos ); }
                if ( b.cloud ) b.cloud.mat.uniforms.sunLocal.value.copy( sys.starPos ).sub( b.pos ).normalize().applyQuaternion( TMPQ.copy( b.group.quaternion ).invert() );
                if ( b.rim ) b.rim.material.uniforms.fade.value = Math.min( 1, Math.max( 0, ( camPos.distanceTo( b.pos ) - b.rim.userData.shellR ) / ( b.radius * 0.4 ) ) );
            }
            for ( const s of sys.ships ) {
                s.angle += s.omega * dt;
                this.orbitPoint( s, s.angle, s.group.position );
                s.group.lookAt( this.orbitPoint( s, s.angle + 0.01, ahead ) );
                const d = s.group.position.distanceTo( camPos );
                s.group.visible = d < 150000;
                s.sprite.scale.setScalar( Math.max( 12 * s.voxel, d * 0.004 ) );
            }
            for ( const st of sys.stations ) {
                st.angle += st.omega * dt;
                this.orbitPoint( st, st.angle, st.group.position );
                st.group.rotation.y += st.spin * dt;
            }
            for ( const r of sys.rocks ) if ( r.mesh ) { r.rot.x += r.spin.x * dt; r.rot.y += r.spin.y * dt; r.rot.z += r.spin.z * dt; r.mesh.rotation.copy( r.rot ); r.frame.rotation.copy( r.rot ); }
            for ( const rg of sys.rings ) rg.tick( dt );
        }
        this.timer -= dt;
        if ( this.timer > 0 ) return;
        this.timer = 0.5;
        this.refresh( camPos );
        for ( const sys of this.systems.values() ) for ( const rg of sys.rings ) rg.update( camPos );
        // Sphere detail by apparent triangle size (about six pixels), nudged by the detail radius. The top
        // level is skipped on worlds under 20 km while their heightfield tiles are up, and geometry more than
        // one level away from the current one is released, so only the levels in play stay in memory.
        for ( const b of this.bodies ) {
            const d = camPos.distanceTo( b.pos ) / b.radius, sc = Math.min( 1.25, Math.max( 0.75, this.scale ) );
            let level = d < 2.3 * sc ? 3 : d < 9 * sc ? 2 : d < 36 * sc ? 1 : 0;
            if ( level === 3 && b.radius < 20000 && ( d - 1 ) * b.radius < Math.min( 4000 * this.scale, b.radius * 0.5 ) ) level = 2;
            if ( level !== b.level && level !== b.want ) this.requestBody( b, level );
            for ( const [ k, g ] of b.geos ) if ( k && k !== b.level && k !== b.want && Math.abs( k - level ) > 1 ) { g.dispose(); b.geos.delete( k ); }
            this.updatePatch( b, camPos );
        }
        const nearR = 4000 * this.scale;
        const dummy = new THREE.Object3D();
        for ( const sys of this.systems.values() ) {
            let dirty = sys.rockDirty;
            sys.rockDirty = false;
            for ( const r of sys.rocks ) {
                const d = r.pos.distanceTo( camPos );
                if ( d < nearR && ! r.want ) {
                    r.want = true;
                    this.pool.submit( { type: 'rock', size: r.size, seed: sys.seed * 3 + r.i, i: r.i, color: r.color }, { priority: d / 100, tag: 'rock' } ).then( ( data ) => {
                        if ( ! r.want || sys.disposed ) return;
                        r.mesh = new THREE.Mesh( voxelGeometry( data ), rockMat );
                        r.mesh.position.copy( r.pos );
                        r.mesh.scale.setScalar( r.voxel );
                        r.vol = data.vol;
                        r.frame = new THREE.Group();
                        r.frame.position.copy( r.pos );
                        this.scene.add( r.mesh, r.frame );
                        fadeIn( r.mesh, 0.5 );
                        sys.rockDirty = true;
                    } );
                } else if ( d > nearR * 2 && r.want ) {
                    r.want = false;
                    if ( r.mesh ) { this.scene.remove( r.mesh, r.frame ); r.mesh.geometry.dispose(); r.mesh = null; r.frame = null; }
                    dirty = true;
                }
                if ( ! dirty && d >= nearR ) continue;
                dummy.position.copy( r.pos );
                dummy.scale.setScalar( r.mesh ? 0.0001 : r.radius * 0.9 );
                dummy.updateMatrix();
                sys.rockFar.setMatrixAt( r.i, dummy.matrix );
                dirty = true;
            }
            if ( dirty ) sys.rockFar.instanceMatrix.needsUpdate = true;
        }
    }

    get stats() {
        return { systems: this.systems.size, rocks: this.rocks.filter( ( r ) => r.mesh ).length, bodies: this.bodies.length };
    }
}
