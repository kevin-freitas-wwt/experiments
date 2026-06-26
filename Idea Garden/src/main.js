import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { buildGarden } from "./world/garden.js";
import { buildCards } from "./world/fruit.js";
import { getCards } from "./data/cards.js";
import { SPAWN, PLAYER_BOUND } from "./world/layout.js";

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 34;
const REACH = 14;

// --- Renderer / scene / camera ------------------------------------------------

const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.1, 500 );
camera.position.copy( SPAWN );

// --- World --------------------------------------------------------------------

const { hangPoints } = buildGarden( scene );
const ideas = await getCards();
const { cards, meshes: cardMeshes } = buildCards( scene, hangPoints, ideas );

// --- Controls -----------------------------------------------------------------

const controls = new PointerLockControls( camera, renderer.domElement );
scene.add( controls.object );

const overlay = document.getElementById( "overlay" );
const enterButton = document.getElementById( "enter" );

enterButton.addEventListener( "click", () => controls.lock() );

controls.addEventListener( "lock", () => {
    overlay.classList.add( "hidden" );
    document.body.classList.add( "locked" );
} );

controls.addEventListener( "unlock", () => {
    overlay.classList.remove( "hidden" );
    document.body.classList.remove( "locked" );
} );

// --- Movement input -----------------------------------------------------------

const move = { forward: false, backward: false, left: false, right: false };

function onKey( event, isDown ) {
    switch ( event.code ) {
        case "KeyE":
        case "ArrowUp":
            move.forward = isDown;
            break;
        case "KeyD":
        case "ArrowDown":
            move.backward = isDown;
            break;
        case "KeyS":
        case "ArrowLeft":
            move.left = isDown;
            break;
        case "KeyF":
        case "ArrowRight":
            move.right = isDown;
            break;
    }
}

document.addEventListener( "keydown", ( e ) => onKey( e, true ) );
document.addEventListener( "keyup", ( e ) => onKey( e, false ) );

// --- Interaction --------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2( 0, 0 );
let focused = null;

function updateFocus() {
    raycaster.setFromCamera( screenCenter, camera );
    const hits = raycaster.intersectObjects( cardMeshes, false );
    const hit = hits.length && hits[ 0 ].distance <= REACH ? hits[ 0 ].object.userData.card : null;

    if ( hit !== focused ) {
        if ( focused ) {
            focused.setFocused( false );
        }
        focused = hit;
        if ( focused ) {
            focused.setFocused( true );
        }
        document.body.classList.toggle( "targeting", Boolean( focused ) );
    }
}

// --- Resize -------------------------------------------------------------------

window.addEventListener( "resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
} );

// --- Loop ---------------------------------------------------------------------

const timer = new THREE.Timer();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

function animate() {
    timer.update();
    const delta = Math.min( timer.getDelta(), 0.05 );
    const elapsed = timer.getElapsed();

    if ( controls.isLocked ) {
        velocity.x -= velocity.x * 10 * delta;
        velocity.z -= velocity.z * 10 * delta;

        direction.z = Number( move.forward ) - Number( move.backward );
        direction.x = Number( move.right ) - Number( move.left );
        direction.normalize();

        if ( move.forward || move.backward ) {
            velocity.z -= direction.z * WALK_SPEED * delta;
        }
        if ( move.left || move.right ) {
            velocity.x -= direction.x * WALK_SPEED * delta;
        }

        controls.moveRight( -velocity.x * delta );
        controls.moveForward( -velocity.z * delta );

        // Keep the walker on the ground and inside the garden walls.
        camera.position.y = EYE_HEIGHT;
        camera.position.x = THREE.MathUtils.clamp( camera.position.x, -PLAYER_BOUND, PLAYER_BOUND );
        camera.position.z = THREE.MathUtils.clamp( camera.position.z, -PLAYER_BOUND, PLAYER_BOUND );

        updateFocus();
    }

    for ( const card of cards ) {
        card.update( elapsed, camera );
    }

    renderer.render( scene, camera );
}

renderer.setAnimationLoop( animate );
