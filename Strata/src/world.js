import * as THREE from 'three';
import { CHUNK, HEIGHT, AIR, isSolid } from './blocks.js';

const key = ( cx, cz ) => `${cx},${cz}`;

export class World {
    constructor( scene, seed, radius ) {
        this.scene = scene;
        this.seed = seed;
        this.radius = radius;
        this.chunks = new Map();
        this.pending = new Set();
        this.queue = [];
        this.inbox = [];
        this.center = null;
        this.solidMat = new THREE.MeshLambertMaterial( { vertexColors: true } );
        this.waterMat = new THREE.MeshLambertMaterial( { vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false } );
        const n = Math.max( 1, Math.min( 4, ( navigator.hardwareConcurrency || 4 ) - 1 ) );
        this.workers = Array.from( { length: n }, () => {
            const w = new Worker( new URL( './worker.js', import.meta.url ), { type: 'module' } );
            w.busy = false;
            w.onmessage = ( { data } ) => {
                w.busy = false;
                this.inbox.push( data );
                this.pump();
            };
            return w;
        } );
    }

    update( x, z ) {
        const cx = Math.floor( x / CHUNK ), cz = Math.floor( z / CHUNK );
        if ( this.center && this.center.cx === cx && this.center.cz === cz ) return;
        this.center = { cx, cz };
        const r = this.radius, wanted = [];
        for ( let dx = -r; dx <= r; dx++ ) for ( let dz = -r; dz <= r; dz++ ) {
            const d2 = dx * dx + dz * dz;
            if ( d2 > r * r + r ) continue;
            const k = key( cx + dx, cz + dz );
            if ( ! this.chunks.has( k ) && ! this.pending.has( k ) ) wanted.push( { cx: cx + dx, cz: cz + dz, d2 } );
        }
        wanted.sort( ( a, b ) => a.d2 - b.d2 );
        this.queue = wanted;
        for ( const [ k, c ] of this.chunks ) {
            const dx = c.cx - cx, dz = c.cz - cz;
            if ( dx * dx + dz * dz > ( r + 2 ) * ( r + 2 ) ) this.unload( k );
        }
        this.pump();
    }

    pump() {
        for ( const w of this.workers ) {
            if ( w.busy || ! this.queue.length ) continue;
            const job = this.queue.shift();
            const k = key( job.cx, job.cz );
            if ( this.chunks.has( k ) ) continue;
            this.pending.add( k );
            w.busy = true;
            w.postMessage( { cx: job.cx, cz: job.cz, seed: this.seed } );
        }
    }

    absorb( budget = 2 ) {
        while ( budget-- > 0 && this.inbox.length ) this.install( this.inbox.shift() );
    }

    install( data ) {
        const k = key( data.cx, data.cz );
        this.pending.delete( k );
        if ( this.chunks.has( k ) ) return;
        const group = new THREE.Group();
        group.position.set( data.cx * CHUNK, 0, data.cz * CHUNK );
        for ( const [ part, mat ] of [ [ data.solid, this.solidMat ], [ data.water, this.waterMat ] ] ) {
            if ( ! part.idx.length ) continue;
            const g = new THREE.BufferGeometry();
            g.setAttribute( 'position', new THREE.BufferAttribute( part.pos, 3 ) );
            g.setAttribute( 'color', new THREE.BufferAttribute( part.col, 3, true ) );
            g.setAttribute( 'normal', new THREE.BufferAttribute( part.nrm, 3, true ) );
            g.setIndex( new THREE.BufferAttribute( part.idx, 1 ) );
            g.computeBoundingSphere();
            const m = new THREE.Mesh( g, mat );
            m.frustumCulled = true;
            group.add( m );
        }
        this.scene.add( group );
        this.chunks.set( k, { cx: data.cx, cz: data.cz, group, blocks: data.blocks, biomes: data.biomes } );
    }

    unload( k ) {
        const c = this.chunks.get( k );
        if ( ! c ) return;
        this.scene.remove( c.group );
        c.group.traverse( ( o ) => o.geometry && o.geometry.dispose() );
        this.chunks.delete( k );
    }

    chunkAt( x, z ) {
        return this.chunks.get( key( Math.floor( x / CHUNK ), Math.floor( z / CHUNK ) ) );
    }

    block( x, y, z ) {
        if ( y < 0 || y >= HEIGHT ) return AIR;
        const c = this.chunkAt( x, z );
        if ( ! c ) return undefined;
        const lx = x - c.cx * CHUNK, lz = z - c.cz * CHUNK;
        return c.blocks[ ( lx * CHUNK + lz ) * HEIGHT + y ];
    }

    solidAt( x, y, z ) {
        const b = this.block( Math.floor( x ), Math.floor( y ), Math.floor( z ) );
        return b === undefined ? true : isSolid( b );
    }

    loaded( x, z ) {
        return !! this.chunkAt( x, z );
    }

    top( x, z ) {
        for ( let y = HEIGHT - 1; y >= 0; y-- ) if ( isSolid( this.block( x, y, z ) ) ) return y;
        return 0;
    }

    biome( x, z ) {
        const c = this.chunkAt( x, z );
        if ( ! c ) return -1;
        return c.biomes[ ( Math.floor( x ) - c.cx * CHUNK ) * CHUNK + ( Math.floor( z ) - c.cz * CHUNK ) ];
    }

    get stats() {
        return { loaded: this.chunks.size, pending: this.pending.size + this.queue.length };
    }
}
