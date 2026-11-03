import * as THREE from 'three';
import { Pool } from './pool.js';
import { Shell, BASE, InteriorShell, RockFrame } from './shell.js';
import { FarField } from './far.js';
import { Space } from './space.js';
import { Player } from './player.js';
import { Crumbs } from './crumbs.js';
import { BIOMES, SEA, CHUNK } from './blocks.js';
import { tickFades, hole } from './materials.js';

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
const fill = new THREE.DirectionalLight( 0x8090b8, 0.45 );
fill.position.copy( sunDir ).negate();
const ambient = new THREE.AmbientLight( 0x50586c, 0.6 );
scene.add( sun, fill, hemi, ambient );

const pool = new Pool();
const home = new Shell( scene, pool, seed, radius );
const world = home.world;
const far = new FarField( scene, pool, seed, radius );
const space = new Space( scene, pool, seed, radius, sunDir );
const player = new Player( camera, home, canvas );
const crumbs = new Crumbs( scene, spacing );

const hud = {};
for ( const id of [ 'alt', 'biome', 'coord', 'chunks', 'seed', 'mode', 'crumbs', 'speed', 'body' ] ) hud[ id ] = document.getElementById( id );
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
    const f = target.clone().sub( player.pos );
    player.yaw = Math.atan2( -f.x, -f.z );
    player.pitch = Math.max( -1.5, Math.min( 1.5, Math.atan2( f.y, Math.hypot( f.x, f.z ) ) ) );
}

function travel( kind, index = 0 ) {
    leaveShell();
    player.vel.set( 0, 0, 0 );
    player.flying = true;
    const away = ( from, pos, dist ) => {
        const dir = pos.clone().sub( from );
        if ( dir.lengthSq() < 1 ) dir.set( 0.3, 0.4, 1 );
        return from.clone().addScaledVector( dir.normalize(), dist );
    };
    if ( kind === 'home' ) {
        player.pos.set( 8.5, 140, 8.5 );
        player.yaw = 0; player.pitch = -0.5;
        world.update( 8, 8 );
    } else if ( kind === 'planet' ) {
        const b = space.bodies[ index ];
        player.pos.copy( away( b.pos, player.pos, b.radius * 2.6 ) );
        lookAt( b.pos );
    } else if ( kind === 'rock' ) {
        const r = space.nearestRock( player.pos );
        player.pos.copy( away( r.pos, player.pos, r.radius * 4 + 60 ) );
        lookAt( r.pos );
    } else if ( kind === 'ship' ) {
        const sh = space.nearestShip( player.pos );
        const side = new THREE.Vector3( 1, 0.35, 0 ).applyQuaternion( sh.group.quaternion ).normalize();
        const span = sh.cls === 'capital' ? 130 : sh.cls === 'medium' ? 70 : 60;
        player.pos.copy( sh.group.position ).addScaledVector( side, span * sh.voxel );
        lookAt( sh.group.position );
    } else if ( kind === 'station' ) {
        const st = space.nearestStation( player.pos );
        player.pos.copy( away( st.group.position, player.pos, 90 * st.voxel ) );
        lookAt( st.group.position );
    }
    crumbs.last = null;
}

const NAV = { Digit1: [ 'planet', 0 ], Digit2: [ 'planet', 1 ], Digit3: [ 'planet', 2 ], Digit4: [ 'planet', 3 ], Digit5: [ 'planet', 4 ], Digit6: [ 'rock' ], Digit7: [ 'ship' ], Digit8: [ 'station' ], Digit0: [ 'home' ] };
document.addEventListener( 'keydown', ( e ) => {
    if ( e.repeat || ! overlay.classList.contains( 'hidden' ) ) return;
    if ( e.code === 'KeyB' ) crumbs.toggle();
    if ( e.code === 'KeyX' ) crumbs.clear();
    if ( NAV[ e.code ] ) travel( ...NAV[ e.code ] );
    if ( e.code === 'Enter' ) useAirlock();
} );
const nav = document.getElementById( 'nav' );
const navItems = [ ...space.bodies.map( ( b, i ) => [ `${i + 1}`, `${b.name}`, `${b.kind}, ${( b.radius / 1000 ).toFixed( 1 )} km`, [ 'planet', i ] ] ),
    [ '6', 'Nearest asteroid', 'belt and strays', [ 'rock' ] ], [ '7', 'Nearest ship', 'skiffs to capitals', [ 'ship' ] ], [ '8', 'Nearest station', 'in orbit', [ 'station' ] ], [ '0', 'Home', 'the spawn shore', [ 'home' ] ] ];
