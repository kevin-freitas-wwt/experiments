import * as THREE from 'three';
import { SEA, CHUNK, isLiquid } from './blocks.js';

const KEYS = { fwd: [ 'KeyE', 'ArrowUp' ], back: [ 'KeyD', 'ArrowDown' ], left: [ 'KeyS', 'ArrowLeft' ], right: [ 'KeyF', 'ArrowRight' ], up: [ 'KeyA' ], down: [ 'KeyZ' ] };

const HALF = 0.3, TALL = 1.8, EYE = 1.62, GRAVITY = 26, JUMP = 8.6;

export class Player {
    constructor( camera, shell, canvas ) {
        this.camera = camera;
        this.shell = shell;
        this.home = shell;
        this.keys = KEYS;
        this.down = new Set();
        this.pos = new THREE.Vector3( 8, 90, 8 );
        this.vel = new THREE.Vector3();
        this.yaw = 0; this.pitch = 0;
        this.flying = false;
        this.grounded = false;
        this.locked = false;
        this.q = new THREE.Quaternion();
        this.euler = new THREE.Euler( 0, 0, 0, 'YXZ' );

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

    get world() {
        return this.shell.world;
    }

    get worldPos() {
        return this.shell.toWorld( this.pos );
    }

    forward( out = new THREE.Vector3() ) {
        out.set( -Math.sin( this.yaw ) * Math.cos( this.pitch ), Math.sin( this.pitch ), -Math.cos( this.yaw ) * Math.cos( this.pitch ) );
        return out.applyQuaternion( this.shell.quaternion( this.q ) );
    }

    moveTo( shell ) {
        if ( shell === this.shell ) return;
        const wp = this.worldPos, wf = this.forward(), wv = this.vel.clone().applyQuaternion( this.shell.quaternion( this.q ) );
        this.shell = shell;
        shell.toLocal( wp, this.pos );
        const inv = shell.quaternion( this.q ).invert();
        const f = wf.applyQuaternion( inv );
        this.yaw = Math.atan2( -f.x, -f.z );
        this.pitch = Math.max( -1.55, Math.min( 1.55, Math.asin( Math.max( -1, Math.min( 1, f.y ) ) ) ) );
        this.vel.copy( wv.applyQuaternion( inv ) );
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
        return isLiquid( this.world.block( Math.floor( this.pos.x ), Math.floor( this.pos.y + 0.9 ), Math.floor( this.pos.z ) ) );
    }

    eyeInWater() {
        return isLiquid( this.world.block( Math.floor( this.pos.x ), Math.floor( this.pos.y + EYE ), Math.floor( this.pos.z ) ) );
    }

    get inSpace() {
        return this.shell === this.home && ( this.pos.y > 400 || Math.hypot( this.pos.x, this.pos.z ) > this.world.radius * CHUNK + 200 );
    }

    step( dt, space ) {
        const high = this.inSpace;
        if ( ! high && ! this.world.loaded( this.pos.x, this.pos.z ) ) return;
        if ( high && ! this.flying ) this.vel.y = Math.max( this.vel.y, -60 );
        const run = this.any( [ 'ShiftLeft', 'ShiftRight' ] );
        const swim = this.inWater() && ! this.flying;
        let clearance;
        if ( this.shell.planet ) clearance = Math.max( 0, this.pos.y - this.world.top( Math.floor( this.pos.x ), Math.floor( this.pos.z ) ) - 3 );
        else {
            clearance = Math.max( 0, this.pos.y - SEA - 40 );
            if ( space ) { const n = space.nearest( this.pos ); if ( n ) clearance = Math.min( clearance, Math.max( 0, n.d ) ); }
        }
        const flySpeed = Math.min( 9000, 14 * ( 1 + clearance / 120 ) );
        const speed = this.flying ? flySpeed * ( run ? 3 : 1 ) : swim ? 3 : ( run ? 9 : 5 );
        const sin = Math.sin( this.yaw ), cos = Math.cos( this.yaw );
        const cp = this.flying ? Math.cos( this.pitch ) : 1, sp = this.flying ? Math.sin( this.pitch ) : 0;
        let fx = 0, fy = 0, fz = 0;
        if ( this.any( this.keys.fwd ) ) { fx -= sin * cp; fy += sp; fz -= cos * cp; }
        if ( this.any( this.keys.back ) ) { fx += sin * cp; fy -= sp; fz += cos * cp; }
        if ( this.any( this.keys.left ) ) { fx -= cos; fz += sin; }
        if ( this.any( this.keys.right ) ) { fx += cos; fz -= sin; }
        const len = Math.hypot( fx, fy, fz ) || 1;
        const accel = this.flying || swim ? 6 : ( this.grounded ? 14 : 3 );
        this.vel.x += ( fx / len * speed - this.vel.x ) * Math.min( 1, accel * dt );
        this.vel.z += ( fz / len * speed - this.vel.z ) * Math.min( 1, accel * dt );

        const up = this.any( this.keys.up ), dn = this.any( this.keys.down );
        if ( this.flying ) {
            const target = fy / len * speed + ( up ? speed : 0 ) - ( dn ? speed : 0 );
            this.vel.y += ( target - this.vel.y ) * Math.min( 1, 6 * dt );
        } else if ( swim ) {
            this.vel.y += ( ( up ? 3.5 : -1.2 ) - this.vel.y ) * Math.min( 1, 4 * dt );
        } else {
            this.vel.y = Math.max( -60, this.vel.y - GRAVITY * dt );
            if ( up && this.grounded ) this.vel.y = JUMP;
        }

        this.grounded = false;
        const next = this.pos.clone();
        if ( high ) {
            next.addScaledVector( this.vel, dt );
            if ( space && space.resolve( next ) ) this.vel.set( 0, 0, 0 );
        } else {
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
        }
        this.pos.copy( next );

        this.placeCamera();
    }

    placeCamera() {
        this.shell.toWorld( new THREE.Vector3( this.pos.x, this.pos.y + EYE, this.pos.z ), this.camera.position );
        this.euler.set( this.pitch, this.yaw, 0 );
        this.camera.quaternion.setFromEuler( this.euler ).premultiply( this.shell.quaternion( this.q ) );
    }
}
