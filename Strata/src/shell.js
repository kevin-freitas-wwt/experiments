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