for ( const [ key, name, sub, args ] of navItems ) {
    const b = document.createElement( 'button' );
    b.type = 'button';
    b.innerHTML = `<kbd>${key}</kbd><span>${name}</span><small>${sub}</small>`;
    b.addEventListener( 'click', () => { travel( ...args ); overlay.classList.add( 'hidden' ); canvas.requestPointerLock(); } );
    nav.appendChild( b );
}
document.getElementById( 'reroll' ).addEventListener( 'click', () => { seedInput.value = randomWord(); } );
const radiusSelect = document.getElementById( 'radius' );
if ( ! [ ...radiusSelect.options ].some( ( o ) => o.value === String( radius ) ) ) radiusSelect.add( new Option( `custom (${radius} chunks)`, String( radius ) ) );
radiusSelect.value = String( radius );
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
const retiring = [];

function enterShell( body ) {
    const wp = player.worldPos;
    const dir = body.group.worldToLocal( wp.clone() ).normalize();
    const shell = new Shell( scene, pool, seed, radius, body, dir );
    const old = player.shell;
    player.moveTo( shell );
    shell.world.update( player.pos.x, player.pos.z );
    if ( old.planet ) retiring.push( { shell: old, t: 0 } );
}

function leaveShell() {
    if ( player.shell === home ) return;
    const old = player.shell;
    player.moveTo( home );
    old.dispose();
    hole.r1.value = -1;
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
    player.pos.copy( lock ).addScaledVector( out, 7 );
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
    const a = space.nearestAirlock( player.pos );
    return a && a.d < 45 ? a : null;
}

function useAirlock() {
    if ( nearDoor() ) exitInterior();
    else { const a = nearAirlock(); if ( a ) enterInterior( a.vessel ); }
}

function manageShells( dt ) {
    for ( let i = retiring.length - 1; i >= 0; i-- ) {
        const r = retiring[ i ];
        r.t += dt;
        if ( r.t > 4 || player.world.loaded( player.pos.x, player.pos.z ) ) { r.shell.dispose(); retiring.splice( i, 1 ); }
    }
    if ( player.shell.planet ) {
        const sh = player.shell, alt = player.pos.y - BASE, horiz = Math.hypot( player.pos.x, player.pos.z );
        if ( alt > 350 || horiz > radius * CHUNK + 32 ) { leaveShell(); return; }
        if ( horiz > 64 ) enterShell( sh.body );
        sh.originWorld( hole.center.value );
        hole.r0.value = radius * CHUNK - 24; hole.r1.value = radius * CHUNK + 8;
    } else if ( player.shell.radial ) {
        const rk = player.shell.rock;
        if ( ! rk.mesh || player.pos.length() > rk.radius * 3 + 80 ) leaveShell();
    } else if ( player.shell === home && player.inSpace ) {
        for ( const b of space.bodies ) {
            const wp = player.pos, d = wp.distanceTo( b.pos );
            if ( d < b.radius * 1.3 && d - space.surfaceRadius( b, wp ) < 220 ) { enterShell( b ); return; }
        }
        const rk = space.nearestRock( player.pos, true );
        if ( rk && rk.pos.distanceTo( player.pos ) < rk.radius * 2.5 + 25 ) {
            const frame = new RockFrame( rk, player.pos );
            player.moveTo( frame );
        }
    }
    const a = nearAirlock();
    prompt.textContent = nearDoor() ? 'airlock · Enter to go outside' : a ? `${a.vessel.name || a.vessel.cls + ' ship'} airlock · Enter to board` : '';
}

