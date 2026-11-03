import * as THREE from 'three';
import { World } from './world.js';
import { KINDS, surfaceAt } from './planet.js';

export const BASE = 64;

export class Shell {
    constructor( scene, pool, seed, radius, body = null, dir = null ) {
        this.body = body;
        this.group = new THREE.Group();
        let terrain = null;
        if ( body ) {
            const up = dir.clone().normalize();
            const ref = Math.abs( up.y ) < 0.9 ? new THREE.Vector3( 0, 1, 0 ) : new THREE.Vector3( 1, 0, 0 );
            const u = new THREE.Vector3().crossVectors( ref, up ).normalize();
            const w = new THREE.Vector3().crossVectors( u, up );
            this.R0 = surfaceAt( body.kind, KINDS[ body.kind ], up.toArray(), body.seed, body.radius, 8 ).r;
            this.group.quaternion.setFromRotationMatrix( new THREE.Matrix4().makeBasis( u, up, w ) );
            this.group.position.copy( up ).multiplyScalar( this.R0 - BASE );
            terrain = { planet: body.kind, radius: body.radius, seed: body.seed, R0: this.R0, up: up.toArray(), u: u.toArray(), w: w.toArray() };
            body.group.add( this.group );
        } else scene.add( this.group );
        this.group.updateMatrixWorld( true );
        this.world = new World( this.group, pool, seed, radius, terrain );
        this.seaLevel = terrain && KINDS[ body.kind ].sea ? Math.round( body.radius * ( 1 + KINDS[ body.kind ].seaLevel * KINDS[ body.kind ].amp * 4 ) - this.R0 + BASE ) : null;
    }

    get planet() {
        return !! this.body;
    }

    toWorld( local, out = new THREE.Vector3() ) {
        this.group.updateMatrixWorld( true );
        return out.copy( local ).applyMatrix4( this.group.matrixWorld );
    }

    toLocal( world, out = new THREE.Vector3() ) {
        this.group.updateMatrixWorld( true );
        return out.copy( world ).applyMatrix4( this.group.matrixWorld.clone().invert() );
    }

    quaternion( out = new THREE.Quaternion() ) {
        this.group.updateMatrixWorld( true );
        return this.group.getWorldQuaternion( out );
    }

    originWorld( out = new THREE.Vector3() ) {
        return this.toWorld( new THREE.Vector3( 0, BASE, 0 ), out );
    }

    dispose() {
        this.world.dispose();
        this.group.removeFromParent();
    }
}

export const INTERIOR = {
    small:   { W: 14, H: 4, L: 40 },
    medium:  { W: 24, H: 5, L: 80 },
    capital: { W: 40, H: 6, L: 150 },
    station: { R: 90, H: 5 },
};

export class InteriorShell {
    constructor( pool, seed, vessel ) {
        this.vessel = vessel;
        this.interior = true;
        this.group = new THREE.Group();
        const cls = vessel.cls || 'station', dims = INTERIOR[ cls ];
        this.dims = dims;
        if ( cls === 'station' ) {
            this.group.position.set( 0, -dims.H / 2, 0 );
            this.spawn = new THREE.Vector3( 0.5, 1.01, 3.5 );
            this.door = new THREE.Vector3( 0.5, 1, 0.5 );
            this.ring = 8;
        } else {
            this.group.position.set( -dims.W / 2, -dims.H / 2, -dims.L / 2 );
            this.spawn = new THREE.Vector3( dims.W - 3.5, 1.01, Math.floor( dims.L / 2 ) + 0.5 );
            this.door = new THREE.Vector3( dims.W - 0.5, 1, Math.floor( dims.L / 2 ) + 0.5 );
            this.ring = 6;
        }
        vessel.group.add( this.group );
        this.group.updateMatrixWorld( true );
        this.world = new World( this.group, pool, seed, this.ring, { interior: true, cls, seed: vessel.seed } );
        this.seaLevel = null;
    }

    get planet() { return false; }

    toWorld( local, out = new THREE.Vector3() ) {
        this.group.updateMatrixWorld( true );
        return out.copy( local ).applyMatrix4( this.group.matrixWorld );
    }

    toLocal( world, out = new THREE.Vector3() ) {
        this.group.updateMatrixWorld( true );
        return out.copy( world ).applyMatrix4( this.group.matrixWorld.clone().invert() );
    }

    quaternion( out = new THREE.Quaternion() ) {
        this.group.updateMatrixWorld( true );
        return this.group.getWorldQuaternion( out );
    }

    dispose() {
        this.world.dispose();
        this.group.removeFromParent();
    }
}

export class RockFrame {
    constructor( rock, worldPos ) {
        this.rock = rock;
        this.radial = true;
        this.group = rock.frame;
        this.q = new THREE.Quaternion();
        this.ref = new THREE.Vector3( 1, 0, 0 );
        this.world = { loaded: () => true, top: () => 0, biome: () => -1, stats: { loaded: 1, pending: 0 }, block: () => 0, radius: 1 };
        this.seaLevel = null;
        const pr = this.group.worldToLocal( worldPos.clone() );
        this.orient( pr );
    }

    get planet() { return false; }

    orient( pr ) {
        const up = pr.clone().normalize();
        if ( up.lengthSq() < 0.5 ) up.set( 0, 1, 0 );
        this.ref.addScaledVector( up, -this.ref.dot( up ) );
        if ( this.ref.lengthSq() < 1e-6 ) this.ref.set( up.y, up.z, up.x ).cross( up );
        this.ref.normalize();
        const zAxis = new THREE.Vector3().crossVectors( this.ref, up );
        this.q.setFromRotationMatrix( new THREE.Matrix4().makeBasis( this.ref, up, zAxis ) );
        this.up = up;
    }

    toWorld( local, out = new THREE.Vector3() ) {
        this.group.updateMatrixWorld( true );
        return out.copy( local ).applyQuaternion( this.q ).applyMatrix4( this.group.matrixWorld );
    }

    toLocal( world, out = new THREE.Vector3() ) {
        this.group.updateMatrixWorld( true );
        return out.copy( world ).applyMatrix4( this.group.matrixWorld.clone().invert() ).applyQuaternion( this.q.clone().invert() );
    }

    quaternion( out = new THREE.Quaternion() ) {
        this.group.updateMatrixWorld( true );
        return this.group.getWorldQuaternion( out ).multiply( this.q );
    }

    solidAtLocal( p ) {
        const pr = p.clone().applyQuaternion( this.q ), r = this.rock, n = r.size, v = r.voxel;
        const ix = Math.floor( pr.x / v + n / 2 ), iy = Math.floor( pr.y / v + n / 2 ), iz = Math.floor( pr.z / v + n / 2 );
        if ( ix < 0 || iy < 0 || iz < 0 || ix >= n || iy >= n || iz >= n ) return false;
        return !! r.vol[ ( ix * n + iy ) * n + iz ];
    }

    retarget( pos ) {
        const pr = pos.clone().applyQuaternion( this.q );
        this.orient( pr );
        pos.copy( pr ).applyQuaternion( this.q.clone().invert() );
        return pr.length();
    }

    dispose() {}
}
