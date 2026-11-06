import * as THREE from 'three';
import { fbm3 } from './noise.js';
import { KINDS } from './planet.js';
import { hazed } from './materials.js';

export const cloudTime = { value: 0 };
const SCALE = 5, WIND = [ 0.004, 0, 0.002 ];

// Integer-hash value noise written the same way as noise.js so the CPU can ask what the GPU drew.
const GLSL_NOISE = `
uniform uint cseed;
float chash( int x, int y, int z, uint s ) {
    uint h = uint( x + z * 7919 ) * 374761393u + uint( y + z * 104729 ) * 668265263u + s * 2246822519u;
    h = ( h ^ ( h >> 13 ) ) * 1274126177u;
    h ^= h >> 16;
    return float( h ) / 4294967296.0;
}
float cfade( float t ) { return t * t * t * ( t * ( t * 6.0 - 15.0 ) + 10.0 ); }
float cvalue( vec3 p, uint s ) {
    vec3 i = floor( p ), f = p - i;
    int x = int( i.x ), y = int( i.y ), z = int( i.z );
    float u = cfade( f.x ), v = cfade( f.y ), w = cfade( f.z );
    float x00 = mix( chash( x, y, z, s ), chash( x + 1, y, z, s ), u ), x10 = mix( chash( x, y + 1, z, s ), chash( x + 1, y + 1, z, s ), u );
    float x01 = mix( chash( x, y, z + 1, s ), chash( x + 1, y, z + 1, s ), u ), x11 = mix( chash( x, y + 1, z + 1, s ), chash( x + 1, y + 1, z + 1, s ), u );
    return mix( mix( x00, x10, v ), mix( x01, x11, v ), w );
}
float cfbm( vec3 p, uint s, int octaves ) {
    float sum = 0.0, amp = 1.0, f = 1.0;
    for ( int i = 0; i < 6; i++ ) {
        if ( i >= octaves ) break;
        sum += ( cvalue( p * f, s + uint( i * 131 ) ) * 2.0 - 1.0 ) * amp;
        amp *= 0.5; f *= 2.0;
    }
    return sum * 0.5;
}`;

export const FLAT = 1 / 6000;

// Cloud cover in [0,1] at a body-local unit direction (or, for the flat home layer, a home-local point);
// identical to the shader's.
export function cloudAt( body, dir, t = cloudTime.value, thick = false ) {
    const c = body.cloud;
    if ( ! c ) return 0;
    const k = c.flat ? FLAT : SCALE, y = c.flat ? 0 : dir.y * k;
    const p = [ dir.x * k + WIND[ 0 ] * t, y + WIND[ 1 ] * t, dir.z * k + WIND[ 2 ] * t ];
    const weather = fbm3( p[ 0 ] * 0.4, p[ 1 ] * 0.4, p[ 2 ] * 0.4, c.seed, 3 );
    const detail = fbm3( p[ 0 ] * 1.3 + 7, p[ 1 ] * 1.3 + 7, p[ 2 ] * 1.3 + 7, c.seed + 5, 4 );
    const n = 0.5 * weather + 0.5 * detail, thr = 0.45 - c.cover * 0.9;
    // `thick` asks for the dense heart of a cloud (the shader's own `thick`): what rains.
    return thick ? THREE.MathUtils.smoothstep( n, thr + 0.12, thr + 0.45 ) : THREE.MathUtils.smoothstep( n, thr, thr + 0.25 );
}

