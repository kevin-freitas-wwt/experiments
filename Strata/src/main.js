import * as THREE from 'three';
import { Pool } from './pool.js';
import { World } from './world.js';
import { FarField } from './far.js';
import { Space } from './space.js';
import { Player } from './player.js';
import { Crumbs } from './crumbs.js';
import { BIOMES, SEA } from './blocks.js';

const params = new URLSearchParams( location.search );
const seedWord = params.get( 'seed' ) || randomWord();
const seed = hashSeed( seedWord );
const radius = Math.max( 4, Math.min( 14, parseInt( params.get( 'r' ) || '8', 10 ) ) );
const pose = params.get( 'pose' );
const spacing = Math.max( 1, Math.min( 64, parseFloat( params.get( 'crumb' ) || '8' ) ) );

function randomWord() {
    const a = [ 'ash', 'reed', 'moss', 'fen', 'tor', 'kelp', 'dune', 'cairn', 'scree', 'brine', 'loam', 'frost' ];
    const b = [ 'hollow', 'ridge', 'strand', 'march', 'vale', 'shoal', 'bluff', 'moor', 'reach', 'spur', 'gully', 'drift' ];
    return a[ Math.random() * a.length | 0 ] + '-' + b[ Math.random() * b.length | 0 ];
}

function hashSeed( s ) {
    let h = 2166136261;
    for ( const ch of s ) { h ^= ch.charCodeAt( 0 ); h = Math.imul( h, 16777619 ); }
    return ( h >>> 0 ) % 100000;
}

const canvas = document.getElementById( 'view' );
const renderer = new THREE.WebGLRenderer( { canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true } );
renderer.setPixelRatio( Math.min( devicePixelRatio, 1.5 ) );
renderer.outputColorSpace = THREE.SRGBColorSpace;

const HORIZON = new THREE.Color( 0xeadfca ), ZENITH = new THREE.Color( 0x5d73a3 ), BLACK = new THREE.Color( 0x02030a );
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 72, 1, 0.1, 500000 );

const skyMat = new THREE.ShaderMaterial( {
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { top: { value: ZENITH.clone() }, bottom: { value: HORIZON.clone() }, space: { value: 0 } },
    vertexShader: 'varying float h; void main(){ h = normalize( position ).y; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float space; varying float h; void main(){ float t = smoothstep( -0.02, 0.75, h ); vec3 c = mix( bottom, top, t ); float up = smoothstep( -0.25, 0.15, h ); c = mix( c, vec3( 0.008, 0.012, 0.04 ), space * up + space * space * ( 1.0 - up ) ); gl_FragColor = vec4( c, 1.0 ); }',
} );
const sky = new THREE.Mesh( new THREE.SphereGeometry( 300000, 32, 16 ), skyMat );
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add( sky );

const sunDir = new THREE.Vector3( 0.6, 0.55, 0.35 );
const sun = new THREE.DirectionalLight( 0xfff1d6, 2.4 );
sun.position.copy( sunDir );
const hemi = new THREE.HemisphereLight( 0xdcd8ea, 0x7a6a50, 1.15 );
scene.add( sun, hemi, new THREE.AmbientLight( 0x50586c, 0.6 ) );

const pool = new Pool();
const world = new World( scene, pool, seed, radius );
const far = new FarField( scene, pool, seed, radius );
const space = new Space( scene, pool, seed, radius, sunDir );
const player = new Player( camera, world, canvas );
const crumbs = new Crumbs( scene, spacing );

const hud = {};
for ( const id of [ 'alt', 'biome', 'coord', 'chunks', 'seed', 'mode', 'crumbs', 'speed', 'body' ] ) hud[ id ] = document.getElementById( id );
const overlay = document.getElementById( 'overlay' ), seedInput = document.getElementById( 'seed-input' );
const tint = document.getElementById( 'tint' );
hud.seed.textContent = seedWord;
seedInput.value = seedWord;
document.getElementById( 'seed-stamp' ).textContent = seed.toString().padStart( 5, '0' );

