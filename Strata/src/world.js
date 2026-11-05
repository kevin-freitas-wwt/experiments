import * as THREE from 'three';
import { CHUNK, HEIGHT, AIR, isSolid } from './blocks.js';
import { terrainMaterials } from './materials.js';

const key = ( cx, cz ) => `${cx},${cz}`;
const BATCH = 4;

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
        this.batches = new Map();
        this.dirty = new Set();
        this.mats = terrainMaterials();
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
        this.flush();
        this.scene.updateWorldMatrix( true, false );
        ( this.mats.water.userData.frameInv || ( this.mats.water.userData.frameInv = { value: new THREE.Matrix4() } ) ).value.copy( this.scene.matrixWorld ).invert();
    }

    // Chunks are grouped into BATCH×BATCH super-chunks, one mesh per material, rebuilt when a member
    // arrives or leaves; fade-in is per vertex from the `born` attribute, so no per-chunk mesh is needed.
    install( data ) {
        const k = key( data.cx, data.cz );
        if ( ! this.pending.has( k ) || this.chunks.has( k ) ) return;
        this.pending.delete( k );
        const near = ! this.terrain && this.center && Math.abs( data.cx - this.center.cx ) <= 1 && Math.abs( data.cz - this.center.cz ) <= 1;
        const born = near ? -1e9 : performance.now() / 1000;
        this.chunks.set( k, { cx: data.cx, cz: data.cz, solid: data.solid, water: data.water, fade: born, blocks: data.blocks, biomes: data.biomes, born: performance.now() } );
        this.touch( data.cx, data.cz );
    }

    touch( cx, cz ) {
        const bx = Math.floor( cx / BATCH ), bz = Math.floor( cz / BATCH ), bk = key( bx, bz );
        let b = this.batches.get( bk );
        if ( ! b ) { b = { bx, bz, meshes: {} }; this.batches.set( bk, b ); }
        this.dirty.add( bk );
    }

    rebuild( bk ) {
        const b = this.batches.get( bk );
        if ( ! b ) return;
        const members = [];
        for ( let dx = 0; dx < BATCH; dx++ ) for ( let dz = 0; dz < BATCH; dz++ ) { const c = this.chunks.get( key( b.bx * BATCH + dx, b.bz * BATCH + dz ) ); if ( c ) members.push( c ); }
        for ( const part of [ 'solid', 'water' ] ) {
            let nv = 0, ni = 0;
            for ( const c of members ) { nv += c[ part ].pos.length / 3; ni += c[ part ].idx.length; }
            const old = b.meshes[ part ];
            if ( old ) { this.scene.remove( old ); old.geometry.dispose(); b.meshes[ part ] = null; }
            if ( ! ni ) continue;
            const pos = new Float32Array( nv * 3 ), col = new Uint8Array( nv * 3 ), nrm = new Int8Array( nv * 3 ), born = new Float32Array( nv ), idx = new Uint32Array( ni );
            let vo = 0, io = 0;
            for ( const c of members ) {
                const p = c[ part ], n = p.pos.length / 3, ox = ( c.cx - b.bx * BATCH ) * CHUNK, oz = ( c.cz - b.bz * BATCH ) * CHUNK;
                for ( let i = 0; i < n; i++ ) { pos[ ( vo + i ) * 3 ] = p.pos[ i * 3 ] + ox; pos[ ( vo + i ) * 3 + 1 ] = p.pos[ i * 3 + 1 ]; pos[ ( vo + i ) * 3 + 2 ] = p.pos[ i * 3 + 2 ] + oz; }
                col.set( p.col, vo * 3 ); nrm.set( p.nrm, vo * 3 ); born.fill( c.fade, vo, vo + n );
                for ( let i = 0; i < p.idx.length; i++ ) idx[ io + i ] = p.idx[ i ] + vo;
                vo += n; io += p.idx.length;
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
            g.setAttribute( 'color', new THREE.BufferAttribute( col, 3, true ) );
            g.setAttribute( 'normal', new THREE.BufferAttribute( nrm, 3, true ) );
            g.setAttribute( 'born', new THREE.BufferAttribute( born, 1 ) );
            g.setIndex( new THREE.BufferAttribute( idx, 1 ) );
            g.computeBoundingSphere();
            const m = new THREE.Mesh( g, this.mats[ part ] );
            m.position.set( b.bx * BATCH * CHUNK, 0, b.bz * BATCH * CHUNK );
            b.meshes[ part ] = m;
            this.scene.add( m );
        }
        if ( ! members.length ) this.batches.delete( bk );
    }

    flush( budget = 4 ) {
        for ( const bk of this.dirty ) { this.rebuild( bk ); this.dirty.delete( bk ); if ( --budget <= 0 ) break; }
    }

    fadeOut( duration, onDone ) {
        this.mats.die.dieAt.value = performance.now() / 1000;
        this.mats.die.dieDur.value = duration;
        for ( const m of [ this.mats.solid, this.mats.water ] ) { m.polygonOffset = true; m.polygonOffsetFactor = 2; m.polygonOffsetUnits = 2; }
        setTimeout( onDone, duration * 1000 + 50 );
        return this.chunks.size;
    }

    dispose() {
        this.pool.cancel( this.tag );
        this.pending.clear();
        this.inbox.length = 0;
        this.chunks.clear();
        for ( const b of this.batches.values() ) for ( const m of Object.values( b.meshes ) ) if ( m ) { this.scene.remove( m ); m.geometry.dispose(); }
        this.batches.clear(); this.dirty.clear();
        for ( const m of [ this.mats.solid, this.mats.water ] ) m.dispose();
    }

    unload( k ) {
        const c = this.chunks.get( k );
        if ( ! c ) return;
        this.chunks.delete( k );
        this.touch( c.cx, c.cz );
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

    // Radius around (x, z) within which every chunk is loaded and has finished fading in.
    coveredRadius( x, z, settle = 650 ) {
        const cx = Math.floor( x / CHUNK ), cz = Math.floor( z / CHUNK ), now = performance.now(), r = this.radius;
        let best = ( r + 1 ) * CHUNK;
        for ( let dx = -r; dx <= r; dx++ ) for ( let dz = -r; dz <= r; dz++ ) {
            const d2 = dx * dx + dz * dz;
            if ( d2 > r * r + r ) continue;
            const c = this.chunks.get( key( cx + dx, cz + dz ) );
            if ( c && now - c.born > settle ) continue;
            const d = Math.max( 0, ( Math.sqrt( d2 ) - 0.71 ) * CHUNK );
            if ( d < best ) best = d;
        }
        return best;
    }

    get stats() {
        return { loaded: this.chunks.size, pending: this.pending.size };
    }
}
