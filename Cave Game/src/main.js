import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { CELL } from "./sections.js";
import { buildLevel, cellAt, key, loadLevel } from "./level.js";
import { LIQUID_Y } from "./caves.js";

const EYE = 1.7;
const RADIUS = 0.45;
const STEP = 0.7;
const GRAVITY = 22;
const WALK = 5.2;
const RUN = 9.5;
const LIFT = 3.2;
const LIFT_ACCEL = 4;
const SINK = 2.2;
const ACCEL = 10.5;
const LEVELS = [ "gallery", "sample", "descent" ];

const params = new URLSearchParams( location.search );
const levelName = LEVELS.includes( params.get( "level" ) ) ? params.get( "level" ) : LEVELS[ 0 ];
const level = await loadLevel( levelName );

// --- Renderer / scene / camera ------------------------------------------------

const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 1.5 ) );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x0b0e14 );
// `view` is the draw distance in cells; fog is tuned so nothing pops at the edge.
const VIEW = level.view ?? 5;
scene.fog = new THREE.FogExp2( 0x0b0e14, level.fog ?? 2.2 / ( VIEW * CELL ) );

const camera = new THREE.PerspectiveCamera( 72, window.innerWidth / window.innerHeight, 0.1, ( VIEW + 1 ) * CELL * 1.8 );
scene.add( camera );

// --- Light --------------------------------------------------------------------

// `ambient` in the level JSON scales the fill: ~0.6 for a cave, 8+ to see everything.
scene.add( new THREE.HemisphereLight( 0xf4f1ea, 0x8c7f70, level.ambient ?? 0.6 ) );

const lamp = new THREE.SpotLight( 0xffe3b4, 220, 70, 0.7, 0.7, 2 );
lamp.position.set( 0.2, -0.3, 0 );
lamp.target.position.set( 0, -0.4, -4 );
camera.add( lamp, lamp.target );

// --- World --------------------------------------------------------------------

const t0 = performance.now();
const built = buildLevel( level );
scene.add( built.group );
console.info( `${ level.name }: ${ built.cells.size } cells built in ${ Math.round( performance.now() - t0 ) } ms` );
built.warnings.forEach( ( w ) => console.warn( w ) );

const cellList = [ ...built.cells.values() ];
let lastCull = "";

// Hide cells beyond VIEW and collide only with the 3×3×3 block around the player.
let colliders = [];
function cull( c ) {
    const k = key( c.x, c.y, c.z );
    if ( k === lastCull ) {
        return;
    }
    lastCull = k;
    colliders = built.ground ? [ built.ground ] : [];
    for ( const cell of cellList ) {
        const dx = Math.abs( cell.x - c.x );
        const dy = Math.abs( cell.y - c.y );
        const dz = Math.abs( cell.z - c.z );
        cell.group.visible = Math.max( dx, dy, dz ) <= VIEW;
        if ( dx <= 1 && dy <= 1 && dz <= 1 ) {
            colliders.push( ...cell.meshes );
        }
    }
}

// --- Player -------------------------------------------------------------------

const feet = new THREE.Vector3( level.spawn.x * CELL, level.spawn.y * CELL, level.spawn.z * CELL );
let vy = 0;
let grounded = false;
let flying = false;

const controls = new PointerLockControls( camera, renderer.domElement );
camera.position.set( feet.x, feet.y + EYE, feet.z );
camera.rotation.set( 0, level.spawn.yaw ?? 0, 0 );

// ?pose=x,y,z,yaw,pitch frames a still (used for the OG thumbnail).
if ( params.has( "pose" ) ) {
    const [ x, y, z, yaw, pitch ] = params.get( "pose" ).split( "," ).map( Number );
    feet.set( x, y, z );
    camera.position.set( x, y + EYE, z );
    camera.rotation.set( pitch, yaw, 0, "YXZ" );
    document.body.classList.add( "shot" );
}

const overlay = document.getElementById( "overlay" );
document.getElementById( "enter" ).addEventListener( "click", () => controls.lock() );
controls.addEventListener( "lock", () => {
    overlay.classList.add( "hidden" );
    document.body.classList.add( "locked" );
} );
controls.addEventListener( "unlock", () => {
    overlay.classList.remove( "hidden" );
    document.body.classList.remove( "locked" );
} );

const nav = document.getElementById( "levels" );
for ( const name of LEVELS ) {
    const a = document.createElement( "a" );
    a.href = `?level=${ name }`;
    a.textContent = name;
    a.className = name === levelName ? "current" : "";
    nav.appendChild( a );
}
document.getElementById( "blurb" ).textContent = level.blurb ?? "";
document.getElementById( "log-level" ).textContent = level.name;

const move = { forward: false, backward: false, left: false, right: false, run: false, lift: false };
const KEYS = {
    KeyE: "forward", ArrowUp: "forward",
    KeyD: "backward", ArrowDown: "backward",
    KeyS: "left", ArrowLeft: "left",
    KeyF: "right", ArrowRight: "right",
    ShiftLeft: "run", ShiftRight: "run",
    KeyA: "lift"
};
document.addEventListener( "keydown", ( e ) => { if ( KEYS[ e.code ] ) move[ KEYS[ e.code ] ] = true; } );
document.addEventListener( "keyup", ( e ) => { if ( KEYS[ e.code ] ) move[ KEYS[ e.code ] ] = false; } );

// --- Collision ----------------------------------------------------------------

const ray = new THREE.Raycaster();
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();
const DOWN = new THREE.Vector3( 0, -1, 0 );
const UP = new THREE.Vector3( 0, 1, 0 );

