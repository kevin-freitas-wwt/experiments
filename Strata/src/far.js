import * as THREE from 'three';
import { CHUNK, SEA } from './blocks.js';
import { tileMat, oceanMat } from './materials.js';

const N = 33;

function gridIndex() {
    const idx = new Uint16Array( ( N - 1 ) * ( N - 1 ) * 6 );
    let i = 0;
    for ( let z = 0; z < N - 1; z++ ) for ( let x = 0; x < N - 1; x++ ) {
        const a = z * N + x, b = a + 1, c = a + N, d = c + 1;
        idx.set( [ a, c, b, b, c, d ], i );
        i += 6;
    }
    return new THREE.BufferAttribute( idx, 1 );
}

class Level {
    constructor( scene, pool, seed, size, range ) {
        this.scene = scene; this.pool = pool; this.seed = seed;
        this.size = size; this.step = size / ( N - 1 ); this.range = range;
        this.tiles = new Map();
        this.index = gridIndex();
        this.drop = this.step / 16;
    }

    key( tx, tz ) {
        return `${tx},${tz}`;
    }

    update( px, pz, range = this.range ) {
        const t0 = Math.floor( ( px - range ) / this.size ), t1 = Math.floor( ( px + range ) / this.size );
        const u0 = Math.floor( ( pz - range ) / this.size ), u1 = Math.floor( ( pz + range ) / this.size );
        const near = ( tx, tz ) => Math.hypot( ( tx + 0.5 ) * this.size - px, ( tz + 0.5 ) * this.size - pz );
        this.pool.cancel( 'tile' + this.size, ( p ) => near( p.tx, p.tz ) <= range );
        for ( let tx = t0; tx <= t1; tx++ ) for ( let tz = u0; tz <= u1; tz++ ) {
            const d = near( tx, tz );
            if ( d > range ) continue;
            const k = this.key( tx, tz );
            if ( this.tiles.has( k ) ) continue;
            this.tiles.set( k, { tx, tz, mesh: null } );
            this.pool.submit( { type: 'tile', tx, tz, x0: tx * this.size, z0: tz * this.size, size: this.size, step: this.step, seed: this.seed }, { priority: d, tag: 'tile' + this.size } )
                .then( ( data ) => this.install( data ) );
        }
        for ( const [ k, t ] of this.tiles ) {
            if ( near( t.tx, t.tz ) <= range * 1.25 ) continue;
            if ( t.mesh ) { this.scene.remove( t.mesh ); t.mesh.geometry.dispose(); }
            this.tiles.delete( k );
        }
    }

    install( data ) {
        const t = this.tiles.get( this.key( data.tx, data.tz ) );
        if ( ! t || t.mesh ) return;
        for ( let i = 1; i < data.pos.length; i += 3 ) data.pos[ i ] -= this.drop;
        const g = new THREE.BufferGeometry();
        g.setAttribute( 'position', new THREE.BufferAttribute( data.pos, 3 ) );
        g.setAttribute( 'color', new THREE.BufferAttribute( data.col, 3, true ) );
        g.setIndex( this.index );
        g.computeVertexNormals();
        g.computeBoundingSphere();
        const m = new THREE.Mesh( g, tileMat );
        m.position.set( data.x0, 0, data.z0 );
        t.mesh = m;
        this.scene.add( m );
    }

    has( tx, tz ) {
        const t = this.tiles.get( this.key( tx, tz ) );
        return !! ( t && t.mesh );
    }

    clear() {
        for ( const t of this.tiles.values() ) if ( t.mesh ) { this.scene.remove( t.mesh ); t.mesh.geometry.dispose(); }
        this.tiles.clear();
    }

    get count() {
        let n = 0;
        for ( const t of this.tiles.values() ) if ( t.mesh ) n++;
        return n;
    }
}

export class FarField {
    constructor( scene, pool, seed, radius ) {
        const scale = radius / 8;
        this.fine = new Level( scene, pool, seed, 256, 3000 * scale );
        this.coarse = new Level( scene, pool, seed, 4096, 40000 * scale );
        this.fineCeiling = 9000;
        this.ocean = new THREE.Mesh( new THREE.RingGeometry( 1, 150000, 64, 60 ).rotateX( -Math.PI / 2 ), oceanMat );
        this.ocean.position.y = SEA - 14;
        scene.add( this.ocean );
        this.timer = 0;
    }

    update( dt, pos, world ) {
        this.timer -= dt;
        if ( this.timer > 0 ) return;
        this.timer = 0.4;
        const alt = pos.y - SEA;
        if ( alt < this.fineCeiling ) this.fine.update( pos.x, pos.z );
        else this.fine.clear();
        this.coarse.update( pos.x, pos.z );
        this.ocean.position.x = pos.x; this.ocean.position.z = pos.z;
        this.cull( world );
    }

    cull( world ) {
        const per = this.fine.size / CHUNK;
        for ( const t of this.fine.tiles.values() ) {
            if ( ! t.mesh ) continue;
            let covered = true;
            for ( let cx = 0; cx < per && covered; cx++ ) for ( let cz = 0; cz < per; cz++ )
                if ( ! world.chunks.has( `${t.tx * per + cx},${t.tz * per + cz}` ) ) { covered = false; break; }
            t.mesh.visible = ! covered;
        }
        const ratio = this.coarse.size / this.fine.size;
        for ( const t of this.coarse.tiles.values() ) {
            if ( ! t.mesh ) continue;
            let covered = true;
            for ( let fx = 0; fx < ratio && covered; fx++ ) for ( let fz = 0; fz < ratio; fz++ )
                if ( ! this.fine.has( t.tx * ratio + fx, t.tz * ratio + fz ) ) { covered = false; break; }
            t.mesh.visible = ! covered;
        }
    }

    get stats() {
        return { fine: this.fine.count, coarse: this.coarse.count };
    }
}
