import * as THREE from "three";
import { SHAPES, COLORS, PieceBag } from "./pieces.js";
import { Board, shiftGridRows } from "./board.js";
import {
    createBlockMesh,
    createGradientPanel,
    setFilled,
    flashWhite,
    updateBlock,
    easePosition,
    disposeBlockMesh,
    setWireResolution,
} from "./blocks.js";
import * as sfx from "./sfx.js";
import { createSkybox } from "./skybox.js";

const COLS = 10;
const ROWS = 20;
const CELL = 1;
const WELL_DEPTH = CELL; // playfield is one full cube deep, same as a piece
const LINE_CLEAR_DELAY = 170;
const LINE_SCORES = [ 0, 100, 300, 500, 800 ];
const ROTATE_SPIN_MS = 130; // how long a rotation's rigid-body spin animation takes
const LOCK_DELAY = 500; // ms of grace after landing before a piece locks, classic-style
const SETTLE_GRACE = 1000; // ms a locked piece stays bumpable before it solidifies for good
const BASE_DROP_INTERVAL = 1700; // ms per row at level 1 - slow, since flying over to nudge a piece takes time

// Ship flight + the bump-on-a-piece mechanic. The piece is only touchable
// close to its own z=0 depth; within that, the ship's front point (a fixed
// distance ahead of the camera, along wherever it's looking) has to land
// within PUSH_XY_RADIUS of one of the piece's cells to register a bump.
const FLIGHT_SPEED = 8;
const FLIGHT_BOUND_XY = 14;
const FLIGHT_BOUND_Z_MAX = 26;
const FRONT_OFFSET = 0.7; // how far the (invisible) ship's front sits ahead of the camera
const BACK_WALL_Z = -WELL_DEPTH; // the well's actual back face
const PUSH_XY_RADIUS = 0.95;
const PUSH_Z_RANGE = 1.6;
const PUSH_COOLDOWN = 240; // ms between bumps, so holding contact doesn't spam moves
const CELL_FACE_HALF = 0.46; // half of createBlockMesh's default sizeXY, i.e. where a cell's faces sit
const CELL_HALF_Z = CELL / 2; // half of createBlockMesh's default depth

// Laser: a click fires a ray from the ship's front point along wherever
// you're looking; if it hits the active piece, that piece spins (upper
// half of the hit spins one way, lower half the other) and a spark burst
// plays at the hit point.
const LASER_RANGE = 24;
const LASER_SPEED = 26; // units/sec the bolt travels, so it reads as a shot, not a snap
const LASER_BOLT_LENGTH = 0.6;
const LASER_RADIUS = 0.045;
const LASER_GLOW_RADIUS = 0.11;
const LASER_COLOR = 0xff3ec9;
const SPARK_COUNT = 16;
const SPARK_LIFE = 0.22; // seconds a spark burst lasts - quick, not lingering
const SPARK_LENGTH = 0.75; // how far the radiating spark shards reach at full extension
const SPARK_RADIUS_NARROW = 0.02; // tip radius (far end, pointing away from impact)
const SPARK_RADIUS_WIDE = 0.07; // base radius (impact end) - girth reads as brightness/heft
const PLAYER_RADIUS = 0.32; // how close the camera itself can get to a cell before it's blocked

function hexCss( hex ) {
    return `#${ hex.toString( 16 ).padStart( 6, "0" ) }`;
}

// --- Renderer / scene / camera -------------------------------------------------

const canvas = document.getElementById( "scene" );
const renderer = new THREE.WebGLRenderer( { canvas, antialias: true } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x030509 );
scene.add( createSkybox() );

const camera = new THREE.PerspectiveCamera( 72, 1, 0.1, 200 );
camera.position.set( 0, 0, 14 );
scene.add( camera );

const boardGroup = new THREE.Group();
scene.add( boardGroup );

const wellEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry( new THREE.BoxGeometry( COLS * CELL, ROWS * CELL, WELL_DEPTH ) ),
    new THREE.LineBasicMaterial( { color: 0x1f5b66, transparent: true, opacity: 0.6 } )
);
wellEdges.position.z = -0.5;
boardGroup.add( wellEdges );

// Solid gradient panel for the well itself: front (facing the camera) a dim
// teal, fading to near-black at the back. Kept thin and flush against the
// back wall (not the full WELL_DEPTH) so it never shares space with piece
// cubes, which sit at z=-0.5..0.5 - overlapping solid geometry there was
// causing z-fighting on pieces both falling and stacked at the bottom.
const WELL_FILL_DEPTH = 0.15;
const wellFill = createGradientPanel( COLS * CELL, ROWS * CELL, WELL_FILL_DEPTH, 0x2f8a99, 0x05090c, 0.5 );
wellFill.position.z = -WELL_DEPTH + WELL_FILL_DEPTH / 2;
boardGroup.add( wellFill );

const backGrid = buildBackGrid();
boardGroup.add( backGrid );

// The laser bolt: a short, fat cylinder (plus a wider translucent glow
// sleeve) that actually travels from the ship's front point toward its
// target at LASER_SPEED, rather than snapping into place instantly.
const laserCore = new THREE.Mesh(
    new THREE.CylinderGeometry( LASER_RADIUS, LASER_RADIUS, LASER_BOLT_LENGTH, 8 ),
    new THREE.MeshBasicMaterial( { color: LASER_COLOR, transparent: true, opacity: 0.95, depthWrite: false } )
);
const laserGlow = new THREE.Mesh(
    new THREE.CylinderGeometry( LASER_GLOW_RADIUS, LASER_GLOW_RADIUS, LASER_BOLT_LENGTH, 8 ),
    new THREE.MeshBasicMaterial( { color: LASER_COLOR, transparent: true, opacity: 0.3, depthWrite: false } )
);
const laserBolt = new THREE.Group();
laserBolt.add( laserGlow, laserCore );
laserBolt.visible = false;
boardGroup.add( laserBolt );

