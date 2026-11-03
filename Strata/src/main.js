import * as THREE from 'three';
import { World } from './world.js';
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
const renderer = new THREE.WebGLRenderer( { canvas, antialias: false, powerPreference: 'high-performance' } );
renderer.setPixelRatio( Math.min( devicePixelRatio, 1.5 ) );
renderer.outputColorSpace = THREE.SRGBColorSpace;

const HORIZON = new THREE.Color( 0xeadfca ), ZENITH = new THREE.Color( 0x5d73a3 );
const scene = new THREE.Scene();
scene.fog = new THREE.Fog( HORIZON, radius * 16 * 0.45, radius * 16 * 0.95 );

const camera = new THREE.PerspectiveCamera( 72, 1, 0.1, radius * 16 * 1.6 );

const sky = new THREE.Mesh(
    new THREE.SphereGeometry( radius * 16 * 1.4, 24, 12 ),
    new THREE.ShaderMaterial( {
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: ZENITH }, bottom: { value: HORIZON } },
        vertexShader: 'varying float h; void main(){ h = normalize( position ).y; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ float t = smoothstep( -0.02, 0.75, h ); gl_FragColor = vec4( mix( bottom, top, t ), 1.0 ); }',
    } )
);
scene.add( sky );

const sun = new THREE.DirectionalLight( 0xfff1d6, 2.4 );
sun.position.set( 0.6, 0.8, 0.35 );
scene.add( sun, new THREE.HemisphereLight( 0xdcd8ea, 0x7a6a50, 1.15 ) );

const world = new World( scene, seed, radius );
const player = new Player( camera, world, canvas );
const crumbs = new Crumbs( scene, spacing );

const hud = {
    alt: document.getElementById( 'alt' ), biome: document.getElementById( 'biome' ),
    coord: document.getElementById( 'coord' ), chunks: document.getElementById( 'chunks' ),
    seed: document.getElementById( 'seed' ), mode: document.getElementById( 'mode' ), crumbs: document.getElementById( 'crumbs' ),
};
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

const timer = new THREE.Timer();
let hudTimer = 0;

function frame() {
    requestAnimationFrame( frame );
    timer.update();
    const dt = Math.min( 0.05, timer.getDelta() );
    world.update( player.pos.x, player.pos.z );
    world.absorb( 3 );
    if ( ! spawned ) {
        if ( world.loaded( 8, 8 ) ) { player.place( 8, 8 ); spawned = true; }
    } else if ( ! pose ) { player.step( dt ); crumbs.step( player.pos ); }
    else { camera.position.set( player.pos.x, player.pos.y + 1.62, player.pos.z ); camera.rotation.set( 0, 0, 0 ); camera.rotateY( player.yaw ); camera.rotateX( player.pitch ); }
    sky.position.copy( camera.position );
    const under = player.eyeInWater();
    tint.classList.toggle( 'on', under );
    scene.fog.near = under ? 2 : radius * 16 * 0.45;
    scene.fog.far = under ? 28 : radius * 16 * 0.95;
    scene.fog.color.set( under ? 0x1f3d66 : HORIZON );
    hudTimer += dt;
    if ( hudTimer > 0.15 ) {
        hudTimer = 0;
        const b = world.biome( player.pos.x, player.pos.z );
        hud.alt.textContent = ( player.pos.y - SEA ).toFixed( 0 );
        hud.biome.textContent = b < 0 ? '…' : BIOMES[ b ];
        hud.coord.textContent = `${player.pos.x.toFixed( 0 )}, ${player.pos.z.toFixed( 0 )}`;
        const s = world.stats;
        hud.chunks.textContent = s.pending ? `${s.loaded} +${s.pending}` : `${s.loaded}`;
        hud.mode.textContent = player.flying ? 'flying' : under ? 'under' : player.inWater() ? 'swimming' : 'on foot';
        hud.crumbs.textContent = crumbs.on ? `every ${crumbs.spacing} m · ${crumbs.count}` : crumbs.count ? `off · ${crumbs.count}` : 'off';
    }
    renderer.render( scene, camera );
}
frame();

window.__strata = { world, player, crumbs, seed };
