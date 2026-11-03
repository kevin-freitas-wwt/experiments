import { encode, decode, rebuild } from './rs.js';
import { Store } from './store.js';
import { Net } from './net.js';

const $ = ( s ) => document.querySelector( s );
const esc = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] );
const COLORS = [ '#1c1c1c', '#5b6670', '#8c7b6a', '#3f5c6b', '#7a8a5a', '#9a5b4a', '#4e4a7a' ];
const WORDS = [ 'ash', 'bolt', 'cask', 'dune', 'elm', 'fern', 'gust', 'hull', 'iris', 'jute', 'kelp', 'loom', 'moth', 'nook', 'opal', 'peat', 'quay', 'rook', 'silt', 'tarn' ];

const randomVault = () => `${WORDS[ Math.random() * WORDS.length | 0 ]}-${WORDS[ Math.random() * WORDS.length | 0 ]}-${( Math.random() * 900 + 100 ) | 0}`;
const short = ( id ) => id.slice( 0, 5 );
const fmt = ( b ) => b < 1024 ? `${b} B` : b < 1048576 ? `${( b / 1024 ).toFixed( 1 ) } KB` : `${( b / 1048576 ).toFixed( 2 ) } MB`;
const sha = async ( bytes ) => [ ...new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ) ].map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const colorOf = ( id ) => id === state.net.id ? 'var(--accent)' : COLORS[ [ ...id ].reduce( ( h, c ) => ( h * 31 + c.charCodeAt( 0 ) ) >>> 0, 7 ) % COLORS.length ];

const state = {
    vault: null, net: null, store: null,
    manifests: new Map(), holders: new Map(), pending: new Map(), busy: new Set(),
};

function log( msg, tone = '' ) {
    const el = $( '#log' );
    const row = document.createElement( 'div' );
    row.className = `row ${tone}`;
    row.innerHTML = `<span class="t">${new Date().toTimeString().slice( 0, 8 )}</span><span>${esc( msg )}</span>`;
    el.prepend( row );
    while ( el.children.length > 80 ) el.lastChild.remove();
}

function holdersOf( id ) {
    let m = state.holders.get( id );
    if ( ! m ) { m = new Map(); state.holders.set( id, m ); }
    return m;
}

async function myHave() {
    await state.ready;
    return state.store.shards();
}

async function broadcastHave( target = null ) {
    const have = await myHave();
    for ( const [ id, idx ] of Object.entries( have ) ) holdersOf( id ).set( state.net.id, new Set( idx ) );
    state.net.send( 'have', { have }, { target } );
}