const UP = new THREE.Vector3( 0, 1, 0 );
let laserFlight = null; // { origin, dir, targetT, traveled, hit: { world, y } | null }

function fireLaserVisual( origin, dir, targetT, hit ) {
    laserFlight = { origin: origin.clone(), dir: dir.clone(), targetT, traveled: 0, hit };
    laserBolt.quaternion.setFromUnitVectors( UP, dir );
    laserBolt.visible = true;
}

function updateLaserVisual( dt ) {
    if ( !laserFlight ) return;
    laserFlight.traveled = Math.min( laserFlight.targetT, laserFlight.traveled + LASER_SPEED * dt );
    const { origin, dir, traveled, targetT } = laserFlight;
    laserBolt.position.copy( origin ).addScaledVector( dir, traveled );

    if ( traveled >= targetT ) {
        laserBolt.visible = false;
        const hit = laserFlight.hit;
        laserFlight = null;
        if ( hit && active && !active.spin ) {
            spinFromImpact( hit.point, dir );
            spawnSparks( hit.point, COLORS[ active.key ] );
            sfx.playHit();
        }
    }
}

// Spark burst: thin tapered shards (real 3D girth, not 1px lines - those
// render at a fixed hairline width in most browsers and were nearly
// invisible) that radiate outward from the impact point and fade out fast.
// Additive blending + a whitened color make them read as bright and hot.
const sparkDirs = [];
for ( let i = 0; i < SPARK_COUNT; i++ ) {
    sparkDirs.push( new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
    ).normalize() );
}
const sparkOrigin = new THREE.Vector3();
const sparkMaterial = new THREE.MeshBasicMaterial( {
    color: LASER_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
} );
const sparkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry( SPARK_RADIUS_NARROW, SPARK_RADIUS_WIDE, 1, 6 ),
    sparkMaterial,
    SPARK_COUNT
);
sparkMesh.frustumCulled = false;
sparkMesh.visible = false;
boardGroup.add( sparkMesh );
let sparkTimer = 0;

const sparkMatrix = new THREE.Matrix4();
const sparkQuat = new THREE.Quaternion();
const sparkPos = new THREE.Vector3();
const sparkScale = new THREE.Vector3();
const brightColor = new THREE.Color();

function spawnSparks( origin, colorHex ) {
    sparkOrigin.copy( origin );
    brightColor.setHex( colorHex ).lerp( new THREE.Color( 0xffffff ), 0.5 );
    sparkMaterial.color.copy( brightColor );
    sparkMaterial.opacity = 1;
    sparkMesh.visible = true;
    sparkTimer = SPARK_LIFE;
    updateSparkGeometry( 0.001 );
}

// Each spark is a cylinder stretched from the origin out along its own
// random direction: base geometry is centered on Y (-0.5..0.5), so scale.y
// is the current length and its center has to sit half that length out
// from the origin for the near end to land exactly on the impact point.
function updateSparkGeometry( length ) {
    for ( let i = 0; i < SPARK_COUNT; i++ ) {
        const dir = sparkDirs[ i ];
        sparkQuat.setFromUnitVectors( UP, dir );
        sparkPos.copy( sparkOrigin ).addScaledVector( dir, length / 2 );
        sparkScale.set( 1, length, 1 );
        sparkMatrix.compose( sparkPos, sparkQuat, sparkScale );
        sparkMesh.setMatrixAt( i, sparkMatrix );
    }
    sparkMesh.instanceMatrix.needsUpdate = true;
}

function updateSparks( dt ) {
    if ( !sparkMesh.visible ) return;
    sparkTimer -= dt;
    if ( sparkTimer <= 0 ) {
        sparkMesh.visible = false;
        return;
    }
    const t = 1 - sparkTimer / SPARK_LIFE; // 0 at spawn, 1 at death
    updateSparkGeometry( SPARK_LENGTH * Math.min( 1, t * 4 ) ); // quick outward snap
    sparkMaterial.opacity = 1 - t;
}

// Faint column/row grid on the back wall of the well, so it's easy to read
// which column a piece will land in even before it drops.
function buildBackGrid() {
    const halfW = ( COLS * CELL ) / 2;
    const halfH = ( ROWS * CELL ) / 2;
    const z = -WELL_DEPTH - 0.02; // just behind the well's back face
    const points = [];
    for ( let col = 0; col <= COLS; col++ ) {
        const x = -halfW + col * CELL;
        points.push( x, -halfH, z, x, halfH, z );
    }
    for ( let row = 0; row <= ROWS; row++ ) {
        const y = halfH - row * CELL;
        points.push( -halfW, y, z, halfW, y, z );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute( "position", new THREE.Float32BufferAttribute( points, 3 ) );
    const material = new THREE.LineBasicMaterial( { color: 0xe8f6ff, transparent: true, opacity: 0.45 } );
    return new THREE.LineSegments( geometry, material );
}

function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize( width, height );
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    setWireResolution( width, height );
}

window.addEventListener( "resize", resize );
resize();

// --- Grid <-> world mapping -----------------------------------------------------

function gridToWorld( col, row ) {
    return {
        x: ( col - COLS / 2 + 0.5 ) * CELL,
        y: ( ROWS / 2 - row - 0.5 ) * CELL,
    };
}

// A cell's position relative to the piece's pivot, in world units - this is
// what a cell's LOCAL position (inside the piece's container) stays fixed at
// between moves, since only rotation changes it.
function cellLocalOffset( cellX, cellY, pivotX, pivotY ) {
    return {
        x: ( cellX - pivotX ) * CELL,
        y: -( cellY - pivotY ) * CELL,
    };
}