const timer = new THREE.Timer();
let hudTimer = 0;
const lastPos = new THREE.Vector3(), homePos = new THREE.Vector3( 8, 60, 8 );

function frame() {
    requestAnimationFrame( frame );
    timer.update();
    const dt = Math.min( 0.05, timer.getDelta() );
    const worldPos = player.worldPos;
    const alt = worldPos.y - SEA;
    if ( ! spawned || ( player.shell === home && player.pos.y < 700 ) ) world.update( player.pos.x, player.pos.z );
    world.absorb( 3 );
    if ( player.shell.planet || player.shell.interior ) { player.world.update( player.pos.x, player.pos.z ); player.world.absorb( 4 ); }
    if ( player.shell === home ) homePos.copy( worldPos );
    far.update( dt, homePos, world );
    ambient.intensity = player.shell.interior ? 2.2 : 0.6;
    tickFades( dt );
    lastPos.copy( worldPos );
    if ( ! spawned ) {
        if ( world.loaded( 8, 8 ) ) { player.place( 8, 8 ); spawned = true; }
        if ( spawned && ! pose ) crumbs.last = null;
    } else if ( ! pose ) { manageShells( dt ); player.step( dt, space ); crumbs.step( player.worldPos ); }
    else player.placeCamera();
    const spaceness = Math.min( 1, Math.max( 0, ( alt - 1500 ) / 9000 ) );
    skyMat.uniforms.space.value = spaceness;
    hemi.intensity = 1.15 - spaceness * 1.0;
    sky.position.copy( camera.position );
    space.update( dt, camera.position, spaceness );
    const under = player.eyeInWater();
    tint.classList.toggle( 'on', under );
    hudTimer += dt;
    if ( hudTimer > 0.15 ) {
        const speed = lastPos.distanceTo( player.worldPos ) / dt;
        hudTimer = 0;
        const onPlanet = player.shell.planet;
        const b = player.world.biome( player.pos.x, player.pos.z );
        hud.alt.textContent = onPlanet ? fmtDist( player.pos.y - ( player.shell.seaLevel ?? BASE ) ) : fmtDist( alt );
        hud.biome.textContent = onPlanet || player.shell.interior ? ( b < 0 ? '…' : BIOMES[ b ] ) : player.shell.radial ? 'asteroid' : alt > 2000 ? ( spaceness >= 1 ? 'open space' : 'upper air' ) : b < 0 ? '…' : BIOMES[ b ];
        hud.coord.textContent = `${worldPos.x.toFixed( 0 )}, ${worldPos.z.toFixed( 0 )}`;
        const s = player.world.stats, f = far.stats;
        hud.chunks.textContent = `${s.loaded}${s.pending ? ` +${s.pending}` : ''} · ${f.fine + f.coarse} tiles`;
        const where = onPlanet ? ` on ${player.shell.body.name}` : player.shell.radial ? ' on an asteroid' : player.shell.interior ? ` aboard ${player.shell.vessel.name || player.shell.vessel.cls + ' ship'}` : '';
        hud.mode.textContent = ( player.flying ? 'flying' : under ? 'under' : player.inWater() ? 'swimming' : 'on foot' ) + where;
        hud.speed.textContent = speed < 1000 ? `${speed.toFixed( 0 )} m/s` : `${( speed / 1000 ).toFixed( 1 )} km/s`;
        const n = space.nearest( worldPos );
        hud.body.textContent = n ? `${n.name} (${n.kind}) ${fmtDist( Math.max( 0, n.d ) )}` : '–';
        hud.crumbs.textContent = crumbs.on ? `every ${crumbs.spacing} m · ${crumbs.count}` : crumbs.count ? `off · ${crumbs.count}` : 'off';
    }
    renderer.render( scene, camera );
}
frame();

window.__strata = { world, home, far, space, player, crumbs, pool, seed, renderer, scene, travel, enterShell, leaveShell, enterInterior, exitInterior, useAirlock };
