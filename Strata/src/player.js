import * as THREE from 'three';
import { WATER } from './blocks.js';

const LAYOUTS = {
    wasd: { fwd: [ 'KeyW', 'ArrowUp' ], back: [ 'KeyS', 'ArrowDown' ], left: [ 'KeyA', 'ArrowLeft' ], right: [ 'KeyD', 'ArrowRight' ] },
    esdf: { fwd: [ 'KeyE', 'ArrowUp' ], back: [ 'KeyD', 'ArrowDown' ], left: [ 'KeyS', 'ArrowLeft' ], right: [ 'KeyF', 'ArrowRight' ] },
};

const HALF = 0.3, TALL = 1.8, EYE = 1.62, GRAVITY = 26, JUMP = 8.6;

export class Player {
    constructor( camera, world, canvas, layout = 'wasd' ) {
        this.camera = camera;
        this.world = world;
        this.keys = LAYOUTS[ layout ] || LAYOUTS.wasd;
        this.down = new Set();
        this.pos = new THREE.Vector3( 8, 90, 8 );
        this.vel = new THREE.Vector3();
        this.yaw = 0; this.pitch = 0;
        this.flying = false;
        this.grounded = false;
        this.locked = false;
        this.fly = new THREE.Vector3();

        canvas.addEventListener( 'click', () => { if ( ! this.locked ) canvas.requestPointerLock(); } );
        document.addEventListener( 'pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; } );
        document.addEventListener( 'mousemove', ( e ) => {
            if ( ! this.locked ) return;
            this.yaw -= e.movementX * 0.0022;
            this.pitch = Math.max( -1.55, Math.min( 1.55, this.pitch - e.movementY * 0.0022 ) );
        } );
        document.addEventListener( 'keydown', ( e ) => {
            if ( e.repeat ) return;
            this.down.add( e.code );
            if ( e.code === 'KeyV' ) { this.flying = ! this.flying; this.vel.y = 0; }
        } );
        document.addEventListener( 'keyup', ( e ) => this.down.delete( e.code ) );
        window.addEventListener( 'blur', () => this.down.clear() );
    }

    any( codes ) {
        return codes.some( ( c ) => this.down.has( c ) );
    }

    place( x, z ) {
        this.pos.set( x + 0.5, this.world.top( Math.floor( x ), Math.floor( z ) ) + 1.01, z + 0.5 );
        this.vel.set( 0, 0, 0 );
    }

    collides( p ) {
        const x0 = Math.floor( p.x - HALF ), x1 = Math.floor( p.x + HALF );
        const z0 = Math.floor( p.z - HALF ), z1 = Math.floor( p.z + HALF );
        const y0 = Math.floor( p.y ), y1 = Math.floor( p.y + TALL - 0.01 );
        for ( let x = x0; x <= x1; x++ ) for ( let z = z0; z <= z1; z++ ) for ( let y = y0; y <= y1; y++ )
            if ( this.world.solidAt( x, y, z ) ) return true;
        return false;
    }

    inWater() {
        return this.world.block( Math.floor( this.pos.x ), Math.floor( this.pos.y + 0.9 ), Math.floor( this.pos.z ) ) === WATER;
    }

    eyeInWater() {
        return this.world.block( Math.floor( this.pos.x ), Math.floor( this.pos.y + EYE ), Math.floor( this.pos.z ) ) === WATER;
    }

    step( dt ) {
        if ( ! this.world.loaded( this.pos.x, this.pos.z ) ) return;
        const run = this.any( [ 'ShiftLeft', 'ShiftRight' ] );
        const swim = this.inWater() && ! this.flying;
        const speed = this.flying ? ( run ? 28 : 14 ) : swim ? 3 : ( run ? 9 : 5 );
        const sin = Math.sin( this.yaw ), cos = Math.cos( this.yaw );
        let fx = 0, fz = 0;
        if ( this.any( this.keys.fwd ) ) { fx -= sin; fz -= cos; }
        if ( this.any( this.keys.back ) ) { fx += sin; fz += cos; }
        if ( this.any( this.keys.left ) ) { fx -= cos; fz += sin; }
        if ( this.any( this.keys.right ) ) { fx += cos; fz -= sin; }
        const len = Math.hypot( fx, fz ) || 1;
        const accel = this.flying || swim ? 6 : ( this.grounded ? 14 : 3 );
        this.vel.x += ( fx / len * speed - this.vel.x ) * Math.min( 1, accel * dt );
        this.vel.z += ( fz / len * speed - this.vel.z ) * Math.min( 1, accel * dt );

        const up = this.down.has( 'Space' ), dn = this.any( [ 'KeyC', 'ControlLeft' ] );
        if ( this.flying ) {
            const target = ( up ? speed : 0 ) - ( dn ? speed : 0 );
            this.vel.y += ( target - this.vel.y ) * Math.min( 1, 6 * dt );
        } else if ( swim ) {
            this.vel.y += ( ( up ? 3.5 : -1.2 ) - this.vel.y ) * Math.min( 1, 4 * dt );
        } else {
            this.vel.y -= GRAVITY * dt;
            if ( up && this.grounded ) this.vel.y = JUMP;
        }

        this.grounded = false;
        const next = this.pos.clone();
        next.x += this.vel.x * dt;
        if ( this.collides( next ) ) { next.x = this.pos.x; this.vel.x = 0; }
        next.z += this.vel.z * dt;
        if ( this.collides( next ) ) { next.z = this.pos.z; this.vel.z = 0; }
        next.y += this.vel.y * dt;
        if ( this.collides( next ) ) {
            if ( this.vel.y < 0 ) this.grounded = true;
            next.y = this.pos.y;
            this.vel.y = 0;
        }
        if ( ! this.grounded && ! this.flying && ! swim && this.vel.y === 0 && this.collides( next.clone().setY( next.y - 0.05 ) ) ) this.grounded = true;
        this.pos.copy( next );

        this.camera.position.set( this.pos.x, this.pos.y + EYE, this.pos.z );
        this.camera.rotation.set( 0, 0, 0 );
        this.camera.rotateY( this.yaw );
        this.camera.rotateX( this.pitch );
    }
}
