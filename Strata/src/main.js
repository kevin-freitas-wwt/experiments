import * as THREE from 'three';
import { Pool } from './pool.js';
import { Shell, InteriorShell, RockFrame } from './shell.js';
import { FarField } from './far.js';
import { PlanetFar } from './pfar.js';
import { Space } from './space.js';
import { Player } from './player.js';
import { Crumbs } from './crumbs.js';
import { Flares } from './flare.js';
import { BIOMES, SEA, CHUNK, LAVA, spawnOf } from './blocks.js';
import { tickFades, hole, tileEdge, waterTime, terrainNow, haze, wx, bioGlow, reflection, WATER_MATS, oceanMat } from './materials.js';
import { Precip, homeAurora, AURORA_MATS } from './weather.js';
import { KINDS } from './planet.js';
import { cloudTime, cloudAt, homeClouds } from './clouds.js';
import { densityAt } from './galaxy.js';
import { is as key, buildControls } from './keys.js';
import { Sound } from './sound.js';

const params = new URLSearchParams( location.search );
const seedWord = params.get( 'seed' ) || randomWord();
const seed = hashSeed( seedWord );
const radius = Math.max( 4, Math.min( 14, parseInt( params.get( 'r' ) || '8', 10 ) ) );
const pose = params.get( 'pose' );
const at = params.get( 'at' ), inside = params.get( 'in' ), onBody = params.get( 'on' );
const spacing = Math.max( 1, Math.min( 64, parseFloat( params.get( 'crumb' ) || '8' ) ) );
if ( params.has( 'stats' ) && params.get( 'stats' ) !== '0' ) document.body.classList.add( 'stats' );

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

const HORIZON = new THREE.Color( 0xeadfca ), ZENITH = new THREE.Color( 0x5d73a3 ), UP_Y = new THREE.Vector3( 0, 1, 0 ), WHITE = new THREE.Color( 0xffffff ), starTint = new THREE.Color();
const ATMOS = Object.fromEntries( Object.entries( KINDS ).map( ( [ k, v ] ) => [ k, v.atmosphere && { zenith: new THREE.Color( v.atmosphere.zenith ), horizon: new THREE.Color( v.atmosphere.horizon ) } ] ) );
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 72, 1, 0.1, 1.2e8 );

