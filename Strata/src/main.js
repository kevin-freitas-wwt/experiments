import * as THREE from 'three';
import { Pool } from './pool.js';
import { Shell, BASE, InteriorShell, RockFrame } from './shell.js';
import { FarField } from './far.js';
import { Space } from './space.js';
import { Player } from './player.js';
import { Crumbs } from './crumbs.js';
import { BIOMES, SEA, CHUNK, spawnOf } from './blocks.js';
import { tickFades, hole } from './materials.js';
import { KINDS } from './planet.js';

const params = new URLSearchParams( location.search );
const seedWord = params.get( 'seed' ) || randomWord();
const seed = hashSeed( seedWord );
const radius = Math.max( 4, Math.min( 14, parseInt( params.get( 'r' ) || '8', 10 ) ) );
const pose = params.get( 'pose' );
const at = params.get( 'at' ), inside = params.get( 'in' );
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

const HORIZON = new THREE.Color( 0xeadfca ), ZENITH = new THREE.Color( 0x5d73a3 ), UP_Y = new THREE.Vector3( 0, 1, 0 ), WHITE = new THREE.Color( 0xffffff ), starTint = new THREE.Color();
const ATMOS = Object.fromEntries( Object.entries( KINDS ).map( ( [ k, v ] ) => [ k, v.atmosphere && { zenith: new THREE.Color( v.atmosphere.zenith ), horizon: new THREE.Color( v.atmosphere.horizon ) } ] ) );
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 72, 1, 0.1, 500000 );

const skyMat = new THREE.ShaderMaterial( {
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { top: { value: ZENITH.clone() }, bottom: { value: HORIZON.clone() }, space: { value: 0 }, up: { value: new THREE.Vector3( 0, 1, 0 ) } },
    vertexShader: 'uniform vec3 up; varying float h; void main(){ h = dot( normalize( position ), up ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
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
const fill = new THREE.DirectionalLight( 0x8090b8, 0.45 );
fill.position.copy( sunDir ).negate();
const ambient = new THREE.AmbientLight( 0x50586c, 0.6 );
scene.add( sun, fill, hemi, ambient );

const pool = new Pool();
const home = new Shell( scene, pool, seed, radius );
const world = home.world;
const SPAWN = spawnOf( seed );
const far = new FarField( home.group, pool, seed, radius );
const space = new Space( scene, pool, seed, radius, sunDir );
const player = new Player( camera, home, canvas );
const crumbs = new Crumbs( home.group, spacing );

const hud = {};
for ( const id of [ 'alt', 'biome', 'coord', 'chunks', 'seed', 'mode', 'crumbs', 'speed', 'body', 'system' ] ) hud[ id ] = document.getElementById( id );
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
    canvas.requestPointerLock();
} );
document.getElementById( 'crumb-spacing' ).value = String( spacing );
document.getElementById( 'crumb-spacing' ).addEventListener( 'change', ( e ) => { crumbs.spacing = parseFloat( e.target.value ); } );
function lookAt( target ) {
    const f = target.clone().sub( player.worldPos );
    player.yaw = Math.atan2( -f.x, -f.z );
    player.pitch = Math.max( -1.5, Math.min( 1.5, Math.atan2( f.y, Math.hypot( f.x, f.z ) ) ) );
}