function getPivotGrid( piece ) {
    const [ px, py ] = SHAPES[ piece.key ].pivot;
    return [ piece.x + px, piece.y + py ];
}

// --- Game state -----------------------------------------------------------------

const board = new Board( COLS, ROWS );
const bag = new PieceBag();
let meshGrid = emptyGrid();
let active = null;
let settling = null; // the most recently locked piece - bumpable until SETTLE_GRACE runs out
let linesClearing = false; // guards handleLineClears() against overlapping calls
let nextKey = bag.next();
let dropAccumulator = 0;
let baseDropInterval = BASE_DROP_INTERVAL;
let lockTimer = null;
let score = 0;
let level = 1;
let lines = 0;
let gameState = "ready"; // ready | playing | paused | over

function emptyGrid() {
    return Array.from( { length: ROWS }, () => new Array( COLS ).fill( null ) );
}

// --- HUD ---------------------------------------------------------------------

const scoreEl = document.getElementById( "score" );
const levelEl = document.getElementById( "level" );
const linesEl = document.getElementById( "lines" );
const nextGridEl = document.getElementById( "next-grid" );
const nextCells = Array.from( { length: 16 }, ( _, i ) => {
    const cell = document.createElement( "div" );
    cell.className = "cell";
    nextGridEl.appendChild( cell );
    return cell;
} );

function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    linesEl.textContent = lines;
}

function updateNextPreview() {
    nextCells.forEach( ( cell ) => {
        cell.classList.remove( "on" );
        cell.style.removeProperty( "--cell-color" );
    } );
    const shape = SHAPES[ nextKey ];
    const colorCss = hexCss( COLORS[ nextKey ] );
    shape.states[ 0 ].forEach( ( [ x, y ] ) => {
        const cell = nextCells[ y * 4 + x ];
        cell.classList.add( "on" );
        cell.style.setProperty( "--cell-color", colorCss );
    } );
}

// --- Minimap ---------------------------------------------------------------------

const MINI_CELL = 6;
const minimapCanvas = document.getElementById( "minimap" );
const minimapCtx = minimapCanvas.getContext( "2d" );
minimapCanvas.width = COLS * MINI_CELL;
minimapCanvas.height = ROWS * MINI_CELL;

function drawMinimap() {
    minimapCtx.fillStyle = "#050a10";
    minimapCtx.fillRect( 0, 0, minimapCanvas.width, minimapCanvas.height );
    for ( let y = 0; y < ROWS; y++ ) {
        for ( let x = 0; x < COLS; x++ ) {
            const key = board.cells[ y ][ x ];
            if ( !key ) continue;
            minimapCtx.fillStyle = hexCss( COLORS[ key ] );
            minimapCtx.fillRect( x * MINI_CELL, y * MINI_CELL, MINI_CELL - 1, MINI_CELL - 1 );
        }
    }
    if ( active ) {
        minimapCtx.fillStyle = hexCss( COLORS[ active.key ] );
        getCells( active ).forEach( ( [ x, y ] ) => {
            if ( y < 0 || y >= ROWS ) return;
            minimapCtx.fillRect( x * MINI_CELL, y * MINI_CELL, MINI_CELL - 1, MINI_CELL - 1 );
        } );
    }
}

// --- Overlay -------------------------------------------------------------------

const overlay = document.getElementById( "overlay" );
const overlayMessage = document.getElementById( "overlay-message" );
const startBtn = document.getElementById( "start-btn" );
const endBanner = document.getElementById( "end-banner" );

function showEndBanner() {
    endBanner.innerHTML = `<strong>Game over</strong> &middot; Score ${ score } &middot; Level ${ level } &middot; Press Enter to fly again`;
    endBanner.classList.add( "visible" );
}

function hideEndBanner() {
    endBanner.classList.remove( "visible" );
}

function setOverlay( mode ) {
    const copy = {
        ready: { msg: "", btn: "Start" },
        paused: { msg: "Paused.", btn: "Resume" },
        over: { msg: `Game over &middot; Score ${ score } &middot; Level ${ level }`, btn: "Play Again" },
    }[ mode ];
    overlayMessage.innerHTML = copy.msg;
    overlayMessage.style.display = copy.msg ? "" : "none";
    startBtn.textContent = copy.btn;
    overlay.classList.remove( "hidden" );
}

function hideOverlay() {
    overlay.classList.add( "hidden" );
}

startBtn.addEventListener( "click", () => {
    triggerStart();
} );

const sfxToggleBtn = document.getElementById( "sfx-toggle" );

function syncSfxToggle() {
    const muted = sfx.isMuted();
    sfxToggleBtn.textContent = muted ? "SFX: OFF" : "SFX: ON";
    sfxToggleBtn.classList.toggle( "off", muted );
}

sfxToggleBtn.addEventListener( "click", () => {
    sfx.resume();
    sfx.toggleMuted();
    syncSfxToggle();
} );

syncSfxToggle();

function triggerStart() {
    sfx.resume();
    sfx.playUiBlip();
    if ( gameState === "paused" ) {
        gameState = "playing";
        hideOverlay();
    } else {
        startGame();
    }
    requestLock();
}

// --- Piece helpers ---------------------------------------------------------------

function getCells( piece, rot = piece.rot, x = piece.x, y = piece.y ) {
    return SHAPES[ piece.key ].states[ rot ].map( ( [ dx, dy ] ) => [ x + dx, y + dy ] );
}

// A plain move/fall only translates the piece, so each cell's position
// relative to the pivot never changes - just retarget the container.
function syncActiveContainer() {
    const [ px, py ] = getPivotGrid( active );
    const world = gridToWorld( px, py );
    active.container.userData.targetX = world.x;
    active.container.userData.targetY = world.y;
}

