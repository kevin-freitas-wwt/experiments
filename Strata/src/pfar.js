import * as THREE from 'three';
import { planetTileMat, fadeIn, fadeOut } from './materials.js';

const N = 33;
// Shared triangle index for an N x N heightfield tile.
export function gridIndex() {
    const idx = new Uint16Array( ( N - 1 ) * ( N - 1 ) * 6 );
    let i = 0;
    for ( let z = 0; z < N - 1; z++ ) for ( let x = 0; x < N - 1; x++ ) {
        const a = z * N + x, b = a + 1, c = a + N, d = c + 1;
        idx.set( [ a, c, b, b, c, d ], i );
        i += 6;
    }
    return new THREE.BufferAttribute( idx, 1 );
}

const SIZE = 256, STEP = 8;

// Heightfield tiles for one planet: a level of detail between the voxel ring and the smooth sphere.
// Tiles are keyed on a gnomonic grid in a tangent frame around `dir` but hold exact body-local sphere
// points, so they sit on the sphere and any two frames' tiles overlay without seams.
export class PlanetFar {
    constructor( pool, body, dir, scale ) {
        this.pool = pool; this.body = body; this.index = gridIndex();
        this.up = dir.clone().normalize();
        const ref = Math.abs( this.up.y ) < 0.9 ? new THREE.Vector3( 0, 1, 0 ) : new THREE.Vector3( 1, 0, 0 );
        this.u = new THREE.Vector3().crossVectors( ref, this.up ).normalize();
        this.w = new THREE.Vector3().crossVectors( this.u, this.up );
        this.range = Math.min( 3000 * scale, body.radius * 0.35 );
        this.tag = 'ptile' + body.seed + ':' + Math.random();
        this.terrain = { planet: body.kind, radius: body.radius, up: this.up.toArray(), u: this.u.toArray(), w: this.w.toArray() };
        this.tiles = new Map();
        this.timer = 0;
    }

    // Gnomonic coordinates of a body-local point in this frame (null behind the horizon of the frame).
    project( local ) {
        const h = local.dot( this.up );
        if ( h <= this.body.radius * 0.2 ) return null;
        const s = this.body.radius / h;
        return { x: local.dot( this.u ) * s, z: local.dot( this.w ) * s };
    }

    update( dt, local, face = null ) {
        this.timer -= dt;
        if ( this.timer > 0 ) return;
        this.timer = 0.4;
        const p = this.project( local );
        if ( ! p ) return;
        const { x: px, z: pz } = p, range = this.range, size = SIZE;
        const t0 = Math.floor( ( px - range ) / size ), t1 = Math.floor( ( px + range ) / size );
        const u0 = Math.floor( ( pz - range ) / size ), u1 = Math.floor( ( pz + range ) / size );
        const near = ( tx, tz ) => Math.hypot( ( tx + 0.5 ) * size - px, ( tz + 0.5 ) * size - pz );
        this.pool.cancel( this.tag, ( j ) => near( j.tx, j.tz ) <= range );
        for ( let tx = t0; tx <= t1; tx++ ) for ( let tz = u0; tz <= u1; tz++ ) {
            const d = near( tx, tz );
            if ( d > range ) continue;
            const k = `${tx},${tz}`;
            if ( this.tiles.has( k ) ) continue;
            this.tiles.set( k, { tx, tz, mesh: null, born: 0 } );
            const dx = ( tx + 0.5 ) * size - px, dz = ( tz + 0.5 ) * size - pz;
            const ahead = face && d > 1 ? ( dx * face.x + dz * face.z ) / d : 0;
            this.pool.submit( { type: 'tile', tx, tz, x0: tx * size, z0: tz * size, size, step: STEP, seed: this.body.seed, terrain: this.terrain }, { priority: 2 + d * ( 1.25 - 0.95 * ahead ) / 100, tag: this.tag } )
                .then( ( data ) => this.install( data ) );
        }
        for ( const [ k, t ] of this.tiles ) {
            if ( near( t.tx, t.tz ) <= range * 1.25 ) continue;
            this.drop( t );
            this.tiles.delete( k );
        }
    }

    install( data ) {
        const t = this.tiles.get( `${data.tx},${data.tz}` );
        if ( ! t || t.mesh || this.dead ) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute( 'position', new THREE.BufferAttribute( data.pos, 3 ) );
        g.setAttribute( 'color', new THREE.BufferAttribute( data.col, 3, true ) );
        g.setIndex( this.index );
        g.computeVertexNormals();
        g.computeBoundingSphere();
        const m = new THREE.Mesh( g, planetTileMat );
        fadeIn( m, 0.8 );
        t.mesh = m; t.born = performance.now();
        this.body.group.add( m );
    }

    drop( t ) {
        if ( t.mesh ) { this.body.group.remove( t.mesh ); t.mesh.geometry.dispose(); }
    }

    // Radius around the player (in frame metres) within which every tile is installed and has settled.
    coveredRadius( local, settle = 900 ) {
        const p = this.project( local );
        if ( ! p ) return 0;
        const now = performance.now(), size = SIZE;
        let best = this.range;
        for ( let tx = Math.floor( ( p.x - this.range ) / size ); tx <= Math.floor( ( p.x + this.range ) / size ); tx++ )
            for ( let tz = Math.floor( ( p.z - this.range ) / size ); tz <= Math.floor( ( p.z + this.range ) / size ); tz++ ) {
                const d = Math.hypot( ( tx + 0.5 ) * size - p.x, ( tz + 0.5 ) * size - p.z );
                if ( d > this.range ) continue;
                const t = this.tiles.get( `${tx},${tz}` );
                if ( t && t.mesh && now - t.born > settle ) continue;
                best = Math.min( best, Math.max( 0, d - size * 0.71 ) );
            }
        return best;
    }

    // How far the player has drifted from this frame's axis, as a fraction of the useful range.
    drift( local ) {
        const p = this.project( local );
        return p ? Math.hypot( p.x, p.z ) / this.range : 2;
    }

    fadeOut( onDone ) {
        this.dead = true;
        this.pool.cancel( this.tag, () => false );
        let n = 0;
        for ( const t of this.tiles.values() ) if ( t.mesh ) { n++; fadeOut( t.mesh, 0.8, () => { if ( --n === 0 ) onDone(); } ); }
        if ( ! n ) onDone();
    }

    dispose() {
        this.dead = true;
        this.pool.cancel( this.tag, () => false );
        for ( const t of this.tiles.values() ) this.drop( t );
        this.tiles.clear();
    }
}
