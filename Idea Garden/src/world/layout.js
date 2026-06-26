import * as THREE from "three";

// Single source of truth for the courtyard's dimensions and key positions. Every
// world module (structures, lighting, planting, cards) reads from here, so the
// pieces line up without passing data between modules.

export const COURT_HALF = 12;          // half-width of the square courtyard (walls)
export const WALL_H = 2.6;
export const ENTRANCE_W = 4;           // opening in the +Z wall

export const PERGOLA_HALF = 6;         // the lattice extends ±6 from centre
export const POST_LINES = [ -6, -3, 0, 3, 6 ];  // grid lines of the lattice
export const BEAM_Y = 3.4;
export const POST_TOP = 3.6;

export const BRICK_HALF = 8;           // central brick paving extends ±8

export const PLAYER_BOUND = COURT_HALF - 0.7;
export const SPAWN = new THREE.Vector3( 0, 1.7, COURT_HALF - 1 );

// Where the 9 idea cards hang — a 3×3 grid under the lattice. Cards face the
// entrance axis (±Z) and show the same content front and back.
// Small seeded RNG so the scattered layout is stable between reloads.
function makeRandom( seed ) {
    let s = seed >>> 0;
    return function () {
        s = ( s * 1664525 + 1013904223 ) >>> 0;
        return s / 4294967296;
    };
}

export function cardHangPoints() {
    // A jittered grid: an even base spread under the pergola, then each card is
    // nudged and turned at random so they hang scattered rather than in rows.
    const rand = makeRandom( 0x1d2a );
    const base = [ -4, 0, 4 ];
    const points = [];
    for ( const bz of base ) {
        for ( const bx of base ) {
            points.push( {
                anchor: new THREE.Vector3(
                    bx + ( rand() - 0.5 ) * 2.4,
                    BEAM_Y - 0.05,
                    bz + ( rand() - 0.5 ) * 2.4
                ),
                yaw: ( rand() - 0.5 ) * Math.PI
            } );
        }
    }
    return points;
}

// Lines along the top of the pergola where string lights are draped. Each span
// is a pair of points; lighting.js sags bulbs between them.
export function stringLightSpans() {
    const e = PERGOLA_HALF;
    const y = BEAM_Y + 0.05;
    return [
        { a: new THREE.Vector3( -e, y, -e ), b: new THREE.Vector3(  e, y, -e ) },
        { a: new THREE.Vector3(  e, y, -e ), b: new THREE.Vector3(  e, y,  e ) },
        { a: new THREE.Vector3(  e, y,  e ), b: new THREE.Vector3( -e, y,  e ) },
        { a: new THREE.Vector3( -e, y,  e ), b: new THREE.Vector3( -e, y, -e ) },
        { a: new THREE.Vector3( -e, y, 0 ), b: new THREE.Vector3( e, y, 0 ) },
        { a: new THREE.Vector3( 0, y, -e ), b: new THREE.Vector3( 0, y, e ) }
    ];
}

// Ground spots for stone lanterns: flanking the entrance and at the inner
// corners of the courtyard.
export function lanternSpots() {
    const c = COURT_HALF - 2.2;
    const g = ENTRANCE_W / 2 + 1;
    return [
        new THREE.Vector3( -g, 0, COURT_HALF - 1.5 ),
        new THREE.Vector3(  g, 0, COURT_HALF - 1.5 ),
        new THREE.Vector3( -c, 0, -c ),
        new THREE.Vector3(  c, 0, -c ),
        new THREE.Vector3( -c, 0,  c ),
        new THREE.Vector3(  c, 0,  c )
    ];
}

// Primary spots for periphery trees — the ring between the pergola and the
// walls. planting.js may scatter smaller plants around these.
export function plantingSpots() {
    const r = COURT_HALF - 1.6;
    const spots = [];
    for ( const sx of [ -1, 1 ] ) {
        for ( const sz of [ -1, 1 ] ) {
            spots.push( new THREE.Vector3( sx * r, 0, sz * r ) );
        }
    }
    spots.push( new THREE.Vector3( -r, 0, 0 ) );
    spots.push( new THREE.Vector3(  r, 0, 0 ) );
    spots.push( new THREE.Vector3( 0, 0, -r ) );
    return spots;
}