function spawnPiece() {
    const key = nextKey;
    nextKey = bag.next();
    updateNextPreview();

    const shape = SHAPES[ key ];
    const x = Math.floor( ( COLS - shape.box ) / 2 );
    const y = 0;
    const cells = shape.states[ 0 ].map( ( [ dx, dy ] ) => [ x + dx, y + dy ] );

    if ( !board.canPlace( cells ) ) {
        endGame();
        return;
    }

    const pivotX = x + shape.pivot[ 0 ];
    const pivotY = y + shape.pivot[ 1 ];
    const pivotWorld = gridToWorld( pivotX, pivotY );

    const container = new THREE.Group();
    container.position.set( pivotWorld.x, pivotWorld.y, 0 );
    container.userData = { targetX: pivotWorld.x, targetY: pivotWorld.y };
    boardGroup.add( container );

    const groups = cells.map( ( [ cx, cy ] ) => {
        const group = createBlockMesh( COLORS[ key ] );
        const offset = cellLocalOffset( cx, cy, pivotX, pivotY );
        group.position.set( offset.x, offset.y, 0 );
        container.add( group );
        return group;
    } );

    active = { key, rot: 0, x, y, container, groups, spin: null };
}

function tryMove( dx, dy ) {
    if ( !active || active.spin ) return false;
    const cells = getCells( active, active.rot, active.x + dx, active.y + dy );
    if ( !board.canPlace( cells ) ) return false;
    active.x += dx;
    active.y += dy;
    syncActiveContainer();
    lockTimer = null; // any successful shift/fall refreshes the landing grace period
    return true;
}

// Rotation spins the whole piece, as a rigid body, around its pivot - it
// doesn't slide each cell to a new slot independently. The grid state
// (active.rot/x) updates immediately for collision purposes; the container's
// rotation + position animate over ROTATE_SPIN_MS, and once that finishes
// each cell's local offset is rebaked to match the new orientation and the
// container's rotation resets to 0 (see finishSpin()).
function tryRotate( dir ) {
    if ( !active || active.spin ) return false;
    const newRot = ( active.rot + dir + 4 ) % 4;
    const kicks = [ 0, -1, 1, -2, 2 ];
    for ( const kick of kicks ) {
        const cells = getCells( active, newRot, active.x + kick, active.y );
        if ( board.canPlace( cells ) ) {
            const fromX = active.container.position.x;
            const fromY = active.container.position.y;
            active.rot = newRot;
            active.x += kick;
            const [ px, py ] = getPivotGrid( active );
            const to = gridToWorld( px, py );
            active.spin = {
                t: 0,
                duration: ROTATE_SPIN_MS / 1000,
                fromAngle: 0,
                toAngle: dir > 0 ? -Math.PI / 2 : Math.PI / 2,
                fromX,
                fromY,
                toX: to.x,
                toY: to.y,
            };
            lockTimer = null;
            sfx.playRotate();
            return true;
        }
    }
    return false;
}

function advanceSpin( dt ) {
    const spin = active.spin;
    spin.t += dt;
    const progress = Math.min( 1, spin.t / spin.duration );
    const eased = 1 - Math.pow( 1 - progress, 3 );
    active.container.rotation.z = spin.fromAngle + ( spin.toAngle - spin.fromAngle ) * eased;
    active.container.position.x = spin.fromX + ( spin.toX - spin.fromX ) * eased;
    active.container.position.y = spin.fromY + ( spin.toY - spin.fromY ) * eased;
    if ( progress >= 1 ) finishSpin();
}

function finishSpin() {
    const { toX, toY } = active.spin;
    active.container.rotation.z = 0;
    active.container.position.set( toX, toY, 0 );
    active.container.userData.targetX = toX;
    active.container.userData.targetY = toY;
    active.spin = null;

    const [ px, py ] = getPivotGrid( active );
    getCells( active ).forEach( ( [ cx, cy ], i ) => {
        const offset = cellLocalOffset( cx, cy, px, py );
        active.groups[ i ].position.set( offset.x, offset.y, 0 );
    } );
}

// A pure gravity step: just try to fall one row. Locking is decided
// centrally in the main loop via the lock-delay grace window.
function stepDown() {
    tryMove( 0, 1 );
}

function isGrounded() {
    if ( !active ) return false;
    return !board.canPlace( getCells( active, active.rot, active.x, active.y + 1 ) );
}

function hardDrop() {
    if ( !active ) return;
    sfx.playHardDrop();
    while ( tryMove( 0, 1 ) ) score += 2;
    updateHud();
}

// --- Ship / push mechanic ---------------------------------------------------------

const move = { forward: false, backward: false, left: false, right: false, boost: false };
const BOOST_MULTIPLIER = 2;
const forwardVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const moveDir = new THREE.Vector3();
let lastPushTime = 0;

// --- Pointer lock ---------------------------------------------------------------

const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;
const shipFront = new THREE.Vector3(); // a point a bit ahead of the camera - the invisible ship's "nose"

let isLocked = false;
let yaw = 0;
let pitch = 0;

function requestLock() {
    canvas.requestPointerLock();
}

function releaseLock() {
    if ( document.pointerLockElement === canvas ) document.exitPointerLock();
}

document.addEventListener( "pointerlockchange", () => {
    isLocked = document.pointerLockElement === canvas;
    if ( isLocked ) {
        hideOverlay();
        document.body.classList.add( "locked" );
    } else {
        document.body.classList.remove( "locked" );
        if ( gameState === "playing" ) {
            gameState = "paused";
            setOverlay( "paused" );
        } else if ( gameState === "over" ) {
            setOverlay( "over" );
        }
    }
} );

