const CACHE = "cosmos-v1";
const ASSETS = [ "./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png" ];

self.addEventListener( "install", function( e ) {
    e.waitUntil(
        caches.open( CACHE ).then( function( c ) { return c.addAll( ASSETS ); } ).then( function() {
            return self.skipWaiting();
        } )
    );
} );

self.addEventListener( "activate", function( e ) {
    e.waitUntil(
        caches.keys().then( function( keys ) {
            return Promise.all( keys.map( function( k ) {
                return k === CACHE ? null : caches.delete( k );
            } ) );
        } ).then( function() { return self.clients.claim(); } )
    );
} );

self.addEventListener( "fetch", function( e ) {
    if ( e.request.method !== "GET" ) { return; }
    e.respondWith(
        caches.match( e.request ).then( function( hit ) {
            if ( hit ) { return hit; }
            return fetch( e.request ).then( function( resp ) {
                if ( resp.ok && new URL( e.request.url ).origin === location.origin ) {
                    const copy = resp.clone();
                    caches.open( CACHE ).then( function( c ) { c.put( e.request, copy ); } );
                }
                return resp;
            } );
        } )
    );
} );