async function join( vault ) {
    if ( state.net ) { state.net.close(); state.store.close(); state.manifests.clear(); state.holders.clear(); }
    state.vault = vault;
    location.hash = encodeURIComponent( vault );
    $( '#vault' ).value = vault;
    let storeReady;
    state.ready = new Promise( ( r ) => { storeReady = r; } );
    const net = state.net = new Net( vault );
    net.onPeer = async ( id, joined ) => {
        if ( joined ) {
            log( `peer ${short( id )} joined` );
            net.send( 'state', { manifests: [ ...state.manifests.values() ], have: await myHave() }, { target: id } );
        } else {
            log( `peer ${short( id )} left`, 'warn' );
            for ( const m of state.holders.values() ) m.delete( id );
        }
        render();
    };
    net.onRelay = ( n, total ) => { $( '#relay-count' ).textContent = `${n}/${total}`; $( '#led-relay' ).classList.toggle( 'on', n > 0 ); };

    net.on( 'state', async ( { manifests, have }, from ) => {
        await state.ready;
        for ( const m of manifests ) if ( ! state.manifests.has( m.id ) ) { state.manifests.set( m.id, m ); await state.store.putManifest( m ); }
        for ( const [ id, idx ] of Object.entries( have ) ) holdersOf( id ).set( from, new Set( idx ) );
        render();
    } );
    net.on( 'have', ( { have }, from ) => {
        for ( const m of state.holders.values() ) m.delete( from );
        for ( const [ id, idx ] of Object.entries( have ) ) holdersOf( id ).set( from, new Set( idx ) );
        render();
    } );
    net.on( 'manifest', async ( { manifest } ) => {
        await state.ready;
        state.manifests.set( manifest.id, manifest );
        await state.store.putManifest( manifest );
        log( `manifest for "${manifest.name}" received` );
        render();
    } );
    net.on( 'shard', async ( bytes, from, { id, index, reqId } ) => {
        if ( reqId ) {
            const p = state.pending.get( reqId );
            if ( p ) { state.pending.delete( reqId ); p( bytes ); }
            return;
        }
        await state.ready;
        await state.store.putShard( id, index, bytes );
        log( `holding shard ${index + 1} of "${state.manifests.get( id )?.name || id}" (${fmt( bytes.byteLength )}) from ${short( from )}` );
        broadcastHave();
        render();
    } );
    net.on( 'get', async ( { id, index, reqId }, from ) => {
        await state.ready;
        const bytes = await state.store.getShard( id, index );
        if ( bytes ) net.send( 'shard', bytes, { target: from, metadata: { id, index, reqId } } );
    } );
    net.on( 'forget', async ( { id } ) => {
        await state.ready;
        const m = state.manifests.get( id );
        state.manifests.delete( id );
        state.holders.delete( id );
        await state.store.removeFile( id );
        log( `"${m?.name || id}" forgotten by the vault`, 'warn' );
        render();
    } );

    await net.connect();
    state.store = new Store( vault, net.id );
    await state.store.ready;
    storeReady();
    for ( const m of await state.store.manifests() ) state.manifests.set( m.id, m );
    $( '#self-id' ).textContent = short( net.id );
    $( '#led-local' ).classList.add( 'on' );
    if ( net.relayError ) { log( 'relay module unavailable; local tabs only', 'warn' ); $( '#relay-count' ).textContent = 'off'; }
    await broadcastHave();
    log( `joined vault "${vault}" as ${short( net.id )}` );
    render();
}

function roster() {
    return [ state.net.id, ...[ ...state.net.peers.keys() ].sort() ];
}

function request( peer, id, index ) {
    return new Promise( ( resolve ) => {
        const reqId = crypto.randomUUID();
        const timer = setTimeout( () => { state.pending.delete( reqId ); resolve( null ); }, 20000 );
        state.pending.set( reqId, ( bytes ) => { clearTimeout( timer ); resolve( bytes ); } );
        state.net.send( 'get', { id, index, reqId }, { target: peer } );
    } );
}

async function gather( m ) {
    const shards = new Array( m.n ).fill( null );
    const hold = holdersOf( m.id );
    let got = 0;
    for ( let i = 0; i < m.n && got < m.k; i++ ) {
        const mine = await state.store.getShard( m.id, i );
        if ( mine ) { shards[ i ] = mine; got++; }
    }
    const wants = [];
    for ( let i = 0; i < m.n && got + wants.length < m.k; i++ ) {
        if ( shards[ i ] ) continue;
        const peer = [ ...hold ].find( ( [ p, set ] ) => p !== state.net.id && set.has( i ) && state.net.peers.has( p ) );
        if ( peer ) wants.push( request( peer[ 0 ], m.id, i ).then( ( b ) => { if ( b ) { shards[ i ] = b; got++; } } ) );
    }
    await Promise.all( wants );
    return { shards, got };
}

async function addFile( file ) {
    const peers = roster(), n = peers.length;
    const lose = Math.min( n - 1, parseInt( $( '#tolerate' ).value, 10 ) );
    const k = n - lose;
    if ( file.size > 32 * 1048576 ) return log( `"${file.name}" is over the 32 MB demo cap`, 'warn' );
    const bytes = new Uint8Array( await file.arrayBuffer() );
    const t0 = performance.now();
    const shards = encode( bytes, k, n );
    const m = { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, k, n, hash: await sha( bytes ), added: Date.now(), by: state.net.id };
    state.manifests.set( m.id, m );
    await state.store.putManifest( m );
    state.net.send( 'manifest', { manifest: m } );
    for ( let i = 0; i < n; i++ ) {
        if ( peers[ i ] === state.net.id ) await state.store.putShard( m.id, i, shards[ i ] );
        else state.net.send( 'shard', shards[ i ], { target: peers[ i ], metadata: { id: m.id, index: i } } );
    }
    await broadcastHave();
    log( `"${file.name}" split ${k}-of-${n} across ${n} peer${n > 1 ? 's' : ''} in ${( performance.now() - t0 ).toFixed( 0 )} ms; ${fmt( shards[ 0 ].length )} per shard` );
    render();
}