document.addEventListener( "mousemove", ( e ) => {
    if ( !isLocked ) return;
    yaw -= e.movementX * MOUSE_SENSITIVITY;
    pitch -= e.movementY * MOUSE_SENSITIVITY;
    pitch = THREE.MathUtils.clamp( pitch, -MAX_PITCH, MAX_PITCH );
    camera.quaternion.setFromEuler( new THREE.Euler( pitch, yaw, 0, "YXZ" ) );
} );

canvas.addEventListener( "click", () => {
    if ( gameState === "playing" && isLocked ) fireLaser();
} );

// The piece's world-space midpoint along one axis - used to work out which
// half of the piece a contact point falls in.
function pieceCenter( cells, axis ) {
    const coords = cells.map( ( [ cx, cy ] ) => gridToWorld( cx, cy )[ axis ] );
    return ( Math.min( ...coords ) + Math.max( ...coords ) ) / 2;
}

// Nearest cell (from an arbitrary set of grid coords) within radius of the
// ship's front point, in world space. Used for both the falling piece and
// the settling one (see below), so bumping works the same on either.
function contactCellIn( cells, radius ) {
    let hit = null;
    let bestDist = radius;
    cells.forEach( ( [ cx, cy ] ) => {
        const world = gridToWorld( cx, cy );
        const dist = Math.hypot( shipFront.x - world.x, shipFront.y - world.y );
        if ( dist < bestDist ) {
            bestDist = dist;
            hit = world;
        }
    } );
    return hit;
}

// A piece isn't done being bumpable the instant it locks - the most
// recently landed one (see `settling`) stays nudgeable for SETTLE_GRACE ms
// (or until the next piece locks on top of it, whichever comes first), so a
// bad landing can still be fixed right after.

// Fades a settling piece in from wireframe to its solid fill, same visual
// language as a piece that's still falling - it only actually solidifies
// once it truly can't be nudged anymore (see the call sites below).
function finalizeSettling() {
    if ( !settling ) return;
    settling.groups.forEach( ( group ) => setFilled( group, true ) );
}

function trySettlingMove( dx ) {
    if ( !settling ) return false;
    board.unlock( settling.cells );
    const shifted = settling.cells.map( ( [ x, y ] ) => [ x + dx, y ] );
    if ( !board.canPlace( shifted ) ) {
        board.lock( settling.cells, settling.key );
        return false;
    }
    board.lock( shifted, settling.key );
    settling.cells.forEach( ( [ x, y ] ) => {
        if ( y >= 0 && y < ROWS ) meshGrid[ y ][ x ] = null;
    } );
    shifted.forEach( ( [ x, y ], i ) => {
        const group = settling.groups[ i ];
        const world = gridToWorld( x, y );
        group.userData.targetX = world.x;
        group.userData.targetY = world.y;
        if ( y >= 0 && y < ROWS ) meshGrid[ y ][ x ] = group;
    } );
    settling.cells = shifted;
    return true;
}

// Just bumping into a piece (no click needed) shoves it sideways - which
// half you touch decides which way, left half pushes it right, right half
// pushes it left. Only flying forward into it counts, though - backing off
// a piece you're still barely touching must never shove it (that reads as
// a "pull", which isn't a thing here). Rotation is a separate act now - see
// fireLaser(). Checks the falling piece first, then the settling one, so
// you can still nudge a piece into place right after it lands.
// Whether shoving these cells by dx would push any of them past the well's
// side walls - used to tell "blocked by the wall" apart from "blocked by the
// stack" so only the former gets the higher-pitched edge-bump sound.
function pushBlockedByEdge( cells, dx ) {
    return cells.some( ( [ x ] ) => x + dx < 0 || x + dx >= COLS );
}

function checkShipPush( now ) {
    if ( !move.forward ) return;
    if ( now - lastPushTime < PUSH_COOLDOWN || Math.abs( shipFront.z ) > PUSH_Z_RANGE ) return;

    if ( active && !active.spin ) {
        const cells = getCells( active );
        const contact = contactCellIn( cells, PUSH_XY_RADIUS );
        if ( contact ) {
            const pushDir = contact.x < pieceCenter( cells, "x" ) ? 1 : -1;
            if ( tryMove( pushDir, 0 ) ) {
                lastPushTime = now;
                sfx.playMove();
                return;
            } else if ( pushBlockedByEdge( cells, pushDir ) ) {
                lastPushTime = now;
                sfx.playEdgeBump();
                return;
            }
        }
    }

    if ( settling ) {
        const contact = contactCellIn( settling.cells, PUSH_XY_RADIUS );
        if ( contact ) {
            const pushDir = contact.x < pieceCenter( settling.cells, "x" ) ? 1 : -1;
            if ( trySettlingMove( pushDir ) ) {
                lastPushTime = now;
                sfx.playMove();
                handleLineClears();
                updateHud();
            } else if ( pushBlockedByEdge( settling.cells, pushDir ) ) {
                lastPushTime = now;
                sfx.playEdgeBump();
            }
        }
    }
}

// Lights up the crosshair when the ship is close enough to a bumpable piece
// (falling or freshly settled) to push it, regardless of whether it's
// currently moving.
function updatePushIndicator() {
    let close = false;
    if ( Math.abs( shipFront.z ) < PUSH_Z_RANGE + 0.8 ) {
        if ( active && !active.spin ) close = !!contactCellIn( getCells( active ), PUSH_XY_RADIUS * 1.8 );
        if ( !close && settling ) close = !!contactCellIn( settling.cells, PUSH_XY_RADIUS * 1.8 );
    }
    document.body.classList.toggle( "in-range", close );
}

function cellBounds( world ) {
    return {
        minX: world.x - CELL_FACE_HALF, maxX: world.x + CELL_FACE_HALF,
        minY: world.y - CELL_FACE_HALF, maxY: world.y + CELL_FACE_HALF,
        minZ: -CELL_HALF_Z, maxZ: CELL_HALF_Z,
    };
}