function blocked( dx, dz ) {
    const len = Math.hypot( dx, dz );
    dir.set( dx / len, 0, dz / len );
    ray.far = len + RADIUS;
    for ( const h of [ 1.3, 1.65 ] ) {
        origin.set( feet.x, feet.y + h, feet.z );
        ray.set( origin, dir );
        if ( ray.intersectObjects( colliders, false ).length ) {
            return true;
        }
    }
    return false;
}

function slide( dx, dz ) {
    if ( dx && !blocked( dx, 0 ) ) {
        feet.x += dx;
    }
    if ( dz && !blocked( 0, dz ) ) {
        feet.z += dz;
    }
}

function settle( delta ) {
    origin.set( feet.x, feet.y + STEP, feet.z );
    ray.set( origin, DOWN );
    ray.far = 80;
    const hit = ray.intersectObjects( colliders, false )[ 0 ];
    const floor = hit ? hit.point.y : -Infinity;

    if ( move.lift ) {
        flying = true;
        vy = Math.min( vy + LIFT_ACCEL * delta, LIFT );
    } else if ( flying ) {
        vy = Math.max( vy - GRAVITY * delta, -SINK );
    } else if ( !grounded ) {
        vy -= GRAVITY * delta;
    }

    if ( vy <= 0 && floor >= feet.y - 0.35 ) {
        feet.y = floor;
        vy = 0;
        grounded = true;
        flying = false;
        return;
    }

    grounded = false;
    if ( vy > 0 ) {
        origin.set( feet.x, feet.y + EYE, feet.z );
        ray.set( origin, UP );
        ray.far = vy * delta + 0.15;
        if ( ray.intersectObjects( colliders, false ).length ) {
            vy = 0;
        }
    }
    feet.y += vy * delta;
    if ( feet.y < floor ) {
        feet.y = floor;
        vy = 0;
        grounded = true;
        flying = false;
    }
    if ( feet.y < -40 ) {
        respawn();
    }
}

// --- Liquid -------------------------------------------------------------------

const burn = document.getElementById( "burn" );
const liquidRay = new THREE.Raycaster();
let burning = false;

function respawn() {
    feet.set( level.spawn.x * CELL, level.spawn.y * CELL, level.spawn.z * CELL );
    vy = 0;
    flying = false;
    velocity.set( 0, 0, 0 );
}

// Touching liquid only hurts where the liquid surface actually is: a ray down
// onto that cell's liquid mesh, not the whole cell footprint.
function checkLiquid() {
    const c = cellAt( feet );
    const cell = built.cells.get( key( c.x, c.y, c.z ) );
    let touching = false;
    if ( cell && cell.liquidMesh && feet.y - c.y * CELL < LIQUID_Y + 0.02 ) {
        origin.set( feet.x, c.y * CELL + LIQUID_Y + 1, feet.z );
        liquidRay.set( origin, DOWN );
        liquidRay.far = 2;
        touching = liquidRay.intersectObject( cell.liquidMesh, false ).length > 0;
    }
    if ( touching !== burning ) {
        burning = touching;
        burn.classList.toggle( "on", burning );
    }
}

// --- HUD ----------------------------------------------------------------------

const logCell = document.getElementById( "log-cell" );
const logSection = document.getElementById( "log-section" );
const logFaces = document.getElementById( "log-faces" );
let lastKey = "";

function updateLog() {
    const c = cellAt( feet );
    cull( c );
    const k = key( c.x, c.y, c.z );
    if ( k === lastKey ) {
        return;
    }
    lastKey = k;
    const cell = built.cells.get( k );
    logCell.textContent = k;
    logSection.textContent = cell ? `${ cell.type } rot ${ cell.rot }` : "open ground";
    logFaces.textContent = cell ? cell.faces.join( " " ) : "–";
}

// --- Loop ---------------------------------------------------------------------

window.addEventListener( "resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
} );

const timer = new THREE.Timer();
const velocity = new THREE.Vector3();
const wish = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();

function animate() {
    timer.update();
    const delta = Math.min( timer.getDelta(), 0.05 );
    const elapsed = timer.getElapsed();
    for ( const flare of built.flares ) {
        flare.update( delta, elapsed );
    }
    for ( const liquid of built.liquids ) {
        liquid.update( elapsed );
    }

    if ( controls.isLocked ) {
        camera.getWorldDirection( forward );
        forward.y = 0;
        forward.normalize();
        right.crossVectors( forward, camera.up );

        wish.set( 0, 0, 0 );
        wish.addScaledVector( forward, Number( move.forward ) - Number( move.backward ) );
        wish.addScaledVector( right, Number( move.right ) - Number( move.left ) );
        if ( wish.lengthSq() ) {
            wish.normalize();
        }

        const speed = move.run ? RUN : WALK;
        const blend = Math.min( 1, ACCEL * delta );
        velocity.x += ( wish.x * speed - velocity.x ) * blend;
        velocity.z += ( wish.z * speed - velocity.z ) * blend;

        slide( velocity.x * delta, velocity.z * delta );
        settle( delta );
        checkLiquid();
        camera.position.set( feet.x, feet.y + EYE, feet.z );
        updateLog();
    }

    renderer.render( scene, camera );
}

updateLog();
renderer.setAnimationLoop( animate );
setTimeout( () => console.info( `${ renderer.info.render.triangles } triangles, ${ renderer.info.render.calls } draw calls in view` ), 1500 );