const skyMat = new THREE.ShaderMaterial( {
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { top: { value: ZENITH.clone() }, bottom: { value: HORIZON.clone() }, space: { value: 0 }, up: { value: new THREE.Vector3( 0, 1, 0 ) }, sunDir: { value: new THREE.Vector3( 0, 1, 0 ) }, night: { value: 0 }, dusk: { value: 0 } },
    vertexShader: 'uniform vec3 up; varying float h; varying vec3 vDir; void main(){ vDir = normalize( position ); h = dot( vDir, up ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float space; uniform vec3 sunDir; uniform float night; uniform float dusk; varying float h; varying vec3 vDir;
void main(){
    float t = smoothstep( -0.02, 0.75, h );
    vec3 c = mix( bottom, top, t );
    float toSun = max( 0.0, dot( vDir, sunDir ) );
    c = mix( c, vec3( 0.85, 0.5, 0.3 ), dusk * pow( toSun, 5.0 ) * ( 1.0 - t * 0.7 ) );
    c = mix( c, mix( vec3( 0.075, 0.085, 0.14 ), vec3( 0.025, 0.03, 0.07 ), t ), night );
    float up = smoothstep( -0.25, 0.15, h );
    c = mix( c, vec3( 0.008, 0.012, 0.04 ), space * up + space * space * ( 1.0 - up ) );
    gl_FragColor = vec4( c, 1.0 );
}`,
} );
const sky = new THREE.Mesh( new THREE.SphereGeometry( 300000, 32, 16 ), skyMat );
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add( sky );

// The home sun circles the home world once per HOME_DAY seconds on a great circle through the zenith; its
// phase at load comes from the seed. Elsewhere light comes from the nearest star and planets spin under it.
// The home world sits at 47 degrees north on a world tilted 23 degrees, so the sun's noon height and the day's
// length swing with the season (`?day=` 0 to 365, else from the seed; a year passes in thirty home days).
const HOME_DAY = 1440, HOME_LAT = 47 * Math.PI / 180, TILT = 23.4 * Math.PI / 180, YEAR = HOME_DAY * 30;
const sunDir = new THREE.Vector3( 0, 1, 0 );
const sunPhase0 = ( params.has( 'hour' ) ? ( parseFloat( params.get( 'hour' ) ) - 12 ) / 24 : ( seed % 1000 ) / 1000 - 0.5 ) * Math.PI * 2;
const season0 = ( ( params.has( 'day' ) ? parseFloat( params.get( 'day' ) ) : seed % 365 ) - 80 ) / 365;
let season = season0;
function homeSun( t ) {
    season = season0 + t / YEAR;
    const H = sunPhase0 + t / HOME_DAY * Math.PI * 2, dec = TILT * Math.sin( season * Math.PI * 2 );
    sunDir.set( Math.cos( dec ) * Math.sin( H ), Math.sin( HOME_LAT ) * Math.sin( dec ) + Math.cos( HOME_LAT ) * Math.cos( dec ) * Math.cos( H ), Math.cos( HOME_LAT ) * Math.sin( dec ) - Math.sin( HOME_LAT ) * Math.cos( dec ) * Math.cos( H ) );
}
homeSun( 0 );
const sun = new THREE.DirectionalLight( 0xfff1d6, 2.4 );
sun.position.copy( sunDir );
const hemi = new THREE.HemisphereLight( 0xdcd8ea, 0x7a6a50, 1.15 );
const fill = new THREE.DirectionalLight( 0x8090b8, 0.45 );
fill.position.copy( sunDir ).negate();
const ambient = new THREE.AmbientLight( 0x50586c, 0.6 );
const moon = new THREE.DirectionalLight( 0xffffff, 0 );
scene.add( sun, fill, hemi, ambient, moon );

const pool = new Pool();
const home = new Shell( scene, pool, seed, radius );
const world = home.world;
const SPAWN = spawnOf( seed );
const far = new FarField( home.group, pool, seed, radius );
const space = new Space( scene, pool, seed, radius, sunDir );
const player = new Player( camera, home, canvas );
const crumbs = new Crumbs( home.group, spacing );
home.cloud = homeClouds( home.group, seed, SPAWN, SEA );
home.aurora = homeAurora( home.group );
const precip = new Precip( scene );
let rainAmt = 0, prevElev = 0, dawnFog = 0;
const flares = new Flares();
const sound = new Sound();
const V_A = new THREE.Vector3(), V_B = new THREE.Vector3(), V_C = new THREE.Vector3();
const Q_A = new THREE.Quaternion();
const shineColor = new THREE.Color(), BODY_TINT = { icy: 0xe8f0ff, lush: 0xc8d8ee, rocky: 0xd8d2c8, ember: 0xffa070, gas: 0xd8c8a0 };

const hud = {};
for ( const id of [ 'alt', 'biome', 'coord', 'chunks', 'seed', 'mode', 'crumbs', 'speed', 'body', 'system', 'st-frame', 'st-draws', 'st-tris', 'st-workers', 'st-mem' ] ) hud[ id ] = document.getElementById( id );
renderer.info.autoReset = false;
const perf = { frame: 16, js: 0, t0: 0, calls: 0, tris: 0 };
let cloudShade = 0, cloudSys = null;
const overlay = document.getElementById( 'overlay' ), seedInput = document.getElementById( 'seed-input' );
const tint = document.getElementById( 'tint' ), prompt = document.getElementById( 'prompt' );
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
    lockPointer();
} );
// Chrome refuses a new lock for about a second after Esc released the last one, so retry quietly until it takes.
function lockPointer( tries = 8 ) {
    sound.start();
    const p = canvas.requestPointerLock();
    if ( p && p.catch ) p.catch( () => { if ( tries > 0 && overlay.classList.contains( 'hidden' ) ) setTimeout( () => lockPointer( tries - 1 ), 300 ); } );
}
document.getElementById( 'crumb-spacing' ).value = String( spacing );
document.getElementById( 'crumb-spacing' ).addEventListener( 'change', ( e ) => { crumbs.spacing = parseFloat( e.target.value ); } );
function lookAt( target ) {
    const f = target.clone().sub( player.worldPos );
    player.yaw = Math.atan2( -f.x, -f.z );
    player.pitch = Math.max( -1.5, Math.min( 1.5, Math.atan2( f.y, Math.hypot( f.x, f.z ) ) ) );
}

function travel( kind, index = 0, approach = false ) {
    const sh = player.shell, stay = approach && kind === 'planet' && sh.planet && sh.body === index;
    if ( ! stay ) leaveShell();
    player.vel.set( 0, 0, 0 );
    player.flying = true;
    const wp = player.worldPos, go = ( renderPos ) => ( stay ? sh : home ).toLocal( renderPos, player.pos );
    const away = ( from, pos, dist ) => {
        const dir = pos.clone().sub( from );
        if ( dir.lengthSq() < 1 ) dir.set( 0.3, 0.4, 1 );
        return from.clone().addScaledVector( dir.normalize(), dist );
    };
    // Each approach click halves the clearance to the surface, down to `min`, where you are set down.
    const closer = ( center, surfaceR, min, land = false ) => {
        const dir = wp.clone().sub( center );
        if ( dir.lengthSq() < 1 ) dir.set( 0.3, 0.4, 1 );
        const clear = dir.length() - surfaceR, next = clear > min * 2 ? clear / 2 : min;
        if ( land && next === min ) player.flying = false;
        return center.clone().addScaledVector( dir.normalize(), surfaceR + next );
    };
    if ( kind === 'home' ) {
        player.pos.set( SPAWN.x + 0.5, 140, SPAWN.z + 0.5 );
        player.yaw = 0; player.pitch = -0.5;
        world.update( SPAWN.x, SPAWN.z );
    } else if ( kind === 'planet' ) {
        const b = typeof index === 'object' ? index : space.nearestSystem( wp ).bodies[ index ];
        if ( ! b ) return;
        go( approach ? closer( b.pos, space.surfaceRadius( b, wp ), 1.5, true ) : away( b.pos, wp, b.rings ? b.rings.outer * 1.25 : b.size * 2.6 ) );
        lookAt( b.pos );
    } else if ( kind === 'rock' ) {
        const r = typeof index === 'object' ? index : space.nearestRock( wp );
        go( approach ? closer( r.pos, r.radius, 2, true ) : away( r.pos, wp, r.radius * 4 + 60 ) );
        lookAt( r.pos );
    } else if ( kind === 'ship' ) {
        const sh = typeof index === 'object' ? index : space.nearestShip( wp );
        const side = new THREE.Vector3( 1, 0.35, 0 ).applyQuaternion( sh.group.quaternion ).normalize();
        const span = sh.cls === 'capital' ? 130 : sh.cls === 'medium' ? 70 : 60;
        go( approach ? closer( sh.group.position, ( sh.cls === 'capital' ? 55 : sh.cls === 'medium' ? 24 : 12 ) * sh.voxel, 12 ) : sh.group.position.clone().addScaledVector( side, span * sh.voxel ) );
        lookAt( sh.group.position );
    } else if ( kind === 'station' ) {
        const st = typeof index === 'object' ? index : space.nearestStation( wp );
        if ( ! st ) return;
        go( approach ? closer( st.group.position, 32 * st.voxel, 12 ) : away( st.group.position, wp, 90 * st.voxel ) );
        lookAt( st.group.position );
    } else if ( kind === 'star' ) {
        const sys = index;
        go( approach ? closer( sys.starPos, sys.starRadius, sys.starRadius * 0.6 ) : away( sys.starPos, wp, sys.starRadius * 4 ) );
        lookAt( sys.starPos );
    }
    crumbs.last = null;
}

function aimTarget() {
    const origin = camera.position.clone(), dir = new THREE.Vector3( 0, 0, -1 ).applyQuaternion( camera.quaternion );
    let best = null;
    const test = ( pos, radius, kind, obj ) => {
        const oc = pos.clone().sub( origin ), t = oc.dot( dir );
        if ( t < radius ) return;
        const miss = oc.lengthSq() - t * t;
        if ( miss > radius * radius ) return;
        if ( ! best || t < best.t ) best = { t, kind, obj };
    };
    const p = new THREE.Vector3();
    for ( const b of space.bodies ) test( b.pos, b.size * 1.08, 'planet', b );
    for ( const sys of space.systems.values() ) test( sys.starPos, sys.starRadius * 1.3, 'star', sys );
    for ( const r of space.rocks ) test( r.pos, Math.max( r.radius * 1.6, 25 ), 'rock', r );
    for ( const sh of space.ships ) test( sh.group.getWorldPosition( p ), ( sh.cls === 'capital' ? 55 : sh.cls === 'medium' ? 24 : 12 ) * sh.voxel, 'ship', sh );
    for ( const st of space.stations ) test( st.group.getWorldPosition( p ), 32 * st.voxel, 'station', st );
    return best;
}

canvas.addEventListener( 'mousedown', ( e ) => {
    if ( e.button !== 0 || ! player.locked ) return;
    const hit = aimTarget();
    if ( hit ) travel( hit.kind, hit.obj, true );
} );

const NAV = { Digit1: [ 'planet', 0 ], Digit2: [ 'planet', 1 ], Digit3: [ 'planet', 2 ], Digit4: [ 'planet', 3 ], Digit5: [ 'planet', 4 ], Digit6: [ 'planet', 5 ], Digit7: [ 'planet', 6 ], Digit8: [ 'rock' ], Digit9: [ 'ship' ], Minus: [ 'station' ], Digit0: [ 'home' ] };
document.addEventListener( 'keydown', ( e ) => {
    // Esc on the start card is the same as pressing Set out; in play the browser's own Esc releases the pointer and the card returns.
    if ( e.code === 'Escape' && ! pose ) {
        // The press that released the pointer also reaches us (before or after the card appears): that one is not a Set out.
        if ( performance.now() - unlockedAt < 700 || document.pointerLockElement ) return;
        if ( ! overlay.classList.contains( 'hidden' ) ) { e.preventDefault(); document.getElementById( 'enter' ).click(); }
        return;
    }
    if ( e.repeat || ! overlay.classList.contains( 'hidden' ) ) return;
    if ( key( e.code, 'crumbs' ) ) crumbs.toggle();
    if ( key( e.code, 'clear' ) ) crumbs.clear();
    if ( NAV[ e.code ] ) travel( ...NAV[ e.code ] );
    if ( key( e.code, 'airlock' ) ) useAirlock();
    if ( key( e.code, 'snapshot' ) ) snapshot();
    if ( key( e.code, 'stats' ) ) document.body.classList.toggle( 'stats' );
    if ( key( e.code, 'mute' ) ) sound.toggleMute();
} );

function snapshot() {
    renderReflection();
    renderer.render( scene, camera );
    const hl = home.toLocal( player.worldPos );
    canvas.toBlob( ( blob ) => {
        const a = document.createElement( 'a' );
        a.href = URL.createObjectURL( blob );
        a.download = `strata-${seedWord}-${Math.round( hl.x )}-${Math.round( hl.y )}-${Math.round( hl.z )}.png`;
        a.click();
        setTimeout( () => URL.revokeObjectURL( a.href ), 5000 );
    }, 'image/png' );
}

let urlTimer = 0, lastUrl = '';
function shareUrl() {
    const hl = home.toLocal( player.worldPos );
    const q = new URLSearchParams( location.search );
    q.set( 'seed', seedWord );
    q.set( 'at', [ hl.x.toFixed( 1 ), hl.y.toFixed( 1 ), hl.z.toFixed( 1 ), player.yaw.toFixed( 2 ), player.pitch.toFixed( 2 ), player.flying ? 1 : 0 ].join( ',' ) );
    if ( player.shell.interior ) { const v = player.shell.vessel; q.set( 'in', `${v.system.key}/${v.cls ? 'ship' : 'station'}/${v.i}` ); } else q.delete( 'in' );
    // On a planet the place is kept body-local too, since the body has spun (or orbited) by the time the link is opened.
    if ( player.shell.planet ) { const b = player.shell.body, l = b.group.worldToLocal( V_A.copy( player.worldPos ) ); q.set( 'on', `${b.system.key}/${b.system.bodies.indexOf( b )}/${l.x.toFixed( 1 )},${l.y.toFixed( 1 )},${l.z.toFixed( 1 )}` ); } else q.delete( 'on' );
    q.delete( 'pose' );
    const url = `${location.pathname}?${q.toString()}`;
    if ( url !== lastUrl ) { history.replaceState( null, '', url ); lastUrl = url; }
    return location.href;
}
document.getElementById( 'copy-link' ).addEventListener( 'click', async ( e ) => {
    const url = shareUrl();
    try { await navigator.clipboard.writeText( url ); e.target.textContent = 'copied'; } catch { e.target.textContent = 'copy failed'; }
    setTimeout( () => { e.target.textContent = 'copy link'; }, 1600 );
} );
document.getElementById( 'snap' ).addEventListener( 'click', () => { overlay.classList.add( 'hidden' ); requestAnimationFrame( () => { snapshot(); overlay.classList.remove( 'hidden' ); } ); } );
const nav = document.getElementById( 'nav' );
let navSystem = null;
function buildNav( sys ) {
    navSystem = sys;
    nav.innerHTML = '';
    const nPlanets = sys.bodies.length - sys.moons.length;
    document.getElementById( 'nav-title' ).textContent = `${sys.name}, a ${sys.starType.name} (${sys.starType.cls}) · ${nPlanets} planet${nPlanets === 1 ? '' : 's'}, ${sys.moons.length} moon${sys.moons.length === 1 ? '' : 's'}, ${sys.rocks.length} asteroids, ${sys.ships.length} ships, ${sys.stations.length} station${sys.stations.length === 1 ? '' : 's'}`;
    const items = [ ...sys.bodies.slice( 0, 7 ).map( ( b, i ) => [ `${i + 1}`, b.name, `${b.orbit ? 'moon of ' + b.orbit.host.name + ', ' : ''}${b.kind === "gas" ? "gas giant" : b.kind}, ${( b.size / 1000 ).toFixed( 1 )} km`, [ 'planet', i ] ] ),
        [ '8', 'Nearest asteroid', 'belt and strays', [ 'rock' ] ], [ '9', 'Nearest ship', 'skiffs to capitals', [ 'ship' ] ] ];
    if ( sys.stations.length ) items.push( [ '-', 'Nearest station', 'in orbit', [ 'station' ] ] );
    items.push( [ '0', 'Home', 'the spawn shore', [ 'home' ] ] );
    for ( const [ key, name, sub, args ] of items ) {
        const b = document.createElement( 'button' );
        b.type = 'button';
        b.innerHTML = `<kbd>${key}</kbd><span>${name}</span><small>${sub}</small>`;
        b.addEventListener( 'click', () => { travel( ...args ); overlay.classList.add( 'hidden' ); lockPointer(); } );
        nav.appendChild( b );
    }
}
buildNav( space.home );
buildControls( document.querySelector( '.controls' ), [
    [ '<kbd>1</kbd>&ndash;<kbd>7</kbd> <kbd>8</kbd> <kbd>9</kbd> <kbd>-</kbd> <kbd>0</kbd>', 'jump to a planet of the nearest system, the nearest asteroid, ship or station, or home' ],
    [ '<kbd>Esc</kbd>', 'on this card, the same as Set out; in play, back to this card' ],
    [ 'mouse', 'look &middot; click with the ring on a planet, star, asteroid, ship or station to jump to it' ],
] );

document.getElementById( 'reroll' ).addEventListener( 'click', () => { seedInput.value = randomWord(); } );
const radiusSelect = document.getElementById( 'radius' );
if ( ! [ ...radiusSelect.options ].some( ( o ) => o.value === String( radius ) ) ) radiusSelect.add( new Option( `custom (${radius} chunks)`, String( radius ) ) );
radiusSelect.value = String( radius );
radiusSelect.addEventListener( 'change', ( e ) => {
    const q = new URLSearchParams( location.search );
    q.set( 'seed', seedInput.value.trim() || seedWord );
    q.set( 'r', e.target.value );
    location.search = q.toString();
} );
let unlockedAt = -1e9;
document.addEventListener( 'pointerlockchange', () => {
    if ( ! document.pointerLockElement && ! pose ) { overlay.classList.remove( 'hidden' ); unlockedAt = performance.now(); }
} );
// A click on the view while the card is away but the pointer is free (a lock request Chrome refused) locks it again.
canvas.addEventListener( 'mousedown', () => { if ( overlay.classList.contains( 'hidden' ) && ! document.pointerLockElement && ! pose ) lockPointer(); } );

// Planar reflections: the scene mirrored in the liquid plane of the frame you stand in (the home sea, or a
// shell's sea level), rendered at half size with everything below the plane clipped, sampled by the water.
const reflRT = new THREE.WebGLRenderTarget( 2, 2 );
const mirrorCam = new THREE.PerspectiveCamera();
const reflPlane = new THREE.Plane(), noClip = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 1e12 );
renderer.clippingPlanes = [ noClip ];
const R_N = new THREE.Vector3(), R_P = new THREE.Vector3(), R_V = new THREE.Vector3(), R_T = new THREE.Vector3(), R_M = new THREE.Matrix4(), R_Q = new THREE.Quaternion();
const reflOn = params.get( 'refl' ) !== '0';
function renderReflection() {
    const sh = player.shell;
    if ( ! reflOn ) { reflection.strength.value = 0; return; }
    const level = sh === home ? SEA + 0.85 : sh.planet && sh.seaLevel !== null ? sh.seaLevel + 0.85 : null;
    reflection.strength.value = 0;
    if ( level === null || player.shell.interior ) return;
    R_N.set( 0, 1, 0 ).applyQuaternion( sh.quaternion( R_Q ) );
    sh.toWorld( R_P.set( player.pos.x, level, player.pos.z ) );
    const camAlt = R_V.copy( camera.position ).sub( R_P ).dot( R_N );
    if ( camAlt < 0.2 || camAlt > 6000 ) return;
    reflPlane.setFromNormalAndCoplanarPoint( R_N, R_P );
    R_V.copy( R_P ).sub( camera.position );
    R_V.reflect( R_N ).negate().add( R_P );
    R_M.extractRotation( camera.matrixWorld );
    R_T.set( 0, 0, -1 ).applyMatrix4( R_M ).add( camera.position );
    R_T.sub( R_P ).reflect( R_N ).add( R_P );
    mirrorCam.position.copy( R_V );
    mirrorCam.up.set( 0, 1, 0 ).applyMatrix4( R_M ).reflect( R_N );
    mirrorCam.lookAt( R_T );
    mirrorCam.near = camera.near; mirrorCam.far = camera.far;
    mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy( camera.projectionMatrix );
    reflection.matrix.value.set( 0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1 ).multiply( mirrorCam.projectionMatrix ).multiply( mirrorCam.matrixWorldInverse );
    for ( const m of WATER_MATS ) m.visible = false;
    oceanMat.visible = false; space.stars.visible = false;
    renderer.clippingPlanes[ 0 ] = reflPlane;
    renderer.setRenderTarget( reflRT );
    renderer.render( scene, mirrorCam );
    renderer.setRenderTarget( null );
    renderer.clippingPlanes[ 0 ] = noClip;
    for ( const m of WATER_MATS ) m.visible = true;
    oceanMat.visible = true; space.stars.visible = true;
    reflection.map.value = reflRT.texture;
    reflection.strength.value = 1 - THREE.MathUtils.smoothstep( camAlt, 3000, 6000 );
}

function resize() {
    renderer.setSize( innerWidth, innerHeight, false );
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const size = renderer.getDrawingBufferSize( new THREE.Vector2() );
    reflRT.setSize( Math.max( 2, Math.floor( size.x / 2 ) ), Math.max( 2, Math.floor( size.y / 2 ) ) );
}
addEventListener( 'resize', resize );
resize();

let spawned = false;
if ( at && ! pose ) {
    const [ x, y, z, yaw, pitch, fly ] = at.split( ',' ).map( Number );
    if ( [ x, y, z ].every( Number.isFinite ) ) {
        player.pos.set( x, y, z ); player.yaw = yaw || 0; player.pitch = pitch || 0; player.flying = fly !== 0;
        world.update( x, z );
        spawned = true;
    }
}
if ( pose ) {
    const [ x, y, z, yaw, pitch ] = pose.split( ',' ).map( Number );
    player.pos.set( x, y, z ); player.yaw = yaw; player.pitch = pitch; player.flying = true;
    overlay.classList.add( 'hidden' );
    document.body.classList.add( 'still' );
    spawned = true;
}

// Light-time of a distance, shown from a tenth of a second up: the honest scale cue for a 15 million km galaxy.
const fmtLight = ( m ) => { const t = m / 299792458; return t < 0.1 ? '' : t < 60 ? ` · light ${t.toFixed( 1 )} s` : ` · light ${( t / 60 ).toFixed( 1 )} min`; };
const fmtDist = ( m ) => m < 1000 ? `${m.toFixed( 0 )} m` : m < 100000 ? `${( m / 1000 ).toFixed( 1 ) } km` : `${( m / 1000 ).toFixed( 0 ) } km`;

const retiring = [];

function enterShell( body ) {
    const wp = player.worldPos;
    const dir = body.group.worldToLocal( wp.clone() ).normalize();
    const shell = new Shell( scene, pool, seed, radius, body, dir );
    const old = player.shell;
    shell.age = old.planet ? ( old.age || 0 ) : 0;
    player.moveTo( shell );
    shell.world.update( player.pos.x, player.pos.z );
    if ( old.planet ) retiring.push( { shell: old, t: 0 } );
}

function leaveShell() {
    if ( player.shell === home ) return;
    const old = player.shell;
    player.moveTo( home );
    if ( old.planet ) { old.leaving = 0; retiring.push( { shell: old, t: 0, leaving: true } ); }
    else { old.dispose(); hole.r1.value = -1; }
}

function enterInterior( vessel ) {
    leaveShell();
    const shell = new InteriorShell( pool, seed, vessel );
    player.shell = shell;
    player.pos.copy( shell.spawn );
    player.vel.set( 0, 0, 0 );
    player.yaw = vessel.cls ? Math.PI / 2 : 0;
    player.pitch = 0;
    player.flying = false;
    shell.world.update( player.pos.x, player.pos.z );
}

function exitInterior() {
    const shell = player.shell, vessel = shell.vessel;
    const lock = space.airlockPoint( vessel ), centre = vessel.group.getWorldPosition( new THREE.Vector3() );
    const out = lock.clone().sub( centre ).normalize();
    player.shell = home;
    shell.dispose();
    home.toLocal( lock.clone().addScaledVector( out, 7 ), player.pos );
    player.vel.set( 0, 0, 0 );
    player.flying = true;
    lookAt( centre );
}

function nearDoor() {
    const sh = player.shell;
    return sh.interior && player.pos.distanceTo( sh.door ) < 4.5;
}

function nearAirlock() {
    if ( player.shell !== home || ! player.inSpace ) return null;
    const a = space.nearestAirlock( player.worldPos );
    return a && a.d < 45 ? a : null;
}

function useAirlock() {
    if ( nearDoor() ) exitInterior();
    else { const a = nearAirlock(); if ( a ) enterInterior( a.vessel ); }
}

let pfar = null, pfarOld = null;

// Heightfield tiles around the nearest planet you are low over, re-framed when you drift half their range.
function managePlanetFar( dt ) {
    const wp = player.worldPos;
    let best = null;
    for ( const b of space.bodies ) {
        const d = wp.distanceTo( b.pos );
        if ( d > b.size * 1.5 ) continue;
        const alt = d - space.surfaceRadius( b, wp );
        if ( alt < Math.min( 4000 * space.scale, b.radius * 0.5 ) && ( ! best || alt < best.alt ) ) best = { b, alt };
    }
    if ( pfarOld ) {
        pfarOld.t += dt;
        if ( ! pfar || pfar.coveredRadius( pfar.local ) >= pfar.range * 0.8 || pfarOld.t > 8 ) { const o = pfarOld.far; pfarOld = null; o.fadeOut( () => o.dispose() ); }
    }
    if ( ! best ) {
        if ( pfar ) { const o = pfar; pfar = null; o.fadeOut( () => o.dispose() ); }
        return null;
    }
    const local = best.b.group.worldToLocal( V_A.copy( wp ) );
    if ( ! pfar || pfar.body !== best.b || pfar.drift( local ) > 0.5 ) {
        if ( pfar ) {
            if ( pfar.body === best.b && ! pfarOld ) pfarOld = { far: pfar, t: 0 };
            else { const o = pfar; o.fadeOut( () => o.dispose() ); }
        }
        pfar = new PlanetFar( pool, best.b, local, space.scale );
    }
    ( pfar.local || ( pfar.local = new THREE.Vector3() ) ).copy( local );
    const f = best.b.group.worldToLocal( V_B.copy( wp ).add( player.forward( V_C ) ) ).sub( local );
    pfar.update( dt, local, { x: f.dot( pfar.u ), z: f.dot( pfar.w ) } );
    return pfar;
}

function manageShells( dt ) {
    const ringR = radius * CHUNK, pf = managePlanetFar( dt );
    let r0 = -1, r1 = -1;
    const center = hole.center.value.copy( player.worldPos );
    tileEdge.center.value.copy( player.worldPos );
    tileEdge.r1.value = -1;
    const a = nearAirlock();
    prompt.textContent = nearDoor() ? 'airlock · Enter to go outside' : a ? `${a.vessel.name || a.vessel.cls + ' ship'} airlock · Enter to board` : '';
    for ( let i = retiring.length - 1; i >= 0; i-- ) {
        const r = retiring[ i ];
        r.t += dt;
        if ( r.leaving ) {
            const k = 1 - Math.min( 1, r.t / 1.2 );
            if ( ! r.fading ) { r.fading = true; r.shell.world.fadeOut( 1.1, () => {} ); }
            if ( ! player.shell.planet ) { if ( ! pf ) r.shell.originWorld( center ); r0 = ringR * k - 24; r1 = ringR * k + 8; }
            if ( r.t > 1.2 ) { r.shell.dispose(); retiring.splice( i, 1 ); }
        } else {
            const ready = player.world.stats.pending === 0 && player.world.chunks.size > 0;
            if ( ! r.fading && ( ready || r.t > 6 ) ) { r.fading = true; r.shell.world.fadeOut( 0.8, () => {} ); r.t = 0; }
            if ( r.fading && r.t > 0.9 ) { r.shell.dispose(); retiring.splice( i, 1 ); }
        }
    }
    if ( pf ) {
        const tc = pf.coveredRadius( pf.local );
        if ( tc > 300 ) { r0 = Math.max( r0, tc - 260 ); r1 = Math.max( r1, tc - 60 ); }
    }
    if ( player.shell.planet ) {
        const sh = player.shell, alt = player.pos.y - sh.base, horiz = Math.hypot( player.pos.x, player.pos.z );
        if ( onLook && onLook.body === sh.body ) { player.yaw = onLook.yaw; player.pitch = onLook.pitch; player.frameQ.copy( sh.quaternion( player.q ) ); onLook = null; }
        const covered = Math.min( ringR, sh.world.coveredRadius( player.pos.x, player.pos.z ) );
        r0 = Math.max( r0, covered - 24 ); r1 = Math.max( r1, covered + 8 );
        tileEdge.r0.value = covered - 48; tileEdge.r1.value = covered + 16;
        hole.r0.value = r0; hole.r1.value = r1;
        if ( alt > 350 ) { leaveShell(); return; }
        const recenter = Math.min( 400, Math.max( 64, sh.body.radius * 0.07 ) );
        if ( horiz > recenter && ! retiring.some( ( r ) => ! r.leaving ) ) enterShell( sh.body );
        return;
    }
    hole.r0.value = r0; hole.r1.value = r1;
    if ( player.shell.radial ) {
    } else if ( player.shell.radial ) {
        const rk = player.shell.rock;
        if ( ! rk.mesh || player.pos.length() > rk.radius * 3 + 80 ) leaveShell();
        return;
    }
    if ( player.shell === home && player.inSpace ) {
        const wp = player.worldPos;
        for ( const b of space.bodies ) {
            const d = wp.distanceTo( b.pos );
            if ( d < b.radius * 1.3 && d - space.surfaceRadius( b, wp ) < 220 ) { enterShell( b ); return; }
        }
        const rk = space.nearestRock( wp, true );
        if ( rk && rk.pos.distanceTo( wp ) < rk.radius * 2.5 + 25 ) {
            const frame = new RockFrame( rk, wp );
            player.moveTo( frame );
        }
    }
}

const timer = new THREE.Timer();
let hudTimer = 0, soundTimer = 0;
const lastPos = new THREE.Vector3(), homePos = new THREE.Vector3( SPAWN.x, 60, SPAWN.z );

function frame() {
    requestAnimationFrame( frame );
    perf.t0 = performance.now();
    renderer.info.reset();
    player.frame++;
    timer.update();
    const dt = Math.min( 0.05, timer.getDelta() );
    const worldPos = player.worldPos, homeLocal = home.toLocal( worldPos );
    const offHome = Math.hypot( homeLocal.x - SPAWN.x, homeLocal.z - SPAWN.z ) > 220000;
    const alt = offHome ? 1e9 : homeLocal.y - SEA;
    const face = { x: -Math.sin( player.yaw ), z: -Math.cos( player.yaw ) };
    if ( ! spawned ) world.update( SPAWN.x, SPAWN.z );
    else if ( player.shell === home && player.pos.y < 700 && ! offHome ) world.update( player.pos.x, player.pos.z, face.x, face.z );
    world.absorb( 3 );
    if ( player.shell.planet || player.shell.interior ) { player.world.update( player.pos.x, player.pos.z, face.x, face.z ); player.world.absorb( 4 ); }
    if ( player.shell === home ) homePos.copy( player.pos );
    far.update( dt, homePos, world, player.shell === home ? face : null );
    tickFades( dt );
    waterTime.value += dt;
    cloudTime.value += dt;
    terrainNow.value = performance.now() / 1000;
    lastPos.copy( worldPos );
    // Bodies spin and moons orbit before the player and camera are placed, so a frame riding a planet is not a frame behind it.
    space.update( dt, camera.position, skyMat.uniforms.space.value );
    if ( ! spawned ) {
        if ( world.loaded( SPAWN.x, SPAWN.z ) ) { player.place( SPAWN.x, SPAWN.z ); spawned = true; }
        if ( spawned && ! pose ) crumbs.last = null;
    } else if ( ! pose ) { manageShells( dt ); player.step( dt, space ); crumbs.step( home.toLocal( player.worldPos ) ); }
    else player.placeCamera();
    if ( camera.position.length() > 50000 ) {
        const delta = camera.position.clone().divideScalar( 1000 ).round().multiplyScalar( 1000 );
        space.rebase( delta );
        home.group.position.sub( delta );
        lastPos.sub( delta );
        player.frame++;
        player.placeCamera();
    }
    const nearSys = space.nearestSystem( player.worldPos );
    if ( nearSys && nearSys !== navSystem ) buildNav( nearSys );
    if ( nearSys ) sun.color.lerp( starTint.set( nearSys.starColor ).lerp( WHITE, 0.4 ), 1 - Math.exp( -dt * 2 ) );
    if ( space.home ) {
        homeSun( pose ? 0 : timer.getElapsed() );
        space.home.setSunDir( sunDir );
    }
    if ( nearSys ) { V_A.copy( nearSys.starPos ).sub( camera.position ).normalize(); sun.position.copy( V_A ); fill.position.copy( V_A ).negate(); skyMat.uniforms.sunDir.value.copy( V_A ); }
    let spaceness = Math.min( 1, Math.max( 0, ( alt - 1500 ) / 9000 ) );
    let skyUp = UP_Y, skyTop = ZENITH, skyBottom = HORIZON, hazeBody = null;
    for ( const b of space.bodies ) {
        const atm = ATMOS[ b.kind ];
        if ( ! atm ) continue;
        const d = worldPos.distanceTo( b.pos );
        if ( d < b.size * 12 && ( ! hazeBody || d / b.size < hazeBody.d / hazeBody.b.size ) ) hazeBody = { b, d };
        if ( d > b.size + 11000 ) continue;
        const bAlt = d - space.surfaceRadius( b, worldPos ) - ( b.size - b.radius );
        const sp = Math.min( 1, Math.max( 0, ( bAlt - 1500 ) / 9000 ) );
        if ( sp < spaceness ) { spaceness = sp; skyUp = V_A.copy( worldPos ).sub( b.pos ).normalize(); skyTop = atm.zenith; skyBottom = atm.horizon; }
    }
    // Aerial perspective follows the nearest atmosphere: a planet within twelve radii, or the home world on its disc.
    if ( hazeBody ) {
        const b = hazeBody.b, k = KINDS[ b.kind ];
        haze.on.value = 1; haze.flat.value = 0; haze.center.value.copy( b.pos ); haze.r.value = b.radius * ( 1 + k.seaLevel * k.amp * 4 );
        haze.k.value = b.kind === 'icy' ? 3e-5 : b.kind === 'gas' ? 1.0e-4 : 4.5e-5; haze.color.value.copy( ATMOS[ b.kind ].horizon ); haze.zenith.value.copy( ATMOS[ b.kind ].zenith );
        haze.h.value = b.kind === 'gas' ? Math.max( 2500, ( b.size - b.radius ) * 0.35 ) : 2500; haze.top.value = b.kind === 'gas' ? b.size - haze.r.value + 12000 : 12000;
        haze.sun.value.copy( b.system.starPos ).sub( b.pos ).normalize();
    } else if ( ! offHome ) {
        haze.on.value = 1; haze.flat.value = 1; haze.seaY.value = home.group.position.y + SEA; haze.k.value = 4.5e-5; haze.h.value = 2500; haze.top.value = 12000; haze.color.value.copy( HORIZON ); haze.zenith.value.copy( ZENITH );
        haze.sun.value.copy( sunDir );
    } else haze.on.value = 0;
    // How much a day sky washes out things beyond the air (zenith value): used for star glows and flares.
    if ( haze.on.value ) {
        const camAlt = haze.flat.value ? camera.position.y - haze.seaY.value : camera.position.distanceTo( haze.center.value ) - haze.r.value;
        const up = haze.flat.value ? UP_Y : V_A.copy( camera.position ).sub( haze.center.value ).normalize();
        const tau = haze.k.value * haze.h.value * Math.exp( -Math.max( 0, camAlt ) / haze.h.value );
        space.skyVeil = THREE.MathUtils.smoothstep( up.dot( haze.sun.value ), -0.1, 0.2 ) * ( 1 - Math.exp( -tau * haze.veil.value ) );
        space.lit = hazeBody ? hazeBody.b.system : space.home;
    } else { space.skyVeil = 0; space.lit = null; }
    // Cloud cover between you and the star: dims direct light and the flare, so an overcast day reads as one.
    cloudShade = 0;
    home.cloud.mat.uniforms.sunLocal.value.copy( sunDir );
    // The home layer only exists for someone over the disc: from below or beyond it, the curvature drop would bend it into view.
    home.cloud.mesh.visible = ! offHome && homeLocal.y > -500;
    if ( ! hazeBody && ! offHome && homeLocal.y < home.cloud.y && sunDir.y > 0.02 ) {
        const t = ( home.cloud.y - homeLocal.y ) / sunDir.y;
        cloudShade = cloudAt( home, V_A.set( homeLocal.x + sunDir.x * t - SPAWN.x, 0, homeLocal.z + sunDir.z * t - SPAWN.z ) );
        cloudSys = space.home;
    } else if ( hazeBody && hazeBody.b.cloud ) {
        const b = hazeBody.b;
        for ( const deck of b.decks || [ b.cloud ] ) {
            const rc = deck.radius, oc = V_A.copy( camera.position ).sub( b.pos ), r2 = oc.lengthSq();
            if ( r2 >= rc * rc ) continue;
            const dir = V_B.copy( b.system.starPos ).sub( camera.position ).normalize(), tb = -oc.dot( dir );
            const t = tb + Math.sqrt( Math.max( 0, tb * tb - ( r2 - rc * rc ) ) );
            const a = cloudAt( { cloud: deck }, b.group.worldToLocal( V_C.copy( camera.position ).addScaledVector( dir, t ) ).normalize() );
            cloudShade = 1 - ( 1 - cloudShade ) * ( 1 - a );
            cloudSys = b.system;
        }
    }
    // Weather. Rain (snow where it is cold) falls from the dense heart of the cloud overhead; it wets the
    // ground, which dries over minutes. The snow line follows the season and the latitude. Valley fog pools
    // for an hour either side of sunrise on clear mornings. Auroras hang near the poles at night.
    let overhead = 0, cold = false, inAir = ! player.shell.interior && skyMat.uniforms.space.value < 0.5;
    if ( hazeBody ) {
        const b = hazeBody.b, k = KINDS[ b.kind ], relief = b.radius * k.amp * 4;
        wx.flat.value = 0; wx.center.value.copy( b.pos ); wx.r.value = haze.r.value; wx.axis.value.set( 0, 1, 0 ).applyQuaternion( b.group.quaternion );
        wx.snowLine.value = b.kind === 'lush' ? relief * ( 0.42 - k.seaLevel ) : 1e9; wx.season.value = relief * 0.1 * Math.sin( season * Math.PI * 2 ); wx.polar.value = relief * 0.45; wx.soft.value = Math.max( 20, relief * 0.04 );
        if ( b.cloud && ! b.decks && hazeBody.d < b.cloud.radius ) {
            overhead = cloudAt( { cloud: b.cloud }, b.group.worldToLocal( V_A.copy( camera.position ) ).normalize(), undefined, true );
            const lat = V_A.dot( wx.axis.value ), line = wx.snowLine.value + wx.season.value * lat - wx.polar.value * lat * lat;
            cold = b.kind === 'icy' || hazeBody.d - wx.r.value > line;
        }
    } else if ( ! offHome ) {
        wx.flat.value = 1; wx.seaY.value = haze.seaY.value; wx.snowLine.value = 98 - SEA; wx.season.value = 36 * Math.sin( season * Math.PI * 2 ); wx.polar.value = 0; wx.soft.value = 12;
        if ( homeLocal.y < home.cloud.y ) overhead = cloudAt( home, V_A.set( homeLocal.x - SPAWN.x, 0, homeLocal.z - SPAWN.z ), undefined, true );
        cold = homeLocal.y - SEA > wx.snowLine.value + wx.season.value;
    } else { wx.snowLine.value = 1e9; inAir = false; }
    const rainTarget = inAir ? overhead : 0;
    rainAmt += ( rainTarget - rainAmt ) * Math.min( 1, dt * 0.5 );
    wx.wet.value += ( ( cold ? 0 : rainAmt ) - wx.wet.value ) * Math.min( 1, dt / ( rainAmt > wx.wet.value ? 15 : 90 ) );
    if ( ! haze.on.value ) wx.wet.value = 0;
    precip.update( dt, rainTarget, cold ? 1 : 0, player.shell.quaternion( Q_A ), camera.position );
    if ( haze.on.value ) haze.k.value *= 1 + rainAmt * 1.5;
    wx.sky.value.copy( skyMat.uniforms.bottom.value ).lerp( skyMat.uniforms.top.value, 0.5 );
    const ease = 1 - Math.exp( -dt * 3 );
    skyMat.uniforms.space.value += ( spaceness - skyMat.uniforms.space.value ) * ease;
    skyMat.uniforms.up.value.lerp( skyUp, ease ).normalize();
    skyMat.uniforms.top.value.lerp( skyTop, ease );
    skyMat.uniforms.bottom.value.lerp( skyBottom, ease );
    hemi.position.copy( skyMat.uniforms.up.value );
    const elev = skyMat.uniforms.sunDir.value.dot( skyMat.uniforms.up.value ), sp = skyMat.uniforms.space.value;
    const day = THREE.MathUtils.smoothstep( elev, -0.1, 0.16 ) * ( 1 - sp ) + sp;
    skyMat.uniforms.night.value = 1 - day;
    const rising = elev > prevElev + 1e-7;
    prevElev = elev;
    const fogWant = haze.on.value && ( ! hazeBody || hazeBody.b.kind === 'lush' ) ? Math.exp( -( ( ( elev - 0.05 ) / 0.18 ) ** 2 ) ) * ( rising ? 1 : 0.15 ) * ( 1 - cloudShade * 0.6 ) * ( 1 - sp ) : 0;
    dawnFog += ( fogWant - dawnFog ) * Math.min( 1, dt * 0.2 );
    haze.fog.value = dawnFog * 4e-3; haze.fogH.value = 40;
    for ( const m of AURORA_MATS ) m.uniforms.time.value = timer.getElapsed();
    home.aurora.mesh.visible = ! offHome && ! hazeBody;
    home.aurora.mesh.position.set( homeLocal.x, SEA + 11000, homeLocal.z - 36000 );
    home.aurora.mat.uniforms.night.value = THREE.MathUtils.smoothstep( -sunDir.y, 0.03, 0.15 ) * ( 1 - sp );
    skyMat.uniforms.dusk.value = ( 1 - THREE.MathUtils.smoothstep( Math.abs( elev - 0.03 ), 0, 0.3 ) ) * ( 1 - sp );
    sun.intensity = 2.4 * ( sp + ( 1 - sp ) * THREE.MathUtils.smoothstep( elev, -0.04, 0.12 ) ) * ( 1 - 0.6 * cloudShade );
    // Night light comes from what is actually up there: the galaxy's own glow where you stand (bright in the
    // bulge, faint in the halo), and shine from lit moons and planets above the horizon, with ring shine
    // when you stand on a ringed world. Exaggerated well past real moonlight so nights read.
    const ALBEDO = { icy: 0.7, lush: 0.35, rocky: 0.25, ember: 0.2, gas: 0.5 };
    const skyUpNow = skyMat.uniforms.up.value;
    let shine = 0, best = 0;
    shineColor.setRGB( 0, 0, 0 );
    for ( const b of space.bodies ) {
        if ( player.shell.body === b ) continue;
        const d = V_A.copy( b.pos ).sub( worldPos ).length();
        if ( d > b.radius * 80 ) continue;
        V_A.divideScalar( d );
        if ( V_A.dot( skyUpNow ) < -0.05 ) continue;
        const phase = 0.5 + 0.5 * V_B.copy( b.system.starPos ).sub( b.pos ).normalize().dot( V_C.copy( V_A ).negate() );
        const k = 2.4 * ( b.size / d ) ** 2 * phase * ( ALBEDO[ b.kind ] || 0.3 ) * 20;
        if ( k < 0.002 ) continue;
        shine += k;
        shineColor.add( starTint.set( BODY_TINT[ b.kind ] || 0xffffff ).multiplyScalar( k ) );
        if ( k > best ) { best = k; moon.position.copy( V_A ); }
    }
    const ringed = player.shell.body && player.shell.body.rings ? player.shell.body : null;
    if ( ringed ) { shine += 0.12; shineColor.add( starTint.set( 0xf2e6d0 ).multiplyScalar( 0.12 ) ); if ( ! best ) moon.position.copy( ringed.ringNormal ); }
    if ( shine > 0 ) shineColor.multiplyScalar( 1 / shine );
    moon.color.lerp( shineColor, 1 - Math.exp( -dt * 3 ) );
    moon.intensity += ( Math.min( 0.45, shine ) * ( 1 - 0.85 * day ) - moon.intensity ) * ( 1 - Math.exp( -dt * 3 ) );
    const starlight = 0.1 + 0.2 * Math.min( 3, Math.sqrt( densityAt( homeLocal.x, homeLocal.y, homeLocal.z, seed ) ) ) + Math.min( 0.3, shine * 0.6 );
    hemi.intensity = ( 1.15 - sp * 1.0 ) * ( starlight + ( 1 - starlight ) * day );
    ambient.intensity = ( player.shell.interior ? 2.2 : 0.6 ) * ( 0.25 + 0.5 * starlight + ( 0.75 - 0.5 * starlight ) * day );
    space.night = 1 - day;
    sky.position.copy( camera.position );
    space.stars.position.copy( camera.position ); // after the camera is placed, so the star shell never lags it
    space.starField.place( homeLocal );
    const under = player.eyeInWater();
    tint.classList.toggle( 'on', under );
    // Under the surface everything sinks into the liquid's own murk; lava is a glowing red wall.
    const eyeBlock = under ? player.world.block( Math.floor( player.pos.x ), Math.floor( player.pos.y + 1.6 ), Math.floor( player.pos.z ) ) : 0;
    haze.under.value = under ? 1 : 0;
    if ( under ) { const lava = eyeBlock === LAVA; haze.underColor.value.set( lava ? 0x7a2208 : 0x0b3340 ).multiplyScalar( lava ? 1 : 0.35 + 0.65 * day ); haze.underK.value = lava ? 0.4 : 0.045; tint.style.background = lava ? 'rgba(140, 50, 12, 0.5)' : ''; }
    wx.time.value += dt;
    wx.caustic.value = ( player.shell === home || ( player.shell.body && player.shell.body.kind === 'lush' ) ) ? day * ( 1 - 0.7 * cloudShade ) : 0;
    bioGlow.value = ( player.shell === home || ( player.shell.body && player.shell.body.kind === 'lush' ) ) ? ( 1 - day ) * ( 1 - day ) : 0;
    hudTimer += dt;
    if ( hudTimer > 0.15 ) {
        const speed = lastPos.distanceTo( player.worldPos ) / dt;
        hudTimer = 0;
        const onPlanet = player.shell.planet;
        const b = player.world.biome( player.pos.x, player.pos.z );
        hud.alt.textContent = onPlanet ? fmtDist( player.pos.y - ( player.shell.seaLevel ?? player.shell.base ) ) : player.shell === home && ! offHome ? fmtDist( alt ) : fmtDist( worldPos.distanceTo( home.toWorld( new THREE.Vector3( SPAWN.x, SEA, SPAWN.z ) ) ) );
        hud.biome.textContent = onPlanet || player.shell.interior ? ( b < 0 ? '…' : BIOMES[ b ] ) : player.shell.radial ? 'asteroid' : alt > 2000 ? ( spaceness >= 1 ? 'deep space' : 'upper air' ) : b < 0 ? '…' : BIOMES[ b ];
        hud.coord.textContent = `${homeLocal.x.toFixed( 0 )}, ${homeLocal.z.toFixed( 0 )}`;
        const s = player.world.stats, f = far.stats;
        hud.chunks.textContent = `${s.loaded}${s.pending ? ` +${s.pending}` : ''} · ${f.fine + f.coarse} tiles`;
        const where = onPlanet ? ` on ${player.shell.body.name}` : player.shell.radial ? ' on an asteroid' : player.shell.interior ? ` aboard ${player.shell.vessel.name || player.shell.vessel.cls + ' ship'}` : '';
        hud.mode.textContent = ( player.flying ? 'flying' : under ? 'under' : player.inWater() ? 'swimming' : 'on foot' ) + where;
        hud.speed.textContent = ( speed < 1000 ? `${speed.toFixed( 0 )} m/s` : `${( speed / 1000 ).toFixed( 1 )} km/s` ) + ( player.flying && player.boost > 1.05 ? ` · boost ${player.boost.toFixed( 1 )}×` : '' );
        const n = space.nearest( worldPos );
        hud.body.textContent = n ? `${n.name} (${n.kind}) ${fmtDist( Math.max( 0, n.d ) )}${fmtLight( n.d )}` : '–';
        hud.system.textContent = navSystem ? `${navSystem.name} · ${fmtDist( navSystem.center.distanceTo( worldPos ) )}${fmtLight( navSystem.center.distanceTo( worldPos ) )}` : '–';
        hud.crumbs.textContent = crumbs.on ? `every ${crumbs.spacing} m · ${crumbs.count}` : crumbs.count ? `off · ${crumbs.count}` : 'off';
        if ( document.body.classList.contains( 'stats' ) ) {
            const m = renderer.info.memory;
            hud[ 'st-frame' ].textContent = `${perf.frame.toFixed( 1 )} ms · ${( 1000 / perf.frame ).toFixed( 0 )} fps · js ${perf.js.toFixed( 1 )} ms`;
            hud[ 'st-draws' ].textContent = `${perf.calls}`;
            hud[ 'st-tris' ].textContent = perf.tris > 1e6 ? `${( perf.tris / 1e6 ).toFixed( 2 )} M` : `${( perf.tris / 1e3 ).toFixed( 0 ) } k`;
            hud[ 'st-workers' ].textContent = `${pool.workers.filter( ( w ) => w.job ).length} busy · ${pool.queue.length} queued`;
            hud[ 'st-mem' ].textContent = `${m.geometries} geometries · ${m.textures} textures`;
        }
    }
    soundTimer += dt;
    if ( soundTimer > 0.25 ) {
        soundTimer = 0;
        const w = player.world, px = Math.floor( player.pos.x ), pz = Math.floor( player.pos.z ), seaY = player.shell === home ? SEA : player.shell.seaLevel;
        let wet = 0;
        if ( seaY !== null && seaY !== undefined && ( player.shell === home || player.shell.planet ) ) for ( let i = 0; i < 12; i++ ) { const a = i / 12 * Math.PI * 2; for ( const r of [ 6, 18, 40 ] ) { const tt = w.top( Math.floor( px + Math.cos( a ) * r ), Math.floor( pz + Math.sin( a ) * r ) ); if ( tt > 0 && tt <= seaY ) { wet += r === 6 ? 1 : r === 18 ? 0.6 : 0.3; break; } } }
        const kind = player.shell.body ? player.shell.body.kind : 'lush';
        const airless = player.shell.planet && ! KINDS[ kind ].atmosphere;
        const top = w.top( px, pz ), height = top < 380 ? Math.max( 0, player.pos.y - top ) : ( player.shell === home ? Math.max( 0, player.pos.y - SEA ) : 0 );
        sound.update( 0.25, { speed: lastPos.distanceTo( player.worldPos ) / Math.max( dt, 0.001 ), height, air: airless ? 0 : 1 - skyMat.uniforms.space.value, water: Math.min( 1, wet / 6 ), inside: !! player.shell.interior, space: skyMat.uniforms.space.value, rain: rainAmt * ( precip.u.snow.value > 0.5 ? 0.15 : 1 ) } );
    }
    renderReflection();
    renderer.render( scene, camera );
    flares.update( dt, camera, [ ...space.systems.values() ].map( ( sys ) => {
        const d = sys.starPos.distanceTo( camera.position );
        return { pos: sys.starPos, color: starTint.set( sys.starColor ).clone(), bright: sys.lum * Math.pow( 250000 / d, 2 ) * 110 * ( sys === cloudSys ? 1 - 0.95 * cloudShade : 1 ) * ( sys === space.lit ? 1 : 1 - ( space.skyVeil || 0 ) ) };
    } ), ( pos ) => {
        if ( player.shell.interior ) return true;
        const dir = V_B.copy( pos ).sub( camera.position ), len = dir.length();
        dir.divideScalar( len );
        for ( const b of space.bodies ) {
            const oc = V_C.copy( b.pos ).sub( camera.position ), t = oc.dot( dir );
            if ( t <= 0 || t >= len ) continue;
            if ( oc.lengthSq() - t * t < b.radius * b.radius ) return true;
        }
        if ( player.shell === home && ! offHome ) {
            const up = dir.y, below = homeLocal.y - SEA;
            if ( up < -0.02 && below < 2000 ) return true;
        }
        return false;
    }, renderer );
    flares.render( renderer );
    perf.frame += ( timer.getDelta() * 1000 - perf.frame ) * 0.08;
    perf.calls = renderer.info.render.calls; perf.tris = renderer.info.render.triangles;
    perf.js += ( performance.now() - perf.t0 - perf.js ) * 0.08;
    if ( spawned && ! pose ) {
        if ( performance.now() - urlTimer > 1000 ) { urlTimer = performance.now(); shareUrl(); }
        if ( inside && ! insideDone ) restoreInterior();
        if ( onBody && ! onDone ) restoreOn();
    }
}
let insideDone = false, onDone = false, onLook = null;
function restoreOn() {
    const [ key, idx, pos ] = onBody.split( '/' );
    const sys = space.systems.get( key );
    if ( ! sys ) { if ( space.stats.systems > 1 || key === '0,0,0' ) onDone = true; return; }
    const b = sys.bodies[ Number( idx ) ];
    onDone = true;
    if ( ! b ) return;
    const [ x, y, z ] = pos.split( ',' ).map( Number );
    leaveShell();
    home.toLocal( b.group.localToWorld( new THREE.Vector3( x, y, z ) ), player.pos );
    player.vel.set( 0, 0, 0 );
    onLook = { yaw: player.yaw, pitch: player.pitch, body: b };
}
function restoreInterior() {
    const [ key, kind, idx ] = inside.split( '/' );
    const sys = space.systems.get( key );
    if ( ! sys ) { if ( space.stats.systems > 1 || key === '0,0,0' ) insideDone = true; return; }
    const v = ( kind === 'ship' ? sys.ships : sys.stations )[ Number( idx ) ];
    insideDone = true;
    if ( v ) enterInterior( v );
}
frame();

window.__strata = { world, home, far, space, player, crumbs, pool, seed, renderer, scene, camera, flares, reflRT, mirrorCam, sound, wx, precip, haze, travel, enterShell, leaveShell, enterInterior, exitInterior, useAirlock };
