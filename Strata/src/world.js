import * as THREE from 'three';
import { CHUNK, HEIGHT, AIR, isSolid } from './blocks.js';
import { solidMat, waterMat, fadeIn, fadeOut } from './materials.js';

const key = ( cx, cz ) => `${cx},${cz}`;

export class World {
    constructor( scene, pool, seed, radius, terrain = null ) {
        this.scene = scene;
        this.pool = pool;
        this.seed = seed;
        this.radius = radius;
        this.terrain = terrain;
        this.tag = 'chunk' + ( terrain ? Math.random().toString( 36 ).slice( 2, 7 ) : '' );
        this.chunks = new Map();
        this.pending = new Set();
        this.inbox = [];
        this.center = null;
    }

    // Chunks ahead of the facing direction are generated first; the queue is re-ranked when the view turns.
    priority( cx, cz, dx, dz ) {
        const d = Math.hypot( dx, dz );
        if ( d < 0.5 ) return -1;
        const cos = ( dx * this.face.x + dz * this.face.z ) / d;
        return d * d * ( 1.25 - 0.95 * cos ) + ( this.terrain ? -1000 : 0 );
    }

    update( x, z, fx = 0, fz = 0 ) {
        const cx = Math.floor( x / CHUNK ), cz = Math.floor( z / CHUNK );
        if ( fx || fz ) this.face = { x: fx, z: fz };
        else if ( ! this.face ) this.face = { x: 0, z: -1 };
        if ( this.center && this.center.cx === cx && this.center.cz === cz ) {
            const turned = this.queuedFace && ( this.queuedFace.x * this.face.x + this.queuedFace.z * this.face.z ) < 0.85;
            if ( turned && this.pool.queue.some( ( j ) => j.tag === this.tag ) ) {
                this.queuedFace = { ...this.face };
                this.pool.reprioritize( this.tag, ( p ) => this.priority( p.cx, p.cz, p.cx - cx, p.cz - cz ) );
            }
            return;
        }
        this.center = { cx, cz };
        this.queuedFace = { ...this.face };
        const r = this.radius, inRing = ( p ) => {
            const dx = p.cx - cx, dz = p.cz - cz;
            return dx * dx + dz * dz <= r * r + r;
        };
        this.pool.cancel( this.tag, inRing );
        for ( const k of this.pending ) {
            const [ pcx, pcz ] = k.split( ',' ).map( Number );
            if ( ! inRing( { cx: pcx, cz: pcz } ) ) this.pending.delete( k );
        }
        for ( let dx = -r; dx <= r; dx++ ) for ( let dz = -r; dz <= r; dz++ ) {
            const d2 = dx * dx + dz * dz;
            if ( d2 > r * r + r ) continue;
            const k = key( cx + dx, cz + dz );
            if ( this.chunks.has( k ) || this.pending.has( k ) ) continue;
            this.pending.add( k );
            this.pool.submit( { type: 'chunk', cx: cx + dx, cz: cz + dz, seed: this.seed, terrain: this.terrain }, { priority: this.priority( cx + dx, cz + dz, dx, dz ), tag: this.tag } )
                .then( ( data ) => this.inbox.push( data ) );
        }
        for ( const [ k, c ] of this.chunks ) {
            const dx = c.cx - cx, dz = c.cz - cz;
            if ( dx * dx + dz * dz > ( r + 2 ) * ( r + 2 ) ) this.unload( k );
        }
    }

    absorb( budget = 2 ) {
        while ( budget-- > 0 && this.inbox.length ) this.install( this.inbox.shift() );
    }

    install( data ) {
        const k = key( data.cx, data.cz );
        if ( ! this.pending.has( k ) || this.chunks.has( k ) ) return;
        this.pending.delete( k );
        const group = new THREE.Group();
        group.position.set( data.cx * CHUNK, 0, data.cz * CHUNK );
        for ( const [ part, mat ] of [ [ data.solid, solidMat ], [ data.water, waterMat ] ] ) {
            if ( ! part.idx.length ) continue;
            const g = new THREE.BufferGeometry();
            g.setAttribute( 'position', new THREE.BufferAttribute( part.pos, 3 ) );
            g.setAttribute( 'color', new THREE.BufferAttribute( part.col, 3, true ) );
            g.setAttribute( 'normal', new THREE.BufferAttribute( part.nrm, 3, true ) );
            g.setIndex( new THREE.BufferAttribute( part.idx, 1 ) );
            g.computeBoundingSphere();
            const m = new THREE.Mesh( g, mat );
            if ( mat === solidMat && ( this.terrain || ( this.center && ( Math.abs( data.cx - this.center.cx ) > 1 || Math.abs( data.cz - this.center.cz ) > 1 ) ) ) ) fadeIn( m );
            group.add( m );
        }
        this.scene.add( group );
        this.chunks.set( k, { cx: data.cx, cz: data.cz, group, blocks: data.blocks, biomes: data.biomes } );
    }

    fadeOut( duration, onDone ) {
        let n = 0;
        for ( const c of this.chunks.values() ) c.group.children.forEach( ( m ) => { n++; fadeOut( m, duration ); } );
        setTimeout( onDone, duration * 1000 + 50 );
        return n;
    }

    dispose() {
        this.pool.cancel( this.tag );
        this.pending.clear();
        this.inbox.length = 0;
        for ( const k of [ ...this.chunks.keys() ] ) this.unload( k );
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
        return c.blocks[ ( ( x - c.cx * CHUNK ) * CHUNK + ( z - c.cz * CHUNK ) ) * HEIGHT + y ];
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
        return { loaded: this.chunks.size, pending: this.pending.size };
    }
}