function travel( kind, index = 0 ) {
    leaveShell();
    player.vel.set( 0, 0, 0 );
    player.flying = true;
    const wp = player.worldPos, go = ( renderPos ) => home.toLocal( renderPos, player.pos );
    const away = ( from, pos, dist ) => {
        const dir = pos.clone().sub( from );
        if ( dir.lengthSq() < 1 ) dir.set( 0.3, 0.4, 1 );
        return from.clone().addScaledVector( dir.normalize(), dist );
    };
    if ( kind === 'home' ) {
        player.pos.set( SPAWN.x + 0.5, 140, SPAWN.z + 0.5 );
        player.yaw = 0; player.pitch = -0.5;
        world.update( SPAWN.x, SPAWN.z );
    } else if ( kind === 'planet' ) {
        const b = typeof index === 'object' ? index : space.nearestSystem( wp ).bodies[ index ];
        if ( ! b ) return;
        go( away( b.pos, wp, b.rings ? b.rings.outer * 1.25 : b.radius * 2.6 ) );
        lookAt( b.pos );
    } else if ( kind === 'rock' ) {
        const r = typeof index === 'object' ? index : space.nearestRock( wp );
        go( away( r.pos, wp, r.radius * 4 + 60 ) );
        lookAt( r.pos );
    } else if ( kind === 'ship' ) {
        const sh = typeof index === 'object' ? index : space.nearestShip( wp );
        const side = new THREE.Vector3( 1, 0.35, 0 ).applyQuaternion( sh.group.quaternion ).normalize();
        const span = sh.cls === 'capital' ? 130 : sh.cls === 'medium' ? 70 : 60;
        go( sh.group.position.clone().addScaledVector( side, span * sh.voxel ) );
        lookAt( sh.group.position );
    } else if ( kind === 'station' ) {
        const st = typeof index === 'object' ? index : space.nearestStation( wp );
        if ( ! st ) return;
        go( away( st.group.position, wp, 90 * st.voxel ) );
        lookAt( st.group.position );
    } else if ( kind === 'star' ) {
        const sys = index;
        go( away( sys.starPos, wp, sys.starRadius * 4 ) );
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
    for ( const b of space.bodies ) test( b.pos, b.radius * 1.08, 'planet', b );
    for ( const sys of space.systems.values() ) test( sys.starPos, sys.starRadius * 1.3, 'star', sys );
    for ( const r of space.rocks ) test( r.pos, Math.max( r.radius * 1.6, 25 ), 'rock', r );
    for ( const sh of space.ships ) test( sh.group.getWorldPosition( p ), ( sh.cls === 'capital' ? 55 : sh.cls === 'medium' ? 24 : 12 ) * sh.voxel, 'ship', sh );
    for ( const st of space.stations ) test( st.group.getWorldPosition( p ), 32 * st.voxel, 'station', st );
    return best;
}

canvas.addEventListener( 'mousedown', ( e ) => {
    if ( e.button !== 0 || ! player.locked ) return;
    const hit = aimTarget();
    if ( hit ) travel( hit.kind, hit.obj );
} );

const NAV = { Digit1: [ 'planet', 0 ], Digit2: [ 'planet', 1 ], Digit3: [ 'planet', 2 ], Digit4: [ 'planet', 3 ], Digit5: [ 'planet', 4 ], Digit6: [ 'planet', 5 ], Digit7: [ 'planet', 6 ], Digit8: [ 'rock' ], Digit9: [ 'ship' ], Minus: [ 'station' ], Digit0: [ 'home' ] };
document.addEventListener( 'keydown', ( e ) => {
    if ( e.repeat || ! overlay.classList.contains( 'hidden' ) ) return;
    if ( e.code === 'KeyB' ) crumbs.toggle();
    if ( e.code === 'KeyX' ) crumbs.clear();
    if ( NAV[ e.code ] ) travel( ...NAV[ e.code ] );
    if ( e.code === 'Enter' ) useAirlock();
    if ( e.code === 'KeyP' ) snapshot();
} );

function snapshot() {
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
    document.getElementById( 'nav-title' ).textContent = `${sys.name}, a ${sys.starType.name} (${sys.starType.cls}) · ${sys.bodies.length} planet${sys.bodies.length === 1 ? '' : 's'}, ${sys.rocks.length} asteroids, ${sys.ships.length} ships, ${sys.stations.length} station${sys.stations.length === 1 ? '' : 's'}`;
    const items = [ ...sys.bodies.slice( 0, 7 ).map( ( b, i ) => [ `${i + 1}`, b.name, `${b.kind}, ${( b.radius / 1000 ).toFixed( 1 )} km`, [ 'planet', i ] ] ),
        [ '8', 'Nearest asteroid', 'belt and strays', [ 'rock' ] ], [ '9', 'Nearest ship', 'skiffs to capitals', [ 'ship' ] ] ];
    if ( sys.stations.length ) items.push( [ '-', 'Nearest station', 'in orbit', [ 'station' ] ] );
    items.push( [ '0', 'Home', 'the spawn shore', [ 'home' ] ] );
    for ( const [ key, name, sub, args ] of items ) {
        const b = document.createElement( 'button' );
        b.type = 'button';
        b.innerHTML = `<kbd>${key}</kbd><span>${name}</span><small>${sub}</small>`;
        b.addEventListener( 'click', () => { travel( ...args ); overlay.classList.add( 'hidden' ); canvas.requestPointerLock(); } );
        nav.appendChild( b );
    }
}
buildNav( space.home );

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

function manageShells( dt ) {
    const ringR = radius * CHUNK;
    for ( let i = retiring.length - 1; i >= 0; i-- ) {
        const r = retiring[ i ];
        r.t += dt;
        if ( r.leaving ) {
            const k = 1 - Math.min( 1, r.t / 1.2 );
            if ( ! r.fading ) { r.fading = true; r.shell.world.fadeOut( 1.1, () => {} ); }
            if ( ! player.shell.planet ) { r.shell.originWorld( hole.center.value ); hole.r0.value = ringR * k - 24; hole.r1.value = ringR * k + 8; }
            if ( r.t > 1.2 ) { r.shell.dispose(); retiring.splice( i, 1 ); if ( ! player.shell.planet ) hole.r1.value = -1; }
        } else {
            const ready = player.world.stats.pending === 0 && player.world.chunks.size > 0;
            if ( ! r.fading && ( ready || r.t > 6 ) ) { r.fading = true; r.shell.world.fadeOut( 0.8, () => {} ); r.t = 0; }
            if ( r.fading && r.t > 0.9 ) { r.shell.dispose(); retiring.splice( i, 1 ); }
        }
    }
    if ( player.shell.planet ) {
        const sh = player.shell, alt = player.pos.y - BASE, horiz = Math.hypot( player.pos.x, player.pos.z );
        if ( alt > 350 ) { leaveShell(); return; }
        const recenter = Math.min( 400, Math.max( 64, sh.body.radius * 0.07 ) );
        if ( horiz > recenter && ! retiring.some( ( r ) => ! r.leaving ) ) enterShell( sh.body );
        sh.age = ( sh.age || 0 ) + dt;
        const k = Math.min( 1, sh.age / 1.4 );
        hole.center.value.copy( player.worldPos );
        hole.r0.value = ringR * k - 24; hole.r1.value = ringR * k + 8;
    } else if ( player.shell.radial ) {
        const rk = player.shell.rock;
        if ( ! rk.mesh || player.pos.length() > rk.radius * 3 + 80 ) leaveShell();
    } else if ( player.shell === home && player.inSpace ) {
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
    const a = nearAirlock();
    prompt.textContent = nearDoor() ? 'airlock · Enter to go outside' : a ? `${a.vessel.name || a.vessel.cls + ' ship'} airlock · Enter to board` : '';
}

const timer = new THREE.Timer();
let hudTimer = 0;
const lastPos = new THREE.Vector3(), homePos = new THREE.Vector3( SPAWN.x, 60, SPAWN.z );

function frame() {
    requestAnimationFrame( frame );
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
    ambient.intensity = player.shell.interior ? 2.2 : 0.6;
    tickFades( dt );
    lastPos.copy( worldPos );
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
        player.placeCamera();
    }
    const nearSys = space.nearestSystem( player.worldPos );
    if ( nearSys && nearSys !== navSystem ) buildNav( nearSys );
    if ( nearSys ) sun.color.lerp( starTint.set( nearSys.starColor ).lerp( WHITE, 0.4 ), 1 - Math.exp( -dt * 2 ) );
    let spaceness = Math.min( 1, Math.max( 0, ( alt - 1500 ) / 9000 ) );
    let skyUp = UP_Y, skyTop = ZENITH, skyBottom = HORIZON;
    for ( const b of space.bodies ) {
        const atm = ATMOS[ b.kind ];
        if ( ! atm ) continue;
        const d = worldPos.distanceTo( b.pos );
        if ( d > b.radius + 11000 ) continue;
        const bAlt = d - space.surfaceRadius( b, worldPos );
        const sp = Math.min( 1, Math.max( 0, ( bAlt - 1500 ) / 9000 ) );
        if ( sp < spaceness ) { spaceness = sp; skyUp = worldPos.clone().sub( b.pos ).normalize(); skyTop = atm.zenith; skyBottom = atm.horizon; }
    }
    const ease = 1 - Math.exp( -dt * 3 );
    skyMat.uniforms.space.value += ( spaceness - skyMat.uniforms.space.value ) * ease;
    skyMat.uniforms.up.value.lerp( skyUp, ease ).normalize();
    skyMat.uniforms.top.value.lerp( skyTop, ease );
    skyMat.uniforms.bottom.value.lerp( skyBottom, ease );
    hemi.position.copy( skyMat.uniforms.up.value );
    hemi.intensity = 1.15 - skyMat.uniforms.space.value * 1.0;
    sky.position.copy( camera.position );
    space.update( dt, camera.position, skyMat.uniforms.space.value );
    const under = player.eyeInWater();
    tint.classList.toggle( 'on', under );
    hudTimer += dt;
    if ( hudTimer > 0.15 ) {
        const speed = lastPos.distanceTo( player.worldPos ) / dt;
        hudTimer = 0;
        const onPlanet = player.shell.planet;
        const b = player.world.biome( player.pos.x, player.pos.z );
        hud.alt.textContent = onPlanet ? fmtDist( player.pos.y - ( player.shell.seaLevel ?? BASE ) ) : player.shell === home && ! offHome ? fmtDist( alt ) : fmtDist( worldPos.distanceTo( home.toWorld( new THREE.Vector3( SPAWN.x, SEA, SPAWN.z ) ) ) );
        hud.biome.textContent = onPlanet || player.shell.interior ? ( b < 0 ? '…' : BIOMES[ b ] ) : player.shell.radial ? 'asteroid' : alt > 2000 ? ( spaceness >= 1 ? 'deep space' : 'upper air' ) : b < 0 ? '…' : BIOMES[ b ];
        hud.coord.textContent = `${homeLocal.x.toFixed( 0 )}, ${homeLocal.z.toFixed( 0 )}`;
        const s = player.world.stats, f = far.stats;
        hud.chunks.textContent = `${s.loaded}${s.pending ? ` +${s.pending}` : ''} · ${f.fine + f.coarse} tiles`;
        const where = onPlanet ? ` on ${player.shell.body.name}` : player.shell.radial ? ' on an asteroid' : player.shell.interior ? ` aboard ${player.shell.vessel.name || player.shell.vessel.cls + ' ship'}` : '';
        hud.mode.textContent = ( player.flying ? 'flying' : under ? 'under' : player.inWater() ? 'swimming' : 'on foot' ) + where;
        hud.speed.textContent = speed < 1000 ? `${speed.toFixed( 0 )} m/s` : `${( speed / 1000 ).toFixed( 1 )} km/s`;
        const n = space.nearest( worldPos );
        hud.body.textContent = n ? `${n.name} (${n.kind}) ${fmtDist( Math.max( 0, n.d ) )}` : '–';
        hud.system.textContent = navSystem ? `${navSystem.name} · ${fmtDist( navSystem.center.distanceTo( worldPos ) )}` : '–';
        hud.crumbs.textContent = crumbs.on ? `every ${crumbs.spacing} m · ${crumbs.count}` : crumbs.count ? `off · ${crumbs.count}` : 'off';
    }
    renderer.render( scene, camera );
    if ( spawned && ! pose ) {
        if ( performance.now() - urlTimer > 1000 ) { urlTimer = performance.now(); shareUrl(); }
        if ( inside && ! insideDone ) restoreInterior();
    }
}
let insideDone = false;
function restoreInterior() {
    const [ key, kind, idx ] = inside.split( '/' );
    const sys = space.systems.get( key );
    if ( ! sys ) { if ( space.stats.systems > 1 || key === '0,0,0' ) insideDone = true; return; }
    const v = ( kind === 'ship' ? sys.ships : sys.stations )[ Number( idx ) ];
    insideDone = true;
    if ( v ) enterInterior( v );
}
frame();

window.__strata = { world, home, far, space, player, crumbs, pool, seed, renderer, scene, travel, enterShell, leaveShell, enterInterior, exitInterior, useAirlock };