// Every locked cell on the board, in grid coordinates - the falling piece
// isn't in here (it's only added to `board` once it locks), so combining
// this with getCells(active) covers every solid cell in the well without
// double-checking any of them.
function occupiedCells() {
    const cells = [];
    for ( let y = 0; y < ROWS; y++ ) {
        for ( let x = 0; x < COLS; x++ ) {
            if ( board.cells[ y ][ x ] !== null ) cells.push( [ x, y ] );
        }
    }
    return cells;
}

// Pushes the camera out of any solid cell - falling piece or locked stack -
// like a small sphere against a set of boxes, so you can't fly your own
// body through either from any side, not just head-on. Without this, once
// a piece locked it lost its collision entirely and the ship could sail
// straight into it.
function resolveCameraAgainstPiece() {
    const cells = active ? getCells( active ).concat( occupiedCells() ) : occupiedCells();
    cells.forEach( ( [ cx, cy ] ) => {
        const box = cellBounds( gridToWorld( cx, cy ) );
        const closestX = THREE.MathUtils.clamp( camera.position.x, box.minX, box.maxX );
        const closestY = THREE.MathUtils.clamp( camera.position.y, box.minY, box.maxY );
        const closestZ = THREE.MathUtils.clamp( camera.position.z, box.minZ, box.maxZ );
        const dx = camera.position.x - closestX;
        const dy = camera.position.y - closestY;
        const dz = camera.position.z - closestZ;
        const distSq = dx * dx + dy * dy + dz * dz;
        if ( distSq >= PLAYER_RADIUS * PLAYER_RADIUS ) return;

        if ( distSq < 1e-8 ) {
            // Camera center ended up fully inside the box - shove it out
            // through whichever face is nearest.
            const penX = Math.min( camera.position.x - box.minX, box.maxX - camera.position.x );
            const penY = Math.min( camera.position.y - box.minY, box.maxY - camera.position.y );
            const penZ = Math.min( camera.position.z - box.minZ, box.maxZ - camera.position.z );
            if ( penX <= penY && penX <= penZ ) {
                camera.position.x = camera.position.x - box.minX < box.maxX - camera.position.x
                    ? box.minX - PLAYER_RADIUS : box.maxX + PLAYER_RADIUS;
            } else if ( penY <= penZ ) {
                camera.position.y = camera.position.y - box.minY < box.maxY - camera.position.y
                    ? box.minY - PLAYER_RADIUS : box.maxY + PLAYER_RADIUS;
            } else {
                camera.position.z = camera.position.z - box.minZ < box.maxZ - camera.position.z
                    ? box.minZ - PLAYER_RADIUS : box.maxZ + PLAYER_RADIUS;
            }
            return;
        }

        const dist = Math.sqrt( distSq );
        const push = ( PLAYER_RADIUS - dist ) / dist;
        camera.position.x += dx * push;
        camera.position.y += dy * push;
        camera.position.z += dz * push;
    } );
}

// The camera can be clear of a cell while the invisible front point - out
// ahead of it - has still poked into one (e.g. looking straight at it from
// just outside sphere range). Shove both the front point and the camera out
// together so the front can never tunnel through solid geometry, falling
// piece or locked stack alike.
function resolveFrontAgainstPiece() {
    const cells = active ? getCells( active ).concat( occupiedCells() ) : occupiedCells();
    cells.forEach( ( [ cx, cy ] ) => {
        const box = cellBounds( gridToWorld( cx, cy ) );
        const inside = shipFront.x > box.minX && shipFront.x < box.maxX
            && shipFront.y > box.minY && shipFront.y < box.maxY
            && shipFront.z > box.minZ && shipFront.z < box.maxZ;
        if ( !inside ) return;

        const penX = Math.min( shipFront.x - box.minX, box.maxX - shipFront.x );
        const penY = Math.min( shipFront.y - box.minY, box.maxY - shipFront.y );
        const penZ = Math.min( shipFront.z - box.minZ, box.maxZ - shipFront.z );
        let dx = 0, dy = 0, dz = 0;
        if ( penX <= penY && penX <= penZ ) {
            dx = shipFront.x - box.minX < box.maxX - shipFront.x ? -( penX + 0.01 ) : ( penX + 0.01 );
        } else if ( penY <= penZ ) {
            dy = shipFront.y - box.minY < box.maxY - shipFront.y ? -( penY + 0.01 ) : ( penY + 0.01 );
        } else {
            dz = shipFront.z - box.minZ < box.maxZ - shipFront.z ? -( penZ + 0.01 ) : ( penZ + 0.01 );
        }
        camera.position.x += dx;
        camera.position.y += dy;
        camera.position.z += dz;
        shipFront.x += dx;
        shipFront.y += dy;
        shipFront.z += dz;
    } );
}

