const STALE = 20000;

function open() {
    return new Promise( ( resolve, reject ) => {
        const req = indexedDB.open( 'scatter', 1 );
        req.onupgradeneeded = () => {
            const db = req.result;
            db.createObjectStore( 'manifests', { keyPath: 'key' } ).createIndex( 'vault', 'vault' );
            db.createObjectStore( 'shards', { keyPath: 'key' } ).createIndex( 'node', 'node' );
            db.createObjectStore( 'nodes', { keyPath: 'key' } ).createIndex( 'vault', 'vault' );
        };
        req.onsuccess = () => resolve( req.result );
        req.onerror = () => reject( req.error );
    } );
}

const done = ( req ) => new Promise( ( resolve, reject ) => {
    req.onsuccess = () => resolve( req.result );
    req.onerror = () => reject( req.error );
} );

export class Store {
    constructor( vault, node ) {
        this.vault = vault;
        this.node = `${vault}/${node}`;
        this.ready = open().then( async ( db ) => {
            this.db = db;
            await this.purge();
            await this.beat();
            this.timer = setInterval( () => this.beat(), 5000 );
            return db;
        } );
    }

    async tx( name, mode = 'readonly' ) {
        await this.ready;
        return this.db.transaction( name, mode ).objectStore( name );
    }

    async beat() {
        const s = this.db.transaction( 'nodes', 'readwrite' ).objectStore( 'nodes' );
        await done( s.put( { key: this.node, vault: this.vault, seen: Date.now() } ) );
    }

    async purge() {
        const nodes = this.db.transaction( 'nodes', 'readonly' ).objectStore( 'nodes' );
        const rows = await done( nodes.index( 'vault' ).getAll( this.vault ) );
        for ( const r of rows ) {
            if ( Date.now() - r.seen < STALE ) continue;
            const shards = this.db.transaction( 'shards', 'readwrite' ).objectStore( 'shards' );
            for ( const k of await done( shards.index( 'node' ).getAllKeys( r.key ) ) ) await done( shards.delete( k ) );
            await done( this.db.transaction( 'nodes', 'readwrite' ).objectStore( 'nodes' ).delete( r.key ) );
        }
    }

    close() {
        clearInterval( this.timer );
    }

    async manifests() {
        const s = await this.tx( 'manifests' );
        return done( s.index( 'vault' ).getAll( this.vault ) );
    }

    async putManifest( m ) {
        const s = await this.tx( 'manifests', 'readwrite' );
        await done( s.put( { ...m, key: `${this.vault}/${m.id}`, vault: this.vault } ) );
    }

    async shards() {
        const s = await this.tx( 'shards' );
        const have = {};
        for ( const k of await done( s.index( 'node' ).getAllKeys( this.node ) ) ) {
            const [ id, index ] = k.slice( this.node.length + 1 ).split( '/' );
            ( have[ id ] ||= [] ).push( Number( index ) );
        }
        return have;
    }

    async putShard( id, index, bytes ) {
        const s = await this.tx( 'shards', 'readwrite' );
        await done( s.put( { key: `${this.node}/${id}/${index}`, node: this.node, bytes } ) );
    }

    async getShard( id, index ) {
        const s = await this.tx( 'shards' );
        const row = await done( s.get( `${this.node}/${id}/${index}` ) );
        return row ? row.bytes : null;
    }

    async removeFile( id ) {
        const m = await this.tx( 'manifests', 'readwrite' );
        await done( m.delete( `${this.vault}/${id}` ) );
        const s = await this.tx( 'shards', 'readwrite' );
        for ( const k of await done( s.index( 'node' ).getAllKeys( this.node ) ) ) if ( k.startsWith( `${this.node}/${id}/` ) ) await done( s.delete( k ) );
    }
}