// Adds a cloud shell to an atmosphere body: a translucent sphere above the peaks whose cover comes from the
// noise above, lit by its star, drifting with the wind and fading as you fly through it.
export function cloudMaterial( seed, cover, tint, flat = false ) {
    return new THREE.ShaderMaterial( {
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { cseed: { value: seed }, cover: { value: cover }, time: cloudTime, sunLocal: { value: new THREE.Vector3( 0, 1, 0 ) }, tint: { value: new THREE.Color( tint ) }, flatScale: { value: flat ? FLAT : 0 }, bands: { value: 0 } },
        vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
uniform float flatScale;
varying vec3 vLocal; varying vec3 vWorld;
void main() {
    #include <begin_vertex>
    vLocal = flatScale > 0.0 ? position : normalize( position );
    vWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
    if ( flatScale > 0.0 ) { vec2 cd = vWorld.xz - cameraPosition.xz; transformed.y -= dot( cd, cd ) / 180000.0; }
    gl_Position = projectionMatrix * modelViewMatrix * vec4( transformed, 1.0 );
    #include <logdepthbuf_vertex>
}`,
        fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
uniform float cover; uniform float time; uniform vec3 sunLocal; uniform vec3 tint; uniform float flatScale; uniform float bands;
varying vec3 vLocal; varying vec3 vWorld;
void main() {
    #include <logdepthbuf_fragment>
    vec3 d = flatScale > 0.0 ? vec3( 0.0, 1.0, 0.0 ) : normalize( vLocal );
    vec3 p = ( flatScale > 0.0 ? vec3( vLocal.x, 0.0, vLocal.z ) * flatScale : d * ${SCALE.toFixed( 1 )} ) + vec3( ${WIND.map( ( w ) => w.toFixed( 4 ) ).join( ', ' )} ) * time;
    float weather = cfbm( p * 0.4, cseed, 3 ), detail = cfbm( p * 1.3 + 7.0, cseed + 5u, 4 );
    float n = 0.5 * weather + 0.5 * detail, thr = 0.45 - cover * 0.9;
    if ( bands > 0.5 ) { float lat = d.y; n += 0.22 * sin( lat * 28.0 + weather * 4.0 + bands * 5.0 ) + 0.1 * sin( lat * 71.0 - detail * 3.0 + bands * 9.0 ); }
    float a = smoothstep( thr, thr + 0.25, n );
    float light = smoothstep( -0.2, 0.3, dot( d, sunLocal ) );
    float thick = smoothstep( thr + 0.05, thr + 0.5, n );
    vec3 c = mix( vec3( 0.40, 0.43, 0.50 ), tint, light ) * ( 1.0 - thick * 0.2 * light );
    if ( bands > 0.5 ) c *= 0.85 + 0.15 * sin( d.y * 28.0 + weather * 4.0 + bands * 5.0 );
    if ( ! gl_FrontFacing ) c *= 0.88;
    a *= smoothstep( 40.0, 300.0, distance( vWorld, cameraPosition ) );
    gl_FragColor = vec4( c, a * 0.94 );
    #include <fog_fragment>
}`,
    } );
}

export function addClouds( body, rnd ) {
    const k = KINDS[ body.kind ];
    if ( ! k.atmosphere ) return;
    if ( k.deck ) return addDecks( body, rnd );
    const cover = body.kind === 'icy' ? 0.1 + rnd * 0.4 : 0.12 + rnd * 0.6;
    const radius = body.radius * ( 1 + k.amp * 4 ) + Math.max( 500, body.radius * 0.012 );
    const mat = hazed( cloudMaterial( body.seed % 1000003, cover, body.kind === 'icy' ? 0xf4f7fb : 0xffffff ) );
    const mesh = new THREE.Mesh( new THREE.SphereGeometry( radius, 72, 48 ), mat );
    mesh.renderOrder = 4;
    body.group.add( mesh );
    body.cloud = { mesh, mat, cover, radius, seed: body.seed % 1000003 };
}

// A gas giant: three near-opaque, banded, sickly decks between 0.72 and 1.0 of its visible size, each with
// its own seed and drift, so the descent is layer after layer of murk until the dim core appears.
function addDecks( body, rnd ) {
    const tints = [ 0xc9bd6a, 0xa89a5c, 0x8c7f4e ];
    body.decks = [];
    [ 1.0, 0.86, 0.72 ].forEach( ( f, i ) => {
        const mat = hazed( cloudMaterial( ( body.seed * 7 + i * 9977 + 131 ) % 1000003, 0.78 + rnd * 0.15, tints[ i ] ) );
        mat.uniforms.bands.value = 1 + i * 0.37;
        const radius = body.size * f, mesh = new THREE.Mesh( new THREE.SphereGeometry( radius, 96, 64 ), mat );
        mesh.renderOrder = 4 - i;
        body.group.add( mesh );
        body.decks.push( { mesh, mat, cover: 0.78 + rnd * 0.15, radius, seed: ( body.seed + i * 977 ) % 1000003 } );
    } );
    body.cloud = body.decks[ 0 ];
}

// The home world's layer: a flat disc 1.6 km over the sea, curved down with the ground, matching the sea disc.
export function homeClouds( group, seed, spawn, seaY ) {
    const cover = 0.15 + ( seed % 97 ) / 97 * 0.5;
    const mat = hazed( cloudMaterial( seed % 1000003, cover, 0xffffff, true ) );
    const mesh = new THREE.Mesh( new THREE.RingGeometry( 1, 200000, 128, 40 ).rotateX( -Math.PI / 2 ), mat );
    mesh.position.set( spawn.x, seaY + 1600, spawn.z );
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    group.add( mesh );
    return { mesh, mat, cover, flat: true, y: seaY + 1600, seed: seed % 1000003 };
}
