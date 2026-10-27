import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { CELL } from "./sections.js";
import { buildLevel, cellAt, key, loadLevel } from "./level.js";

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
const LEVELS = [ "gallery", "sample" ];

const params = new URLSearchParams( location.search );
const levelName = LEVELS.includes( params.get( "level" ) ) ? params.get( "level" ) : LEVELS[ 0 ];
const level = await loadLevel( levelName );

// --- Renderer / scene / camera ------------------------------------------------

const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x0b0e14 );
scene.fog = new THREE.FogExp2( 0x0b0e14, level.fog ?? 0.028 );

const camera = new THREE.PerspectiveCamera( 72, window.innerWidth / window.innerHeight, 0.1, 300 );
scene.add( camera );

// --- Light --------------------------------------------------------------------

scene.add( new THREE.HemisphereLight( 0x4a5668, 0x1a1512, 1.4 ) );

const lamp = new THREE.SpotLight( 0xffe3b4, 220, 70, 0.7, 0.7, 2 );
lamp.position.set( 0.2, -0.3, 0 );
lamp.target.position.set( 0, -0.4, -4 );
lamp.castShadow = true;
lamp.shadow.mapSize.set( 1024, 1024 );
lamp.shadow.bias = -0.002;
camera.add( lamp, lamp.target );

// --- World --------------------------------------------------------------------

const t0 = performance.now();
const built = buildLevel( level );
scene.add( built.group );
console.info( `${ level.name }: ${ built.cells.size } cells built in ${ Math.round( performance.now() - t0 ) } ms` );
built.warnings.forEach( ( w ) => console.warn( w ) );

for ( const c of built.cells.values() ) {
    if ( level.labels && c.label === false ) {
        continue;
    }
    const glow = new THREE.PointLight( 0xf2a93b, 40, CELL * 1.8, 2 );
    glow.position.set( c.x * CELL, c.y * CELL + CELL * 0.62, c.z * CELL );
    scene.add( glow );
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
        if ( ray.intersectObjects( built.colliders, false ).length ) {
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
    const hit = ray.intersectObjects( built.colliders, false )[ 0 ];
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
        if ( ray.intersectObjects( built.colliders, false ).length ) {
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
        feet.set( level.spawn.x * CELL, level.spawn.y * CELL, level.spawn.z * CELL );
        vy = 0;
    }
}

// --- HUD ----------------------------------------------------------------------

const logCell = document.getElementById( "log-cell" );
const logSection = document.getElementById( "log-section" );
const logFaces = document.getElementById( "log-faces" );
let lastKey = "";

function updateLog() {
    const c = cellAt( feet );
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
        camera.position.set( feet.x, feet.y + EYE, feet.z );
        updateLog();
    }

    renderer.render( scene, camera );
}

updateLog();
renderer.setAnimationLoop( animate );