document.getElementById( 'enter' ).addEventListener( 'click', () => {
    const want = seedInput.value.trim();
    if ( want && want !== seedWord ) {
        const q = new URLSearchParams( location.search );
        q.set( 'seed', want );
        location.search = q.toString();
        return;
    }
    overlay.classList.add( 'hidden' );
    canvas.requestPointerLock();
} );
document.getElementById( 'crumb-spacing' ).value = String( spacing );
document.getElementById( 'crumb-spacing' ).addEventListener( 'change', ( e ) => { crumbs.spacing = parseFloat( e.target.value ); } );
document.addEventListener( 'keydown', ( e ) => {
    if ( e.repeat || ! overlay.classList.contains( 'hidden' ) ) return;
    if ( e.code === 'KeyB' ) crumbs.toggle();
    if ( e.code === 'KeyX' ) crumbs.clear();
} );
document.getElementById( 'reroll' ).addEventListener( 'click', () => { seedInput.value = randomWord(); } );
document.getElementById( 'radius' ).value = String( radius );
document.getElementById( 'radius' ).addEventListener( 'change', ( e ) => {
    const q = new URLSearchParams( location.search );
    q.set( 'seed', seedInput.value.trim() || seedWord );
    q.set( 'r', e.target.value );
    location.search = q.toString();
} );
document.addEventListener( 'pointerlockchange', () => {
    if ( ! document.pointerLockElement && ! pose ) overlay.classList.remove( 'hidden' );
} );

function resize() {
    renderer.setSize( innerWidth, innerHeight, false );
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
}
addEventListener( 'resize', resize );
resize();

let spawned = false;
if ( pose ) {
    const [ x, y, z, yaw, pitch ] = pose.split( ',' ).map( Number );
    player.pos.set( x, y, z ); player.yaw = yaw; player.pitch = pitch; player.flying = true;
    overlay.classList.add( 'hidden' );
    document.body.classList.add( 'still' );
    spawned = true;
}

const fmtDist = ( m ) => m < 1000 ? `${m.toFixed( 0 )} m` : m < 100000 ? `${( m / 1000 ).toFixed( 1 ) } km` : `${( m / 1000 ).toFixed( 0 ) } km`;
const timer = new THREE.Timer();
let hudTimer = 0;
const lastPos = new THREE.Vector3();

function frame() {
    requestAnimationFrame( frame );
    timer.update();
    const dt = Math.min( 0.05, timer.getDelta() );
    const alt = player.pos.y - SEA;
    if ( ! spawned || alt < 400 ) world.update( player.pos.x, player.pos.z );
    world.absorb( 3 );
    far.update( dt, player.pos, world );
    lastPos.copy( player.pos );
    if ( ! spawned ) {
        if ( world.loaded( 8, 8 ) ) { player.place( 8, 8 ); spawned = true; }
    } else if ( ! pose ) { player.step( dt, space ); crumbs.step( player.pos ); }
    else { camera.position.set( player.pos.x, player.pos.y + 1.62, player.pos.z ); camera.rotation.set( 0, 0, 0 ); camera.rotateY( player.yaw ); camera.rotateX( player.pitch ); }
    const spaceness = Math.min( 1, Math.max( 0, ( alt - 1500 ) / 9000 ) );
    skyMat.uniforms.space.value = spaceness;
    hemi.intensity = 1.15 - spaceness * 1.0;
    sky.position.copy( camera.position );
    space.update( dt, camera.position, spaceness );
    const under = player.eyeInWater();
    tint.classList.toggle( 'on', under );
    hudTimer += dt;
    if ( hudTimer > 0.15 ) {
        const speed = lastPos.distanceTo( player.pos ) / dt;
        hudTimer = 0;
        const b = world.biome( player.pos.x, player.pos.z );
        hud.alt.textContent = fmtDist( alt );
        hud.biome.textContent = alt > 2000 ? ( spaceness >= 1 ? 'open space' : 'upper air' ) : b < 0 ? '…' : BIOMES[ b ];
        hud.coord.textContent = `${player.pos.x.toFixed( 0 )}, ${player.pos.z.toFixed( 0 )}`;
        const s = world.stats, f = far.stats;
        hud.chunks.textContent = `${s.loaded}${s.pending ? ` +${s.pending}` : ''} · ${f.fine + f.coarse} tiles`;
        hud.mode.textContent = player.flying ? 'flying' : under ? 'under' : player.inWater() ? 'swimming' : 'on foot';
        hud.speed.textContent = speed < 1000 ? `${speed.toFixed( 0 )} m/s` : `${( speed / 1000 ).toFixed( 1 )} km/s`;
        const n = space.nearest( player.pos );
        hud.body.textContent = n ? `${n.name} (${n.kind}) ${fmtDist( Math.max( 0, n.d ) )}` : '–';
        hud.crumbs.textContent = crumbs.on ? `every ${crumbs.spacing} m · ${crumbs.count}` : crumbs.count ? `off · ${crumbs.count}` : 'off';
    }
    renderer.render( scene, camera );
}
frame();

window.__strata = { world, far, space, player, crumbs, pool, seed, renderer, scene };