// True 6DOF flight: "forward" moves along wherever the camera is actually
// looking (pitch included), not clamped to a walking plane, since this is a
// ship, not a pair of legs.
function updateShip( dt, now ) {
    if ( !isLocked ) return;

    forwardVec.set( 0, 0, -1 ).applyQuaternion( camera.quaternion );
    rightVec.crossVectors( forwardVec, camera.up ).normalize();

    moveDir.set( 0, 0, 0 );
    if ( move.forward ) moveDir.add( forwardVec );
    if ( move.backward ) moveDir.sub( forwardVec );
    if ( move.right ) moveDir.add( rightVec );
    if ( move.left ) moveDir.sub( rightVec );

    if ( moveDir.lengthSq() > 0 ) {
        moveDir.normalize();
        const speed = FLIGHT_SPEED * ( move.boost ? BOOST_MULTIPLIER : 1 );
        camera.position.addScaledVector( moveDir, speed * dt );
        camera.position.x = THREE.MathUtils.clamp( camera.position.x, -FLIGHT_BOUND_XY, FLIGHT_BOUND_XY );
        camera.position.y = THREE.MathUtils.clamp( camera.position.y, -FLIGHT_BOUND_XY, FLIGHT_BOUND_XY );
        camera.position.z = Math.min( camera.position.z, FLIGHT_BOUND_Z_MAX );
    }

    // Keep the ship's invisible front - not just the camera's eye - from
    // poking through the well's back wall, however you're pitched or yawed.
    const frontZ = camera.position.z + forwardVec.z * FRONT_OFFSET;
    if ( frontZ < BACK_WALL_Z ) camera.position.z += BACK_WALL_Z - frontZ;

    resolveCameraAgainstPiece();
    shipFront.copy( camera.position ).addScaledVector( forwardVec, FRONT_OFFSET );
    resolveFrontAgainstPiece();

    if ( gameState === "playing" ) checkShipPush( now );
    updatePushIndicator();
}

// Ray-vs-box intersection (slab method). Returns the distance along the ray
// to the box's near face, or - if the ray starts inside the box - to its far
// face, so a laser fired from just outside a cell still registers a hit.
// Returns null if the ray misses or the box is entirely behind it.
function rayBoxIntersect( origin, dir, box ) {
    let tMin = -Infinity;
    let tMax = Infinity;
    const axes = [ "x", "y", "z" ];
    const mins = [ box.minX, box.minY, box.minZ ];
    const maxs = [ box.maxX, box.maxY, box.maxZ ];

    for ( let i = 0; i < 3; i++ ) {
        const o = origin[ axes[ i ] ];
        const d = dir[ axes[ i ] ];
        if ( Math.abs( d ) < 1e-9 ) {
            if ( o < mins[ i ] || o > maxs[ i ] ) return null;
            continue;
        }
        let t1 = ( mins[ i ] - o ) / d;
        let t2 = ( maxs[ i ] - o ) / d;
        if ( t1 > t2 ) [ t1, t2 ] = [ t2, t1 ];
        tMin = Math.max( tMin, t1 );
        tMax = Math.min( tMax, t2 );
        if ( tMin > tMax ) return null;
    }
    if ( tMax < 0 ) return null;
    return tMin >= 0 ? tMin : tMax;
}

// A click fires a laser bolt from the ship's front point along wherever
// you're looking. The bolt travels rather than snapping to its target; once
// it arrives, if it hit the active piece, that piece spins - upper half hit
// spins one way, lower half the other - and sparks fly at the hit point.
function fireLaser() {
    const origin = shipFront.clone();
    const dir = forwardVec.clone();
    let bestT = LASER_RANGE;
    let didHit = false;

    if ( active && !active.spin ) {
        getCells( active ).forEach( ( [ cx, cy ] ) => {
            const t = rayBoxIntersect( origin, dir, cellBounds( gridToWorld( cx, cy ) ) );
            if ( t !== null && t < bestT ) {
                bestT = t;
                didHit = true;
            }
        } );
    }

    // The impact point is the exact ray-hit coordinate (a real x/y/z, not
    // just the struck cell's grid center) - used for both the spark burst
    // and working out which way the piece should spin below.
    const hit = didHit ? { point: origin.clone().addScaledVector( dir, bestT ) } : null;
    fireLaserVisual( origin, dir, bestT, hit );
    sfx.playLaser();
}

// Real angular momentum from an off-center hit: torque = r x F, where r is
// the impact point relative to the piece's true rotation pivot and F is the
// laser's own incoming direction - restricted to the z-axis these pieces
// are allowed to spin around. The camera looks down -z, so by the
// right-hand rule positive torque reads as counter-clockwise on screen and
// negative as clockwise - e.g. shooting up (dir.y > 0) into the right side
// of a piece (rx > 0) gives rx*dir.y > 0, which should spin it CCW.
function spinFromImpact( point, dir ) {
    const [ px, py ] = getPivotGrid( active );
    const pivot = gridToWorld( px, py );
    const rx = point.x - pivot.x;
    const ry = point.y - pivot.y;
    const torque = rx * dir.y - ry * dir.x;
    tryRotate( torque > 0 ? -1 : 1 );
}

function lockActive( now ) {
    sfx.playLock();
    const cells = getCells( active );
    board.lock( cells, active.key );
    cells.forEach( ( [ cx, cy ], i ) => {
        const group = active.groups[ i ];
        active.container.remove( group );
        const world = gridToWorld( cx, cy );
        group.position.set( world.x, world.y, 0 );
        group.userData.targetX = world.x;
        group.userData.targetY = world.y;
        boardGroup.add( group );
        if ( cy >= 0 && cy < ROWS ) meshGrid[ cy ][ cx ] = group;
    } );
    boardGroup.remove( active.container );
    // The piece that was settling stops being nudgeable the instant a new
    // one locks on top of it, so it solidifies here rather than at lock.
    finalizeSettling();
    settling = { key: active.key, cells, groups: active.groups, expiresAt: now + SETTLE_GRACE };
    active = null;
    dropAccumulator = 0;
    lockTimer = null;
    handleLineClears();
    spawnPiece();
    updateHud();
}

