const TRYSTERO = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/nostr/+esm';
const APP = 'kf-scatter-v1';

async function roomId( vault ) {
    const buf = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( APP + ':' + vault ) );
    return [ ...new Uint8Array( buf ) ].slice( 0, 12 ).map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}

export class Net {
    constructor( vault ) {
        this.vault = vault;
        this.id = crypto.randomUUID().replace( /-/g, '' ).slice( 0, 20 );
        this.peers = new Map();
        this.handlers = new Map();
        this.onPeer = () => {};
        this.onRelay = () => {};
        this.relayCount = 0;
        this.room = null;
    }

    on( action, fn ) {
        this.handlers.set( action, fn );
    }

    deliver( from, action, data, metadata ) {
        const fn = this.handlers.get( action );
        if ( fn ) fn( data, from, metadata || {} );
    }

    touch( id, via ) {
        if ( id === this.id ) return;
        let p = this.peers.get( id );
        const fresh = ! p;
        if ( fresh ) { p = { local: false, relay: false, seen: 0 }; this.peers.set( id, p ); }
        p[ via ] = true;
        p.seen = Date.now();
        if ( fresh ) this.onPeer( id, true );
    }

    drop( id, via ) {
        const p = this.peers.get( id );
        if ( ! p ) return;
        p[ via ] = false;
        if ( via === 'local' || ! p.relay ) { this.peers.delete( id ); this.onPeer( id, false ); }
    }

    async connect() {
        let mod = null;
        try { mod = await import( TRYSTERO ); } catch ( e ) { this.relayError = e; }
        if ( mod ) this.id = mod.selfId;
        this.openLocal();
        if ( mod ) await this.openRelay( mod );
        return this;
    }

    openLocal() {
        this.bc = new BroadcastChannel( `scatter:${this.vault}` );
        this.bc.onmessage = ( { data: m } ) => {
            if ( m.from === this.id || ( m.to && m.to !== this.id ) ) return;
            if ( m.action === '__bye' ) return this.drop( m.from, 'local' );
            this.touch( m.from, 'local' );
            if ( m.action !== '__ping' ) this.deliver( m.from, m.action, m.data, m.metadata );
        };
        const ping = () => this.bc.postMessage( { from: this.id, action: '__ping' } );
        ping();
        this.pinger = setInterval( () => {
            ping();
            for ( const [ id, p ] of this.peers ) if ( p.local && Date.now() - p.seen > 6000 ) this.drop( id, 'local' );
        }, 2000 );
        addEventListener( 'pagehide', () => this.bc.postMessage( { from: this.id, action: '__bye' } ) );
    }

    async openRelay( mod ) {
        const room = mod.joinRoom( { appId: APP, password: this.vault, relayConfig: { redundancy: 4, warnOnRelayFailure: false } }, await roomId( this.vault ) );
        this.room = room;
        this.action = room.makeAction( 'm' );
        this.action.onMessage = ( data, { peerId, metadata } ) => {
            this.touch( peerId, 'relay' );
            if ( data instanceof ArrayBuffer ) data = new Uint8Array( data );
            this.deliver( peerId, metadata.action, data, metadata );
        };
        room.onPeerJoin = ( id ) => this.touch( id, 'relay' );
        room.onPeerLeave = ( id ) => this.drop( id, 'relay' );
        const poll = () => {
            const socks = Object.values( mod.getRelaySockets() );
            const n = socks.filter( ( s ) => s.readyState === 1 ).length;
            if ( n !== this.relayCount ) { this.relayCount = n; this.onRelay( n, socks.length ); }
        };
        this.relayPoll = setInterval( poll, 1000 );
        poll();
    }

    send( action, data, { target = null, metadata = {} } = {} ) {
        const meta = { ...metadata, action };
        const ids = target ? [ target ] : [ ...this.peers.keys() ];
        const relayIds = [];
        for ( const id of ids ) {
            const p = this.peers.get( id );
            if ( ! p ) continue;
            if ( p.local ) this.bc.postMessage( { from: this.id, to: id, action, data, metadata } );
            else if ( p.relay ) relayIds.push( id );
        }
        if ( relayIds.length && this.action ) this.action.send( data, { target: relayIds, metadata: meta } ).catch( () => {} );
    }

    close() {
        clearInterval( this.pinger );
        clearInterval( this.relayPoll );
        if ( this.bc ) { this.bc.postMessage( { from: this.id, action: '__bye' } ); this.bc.close(); }
        if ( this.room ) this.room.leave();
    }
}