async function fetchFile( id ) {
    const m = state.manifests.get( id );
    if ( ! m || state.busy.has( id ) ) return;
    state.busy.add( id ); render();
    try {
        const { shards, got } = await gather( m );
        if ( got < m.k ) throw new Error( `only ${got} of ${m.k} shards reachable` );
        const bytes = decode( shards, m.k, m.n, m.size );
        if ( await sha( bytes ) !== m.hash ) throw new Error( 'hash mismatch after decode' );
        const url = URL.createObjectURL( new Blob( [ bytes ], { type: m.type || 'application/octet-stream' } ) );
        const a = Object.assign( document.createElement( 'a' ), { href: url, download: m.name } );
        a.click();
        setTimeout( () => URL.revokeObjectURL( url ), 5000 );
        log( `"${m.name}" reassembled from ${m.k} shards, hash verified`, 'good' );
    } catch ( e ) {
        log( `fetch failed: ${e.message}`, 'bad' );
    }
    state.busy.delete( id ); render();
}

async function repairFile( id ) {
    const m = state.manifests.get( id );
    if ( ! m || state.busy.has( id ) ) return;
    state.busy.add( id ); render();
    try {
        const { shards, got } = await gather( m );
        if ( got < m.k ) throw new Error( `only ${got} of ${m.k} shards reachable` );
        const hold = holdersOf( m.id ), online = roster();
        const covered = new Set();
        for ( const [ p, set ] of hold ) if ( online.includes( p ) ) set.forEach( ( i ) => covered.add( i ) );
        const missing = [ ...Array( m.n ).keys() ].filter( ( i ) => ! covered.has( i ) );
        const spare = online.filter( ( p ) => ! [ ...hold ].some( ( [ q, set ] ) => q === p && set.size ) );
        let fixed = 0;
        for ( const i of missing ) {
            const target = spare.shift();
            if ( ! target ) break;
            const bytes = rebuild( shards, m.k, m.n, i );
            if ( target === state.net.id ) await state.store.putShard( m.id, i, bytes );
            else state.net.send( 'shard', bytes, { target, metadata: { id: m.id, index: i } } );
            fixed++;
        }
        await broadcastHave();
        log( fixed ? `rebuilt ${fixed} missing shard${fixed > 1 ? 's' : ''} of "${m.name}" onto spare peers` : `no spare peer to take "${m.name}" shards`, fixed ? 'good' : 'warn' );
    } catch ( e ) {
        log( `repair failed: ${e.message}`, 'bad' );
    }
    state.busy.delete( id ); render();
}

async function forgetFile( id ) {
    const m = state.manifests.get( id );
    state.net.send( 'forget', { id } );
    state.manifests.delete( id );
    state.holders.delete( id );
    await state.store.removeFile( id );
    log( `"${m?.name}" forgotten everywhere`, 'warn' );
    render();
}