function handleLineClears() {
    // Now that a settling-piece bump can trigger this independently of a
    // normal lock, two calls can land within the same LINE_CLEAR_DELAY
    // window (e.g. a bump completes a row right as the next piece also
    // locks). Re-deriving `full` from the board mid-clear would re-flash
    // and re-splice rows that are already scheduled to go, so just bail
    // and let the pending clear's own re-check (below) pick up anything new.
    if ( linesClearing ) return;

    const full = board.findFullRows();
    if ( full.length === 0 ) return;
    // Row indices shift once cleared rows are spliced out - rather than
    // remap settling.cells to match, just end its bump grace window here.
    finalizeSettling();
    settling = null;
    linesClearing = true;
    sfx.playLineClear( full.length );

    full.forEach( ( row ) => {
        for ( let x = 0; x < COLS; x++ ) {
            const group = meshGrid[ row ][ x ];
            if ( group ) flashWhite( group );
        }
    } );

    score += LINE_SCORES[ full.length ] * level;
    lines += full.length;
    const newLevel = Math.floor( lines / 10 ) + 1;
    if ( newLevel !== level ) {
        level = newLevel;
        baseDropInterval = Math.max( 90, Math.round( BASE_DROP_INTERVAL * Math.pow( 0.86, level - 1 ) ) );
        sfx.playLevelUp();
    }

    setTimeout( () => {
        full.forEach( ( row ) => {
            for ( let x = 0; x < COLS; x++ ) {
                const group = meshGrid[ row ][ x ];
                if ( group ) {
                    boardGroup.remove( group );
                    disposeBlockMesh( group );
                }
            }
        } );
        shiftGridRows( meshGrid, COLS, full );
        board.clearRows( full );
        for ( let y = 0; y < ROWS; y++ ) {
            for ( let x = 0; x < COLS; x++ ) {
                const group = meshGrid[ y ][ x ];
                if ( group ) group.userData.targetY = gridToWorld( x, y ).y;
            }
        }
        linesClearing = false;
        handleLineClears(); // catch anything that filled up while this batch was pending
    }, LINE_CLEAR_DELAY );

    updateHud();
}

// --- Game flow -------------------------------------------------------------------

function startGame() {
    meshGrid.forEach( ( row ) => row.forEach( ( group ) => group && disposeBlockMesh( group ) ) );
    if ( active ) active.groups.forEach( ( group ) => disposeBlockMesh( group ) );
    const keep = [ wellEdges, wellFill, backGrid, laserBolt, sparkMesh ];
    boardGroup.children.slice().forEach( ( child ) => {
        if ( !keep.includes( child ) ) boardGroup.remove( child );
    } );
    board.reset();
    lockTimer = null;
    meshGrid = emptyGrid();
    active = null;
    settling = null;
    linesClearing = false;
    laserFlight = null;
    laserBolt.visible = false;
    sparkMesh.visible = false;
    score = 0;
    level = 1;
    lines = 0;
    baseDropInterval = BASE_DROP_INTERVAL;
    dropAccumulator = 0;
    camera.position.set( 0, 0, 14 );
    camera.quaternion.identity();
    yaw = 0;
    pitch = 0;
    gameState = "playing";
    hideOverlay();
    hideEndBanner();
    updateHud();
    spawnPiece();
}

function togglePauseKey() {
    sfx.playUiBlip();
    if ( gameState === "playing" ) {
        gameState = "paused";
        setOverlay( "paused" );
        releaseLock();
    } else if ( gameState === "paused" ) {
        gameState = "playing";
        hideOverlay();
        requestLock();
    }
}

// Game over doesn't lock you out - keep flying and look over the wreckage.
// The overlay only reappears if you back out of pointer lock yourself.
function endGame() {
    gameState = "over";
    sfx.playGameOver();
    showEndBanner();
}

// --- Input -------------------------------------------------------------------------

function setMoveKey( code, isDown ) {
    switch ( code ) {
        case "KeyE":
            move.forward = isDown;
            return true;
        case "KeyD":
            move.backward = isDown;
            return true;
        case "KeyS":
            move.left = isDown;
            return true;
        case "KeyF":
            move.right = isDown;
            return true;
        case "ShiftLeft":
        case "ShiftRight":
            move.boost = isDown;
            return true;
        default:
            return false;
    }
}

window.addEventListener( "keydown", ( e ) => {
    if ( setMoveKey( e.code, true ) ) return;

    if ( e.code === "Enter" && ( gameState === "ready" || gameState === "over" ) ) {
        triggerStart();
        return;
    }
    if ( e.code === "KeyP" && !e.repeat ) {
        togglePauseKey();
        return;
    }
    if ( gameState !== "playing" ) return;
    if ( e.code === "Space" ) {
        e.preventDefault();
        if ( !e.repeat ) hardDrop();
    }
} );

window.addEventListener( "keyup", ( e ) => setMoveKey( e.code, false ) );

// --- Main loop ---------------------------------------------------------------------

let lastTime = performance.now();

function tick( now ) {
    const dt = Math.min( 0.05, ( now - lastTime ) / 1000 );
    lastTime = now;

    if ( settling && now >= settling.expiresAt ) {
        finalizeSettling();
        settling = null;
    }
    updateShip( dt, now );

    if ( gameState === "playing" && active ) {
        if ( active.spin ) {
            advanceSpin( dt );
        } else {
            dropAccumulator += dt * 1000;
            while ( dropAccumulator >= baseDropInterval ) {
                dropAccumulator -= baseDropInterval;
                stepDown();
            }

            if ( isGrounded() ) {
                if ( lockTimer === null ) lockTimer = now;
                else if ( now - lockTimer >= LOCK_DELAY ) lockActive( now );
            } else {
                lockTimer = null;
            }
        }
    }

    if ( active && !active.spin ) easePosition( active.container, dt );
    meshGrid.forEach( ( row ) => row.forEach( ( group ) => group && updateBlock( group, dt ) ) );
    if ( active ) active.groups.forEach( ( group ) => updateBlock( group, dt ) );
    updateLaserVisual( dt );
    updateSparks( dt );

    drawMinimap();
    renderer.render( scene, camera );
    requestAnimationFrame( tick );
}

setOverlay( "ready" );
updateNextPreview();
updateHud();
requestAnimationFrame( tick );
