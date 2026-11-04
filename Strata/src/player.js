import * as THREE from 'three';
import { SEA, isLiquid, spawnOf } from './blocks.js';

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
        this.frameQ = shell.quaternion( new THREE.Quaternion() );
        this.lookQ = new THREE.Quaternion();

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
        this.euler.set( this.pitch, this.yaw, 0 );
        const camQ = this.frameQ.clone().multiply( this.lookQ.setFromEuler( this.euler ) );
        this.shell = shell;
        shell.toLocal( wp, this.pos );
        const inv = shell.quaternion( this.q ).invert();
        const f = wf.applyQuaternion( inv );
        this.yaw = Math.atan2( -f.x, -f.z );
        this.pitch = Math.max( -1.55, Math.min( 1.55, Math.asin( Math.max( -1, Math.min( 1, f.y ) ) ) ) );
        this.vel.copy( wv.applyQuaternion( inv ) );
        this.euler.set( this.pitch, this.yaw, 0 );
        this.frameQ.copy( camQ ).multiply( this.lookQ.setFromEuler( this.euler ).invert() );
    }

    any( codes ) {
        return codes.some( ( c ) => this.down.has( c ) );
    }

    place( x, z ) {
        this.pos.set( x + 0.5, this.world.top( Math.floor( x ), Math.floor( z ) ) + 1.01, z + 0.5 );
        this.vel.set( 0, 0, 0 );
    }

    collides( p ) {
        if ( this.shell.radial ) {
            const t = new THREE.Vector3();
            for ( const [ dx, dz ] of [ [ -HALF, -HALF ], [ HALF, -HALF ], [ HALF, HALF ], [ -HALF, HALF ], [ 0, 0 ] ] )
                for ( const dy of [ 0.05, TALL * 0.5, TALL - 0.05 ] )
                    if ( this.shell.solidAtLocal( t.set( p.x + dx, p.y + dy, p.z + dz ) ) ) return true;
            return false;
        }
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
        if ( this.shell !== this.home ) return false;
        if ( this.pos.y > 400 || this.pos.y < -400 ) return true;
        if ( ! this.spawn ) this.spawn = spawnOf( this.home.world.seed );
        return Math.hypot( this.pos.x - this.spawn.x, this.pos.z - this.spawn.z ) > 200000;
    }

    unstick() {
        if ( ! this.collides( this.pos ) ) return;
        for ( let dy = 0.25; dy <= 64; dy += 0.25 ) {
            if ( ! this.collides( this.pos.clone().setY( this.pos.y + dy ) ) ) { this.pos.y += dy; this.vel.y = Math.max( 0, this.vel.y ); return; }
        }
    }

    step( dt, space ) {
        this.dt = dt;
        const high = this.inSpace;
        const ghost = ! high && ! this.world.loaded( this.pos.x, this.pos.z );
        if ( ghost && ! this.flying ) return;
        if ( ! high && ! ghost ) this.unstick();
        if ( high && ! this.flying ) this.vel.y = Math.max( this.vel.y, -60 );
        const run = this.any( [ 'ShiftLeft', 'ShiftRight' ] );
        const swim = this.inWater() && ! this.flying;
        let clearance;
        const radial = this.shell.radial;
        if ( radial ) clearance = Math.max( 0, this.pos.length() - this.shell.rock.radius - 2 );
        else if ( this.shell.planet || this.shell.interior ) clearance = Math.max( 0, this.pos.y - this.world.top( Math.floor( this.pos.x ), Math.floor( this.pos.z ) ) - 3 );
        else {
            if ( ! this.spawn ) this.spawn = spawnOf( this.home.world.seed );
            const onDisc = Math.hypot( this.pos.x - this.spawn.x, this.pos.z - this.spawn.z ) < 200000;
            clearance = onDisc ? Math.max( 0, this.pos.y - SEA - 40 ) : 1e9;
            if ( space ) { const n = space.nearest( this.worldPos ); if ( n ) clearance = Math.min( clearance, Math.max( 0, n.d ) ); }
        }
        const thrusting = this.flying && ( this.any( this.keys.fwd ) || this.any( this.keys.back ) || this.any( this.keys.left ) || this.any( this.keys.right ) );
        this.boost = thrusting ? Math.min( 8, ( this.boost || 1 ) + dt * 1.75 ) : Math.max( 1, ( this.boost || 1 ) - dt * 12 );
        const boostK = 1 + ( this.boost - 1 ) * Math.min( 1, clearance / 6000 );
        const flySpeed = 14 * ( 1 + clearance / 120 ) * ( 1 + clearance / 30000 ) * boostK;
        const speed = this.flying ? Math.min( 500000, flySpeed * ( run ? 3 : 1 ) ) : swim ? 3 : ( run ? 9 : 5 );
        const sin = Math.sin( this.yaw ), cos = Math.cos( this.yaw );
        const cp = this.flying ? Math.cos( this.pitch ) : 1, sp = this.flying ? Math.sin( this.pitch ) : 0;
        let fx = 0, fy = 0, fz = 0;
        if ( this.any( this.keys.fwd ) ) { fx -= sin * cp; fy += sp; fz -= cos * cp; }
        if ( this.any( this.keys.back ) ) { fx += sin * cp; fy -= sp; fz += cos * cp; }
        if ( this.any( this.keys.left ) ) { fx -= cos; fz += sin; }
        if ( this.any( this.keys.right ) ) { fx += cos; fz -= sin; }
        const len = Math.hypot( fx, fy, fz ) || 1;
        const slowing = this.flying && Math.hypot( this.vel.x, this.vel.z ) > speed * 1.05;
        const accel = this.flying ? ( slowing ? 24 : 6 ) : swim ? 6 : ( this.grounded ? 14 : 3 );
        this.vel.x += ( fx / len * speed - this.vel.x ) * Math.min( 1, accel * dt );
        this.vel.z += ( fz / len * speed - this.vel.z ) * Math.min( 1, accel * dt );

        const up = this.any( this.keys.up ), dn = this.any( this.keys.down );
        if ( this.flying ) {
            const target = fy / len * speed + ( up ? speed : 0 ) - ( dn ? speed : 0 );
            this.vel.y += ( target - this.vel.y ) * Math.min( 1, ( Math.abs( target ) < Math.abs( this.vel.y ) ? 24 : 6 ) * dt );
        } else if ( swim ) {
            this.vel.y += ( ( up ? 3.5 : -1.2 ) - this.vel.y ) * Math.min( 1, 4 * dt );
        } else {
            const g = radial ? 4 : GRAVITY, j = radial ? 3.2 : JUMP;
            this.vel.y = Math.max( -60, this.vel.y - g * dt );
            if ( up && this.grounded ) this.vel.y = j;
        }

        this.grounded = false;
        const next = this.pos.clone();
        if ( high || ghost ) {
            next.addScaledVector( this.vel, dt );
            if ( high && space ) {
                const wn = this.shell.toWorld( next );
                if ( space.resolve( wn ) ) { this.shell.toLocal( wn, next ); this.vel.set( 0, 0, 0 ); }
            }
        } else {
            const canStep = ! this.flying && ! swim && this.vel.y <= 0.01;
            const slide = ( axis ) => {
                next[ axis ] += this.vel[ axis ] * dt;
                if ( ! this.collides( next ) ) return;
                if ( canStep ) {
                    const stepped = next.clone().setY( next.y + 1.05 );
                    if ( ! this.collides( stepped ) ) {
                        let y = stepped.y;
                        while ( y > next.y && ! this.collides( stepped.clone().setY( y - 0.05 ) ) ) y -= 0.05;
                        next.y = y;
                        return;
                    }
                }
                next[ axis ] = this.pos[ axis ];
                this.vel[ axis ] = 0;
            };
            slide( 'x' );
            slide( 'z' );
            const stood = next.y;
            next.y += this.vel.y * dt;
            if ( this.collides( next ) ) {
                if ( this.vel.y < 0 ) this.grounded = true;
                next.y = stood;
                this.vel.y = 0;
            }
            if ( ! this.grounded && ! this.flying && ! swim && this.vel.y === 0 && this.collides( next.clone().setY( next.y - 0.05 ) ) ) this.grounded = true;
        }
        this.pos.copy( next );
        if ( radial ) {
            const vr = this.vel.clone().applyQuaternion( this.shell.q );
            this.shell.retarget( this.pos );
            this.vel.copy( vr.applyQuaternion( this.shell.q.clone().invert() ) );
        }

        this.placeCamera();
    }

    placeCamera() {
        this.shell.toWorld( new THREE.Vector3( this.pos.x, this.pos.y + EYE, this.pos.z ), this.camera.position );
        this.euler.set( this.pitch, this.yaw, 0 );
        const target = this.shell.quaternion( this.q );
        this.frameQ.slerp( target, 1 - Math.exp( -( this.dt || 0.016 ) * 4.5 ) );
        this.camera.quaternion.setFromEuler( this.euler ).premultiply( this.frameQ );
    }
}