function render() {
    const net = state.net;
    if ( ! net ) return;
    const peers = roster();
    const counts = {};
    for ( const hold of state.holders.values() ) for ( const [ p, set ] of hold ) counts[ p ] = ( counts[ p ] || 0 ) + set.size;
    $( '#peer-count' ).textContent = peers.length;
    $( '#peers' ).innerHTML = peers.map( ( id ) => {
        const p = net.peers.get( id );
        const via = id === net.id ? 'you' : [ p?.local && 'local', p?.relay && 'relay' ].filter( Boolean ).join( ' + ' );
        return `<div class="peer${id === net.id ? ' self' : ''}" style="--c:${colorOf( id )}"><span class="dot"></span><b>${short( id )}</b><span class="via">${via}</span><span class="n">${counts[ id ] || 0} shard${counts[ id ] === 1 ? '' : 's'}</span></div>`;
    } ).join( '' );

    const tol = $( '#tolerate' );
    tol.max = Math.max( 0, peers.length - 1 );
    if ( ! tol.dataset.touched ) tol.value = Math.floor( peers.length / 2 );
    if ( +tol.value > +tol.max ) tol.value = tol.max;
    const lose = +tol.value, k = peers.length - lose;
    $( '#scheme' ).textContent = peers.length === 1 ? 'alone: 1 of 1, nothing is distributed yet' : `${k} of ${peers.length} shards rebuild the file; survives ${lose} peer${lose === 1 ? '' : 's'} vanishing`;

    const files = [ ...state.manifests.values() ].sort( ( a, b ) => b.added - a.added );
    $( '#file-count' ).textContent = files.length;
    $( '#files' ).innerHTML = files.length ? files.map( ( m ) => {
        const hold = holdersOf( m.id );
        const owner = [];
        for ( let i = 0; i < m.n; i++ ) owner[ i ] = [ ...hold ].find( ( [ p, set ] ) => set.has( i ) && peers.includes( p ) )?.[ 0 ] || null;
        const online = owner.filter( Boolean ).length;
        const ok = online >= m.k;
        const missing = m.n - online;
        const busy = state.busy.has( m.id );
        const cells = owner.map( ( p, i ) => `<span class="cell${p ? ' on' : ''}" style="--c:${p ? colorOf( p ) : 'transparent'}" title="shard ${i + 1}: ${p ? ( p === net.id ? 'you' : short( p ) ) : 'no online holder'}"></span>` ).join( '' );
        return `<article class="file${ok ? '' : ' lost'}" data-id="${m.id}">
            <header><b title="${esc( m.name )}">${esc( m.name )}</b><span class="meta">${fmt( m.size )} &middot; ${m.k} of ${m.n}</span></header>
            <div class="grid" style="--k:${m.k};--n:${m.n}">${cells}<i class="kmark" style="left:calc(${m.k} * (100% / ${m.n}))"></i></div>
            <footer>
                <span class="status">${ok ? `${online}/${m.n} online, recoverable` : `${online}/${m.n} online, need ${m.k}: unrecoverable`}${missing && ok ? `, ${missing} missing` : ''}</span>
                <span class="actions">
                    <button data-act="fetch" ${ok && ! busy ? '' : 'disabled'}>${busy ? 'working' : 'fetch'}</button>
                    <button data-act="repair" ${ok && missing && ! busy ? '' : 'disabled'}>repair</button>
                    <button data-act="forget" ${busy ? 'disabled' : ''}>forget</button>
                </span>
            </footer>
        </article>`;
    } ).join( '' ) : '<p class="empty">Nothing stored. Drop a file here and it is split across every peer in the vault; no shard ever touches a server.</p>';
}

$( '#files' ).addEventListener( 'click', ( e ) => {
    const b = e.target.closest( 'button[data-act]' );
    if ( ! b ) return;
    const id = b.closest( '.file' ).dataset.id;
    ( { fetch: fetchFile, repair: repairFile, forget: forgetFile } )[ b.dataset.act ]( id );
} );
$( '#tolerate' ).addEventListener( 'input', ( e ) => { e.target.dataset.touched = '1'; render(); } );
$( '#pick' ).addEventListener( 'change', ( e ) => { [ ...e.target.files ].forEach( addFile ); e.target.value = ''; } );
const drop = $( '#drop' );
drop.addEventListener( 'dragover', ( e ) => { e.preventDefault(); drop.classList.add( 'over' ); } );
drop.addEventListener( 'dragleave', () => drop.classList.remove( 'over' ) );
drop.addEventListener( 'drop', ( e ) => { e.preventDefault(); drop.classList.remove( 'over' ); [ ...e.dataTransfer.files ].forEach( addFile ); } );
$( '#join' ).addEventListener( 'click', () => { const v = $( '#vault' ).value.trim(); if ( v ) join( v ); } );
$( '#vault' ).addEventListener( 'keydown', ( e ) => { if ( e.key === 'Enter' ) $( '#join' ).click(); } );
$( '#new-vault' ).addEventListener( 'click', () => join( randomVault() ) );
$( '#spawn' ).addEventListener( 'click', () => window.open( location.href, '_blank' ) );

join( decodeURIComponent( location.hash.slice( 1 ) ) || randomVault() );
window.__scatter = state;
