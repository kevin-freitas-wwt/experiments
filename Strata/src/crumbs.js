import * as THREE from 'three';

const CAP = 4096;

export class Crumbs {
    constructor( scene, spacing = 8 ) {
        this.spacing = spacing;
        this.on = false;
        this.count = 0;
        this.last = null;
        this.mesh = new THREE.InstancedMesh(
            new THREE.SphereGeometry( 0.22, 10, 8 ),
            new THREE.MeshBasicMaterial( { color: 0xff2614, fog: false } ),
            CAP
        );
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        this.dummy = new THREE.Object3D();
        scene.add( this.mesh );
    }

    toggle() {
        this.on = ! this.on;
        if ( this.on ) this.last = null;
        return this.on;
    }

    clear() {
        this.count = 0;
        this.mesh.count = 0;
        this.last = null;
    }

    step( pos ) {
        if ( ! this.on || this.count >= CAP ) return;
        if ( this.last && Math.hypot( pos.x - this.last.x, pos.z - this.last.z ) < this.spacing ) return;
        this.last = pos.clone();
        this.dummy.position.set( pos.x, pos.y + 0.22, pos.z );
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt( this.count++, this.dummy.matrix );
        this.mesh.count = this.count;
        this.mesh.instanceMatrix.needsUpdate = true;
    }
}
