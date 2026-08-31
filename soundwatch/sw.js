var SHELL_CACHE = 'soundwatch-shell-v6';
var TILE_CACHE = 'soundwatch-tiles-v1';
var TILE_LIMIT = 500;

var SHELL = [
    './',
    'index.html',
    'style.css',
    'app.js',
    'manifest.webmanifest',
    'og-image.png',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener( 'install', function( e ) {
    e.waitUntil(
        caches.open( SHELL_CACHE ).then( function( cache ) {
            return cache.addAll( SHELL );
        } ).then( function() {
            return self.skipWaiting();
        } )
    );
} );

self.addEventListener( 'activate', function( e ) {
    e.waitUntil(
        caches.keys().then( function( keys ) {
            return Promise.all( keys.filter( function( k ) {
                return k !== SHELL_CACHE && k !== TILE_CACHE;
            } ).map( function( k ) {
                return caches.delete( k );
            } ) );
        } ).then( function() {
            return self.clients.claim();
        } )
    );
} );

function trimCache( name, limit ) {
    caches.open( name ).then( function( cache ) {
        cache.keys().then( function( keys ) {
            if ( keys.length > limit ) {
                cache.delete( keys[0] ).then( function() {
                    trimCache( name, limit );
                } );
            }
        } );
    } );
}

self.addEventListener( 'fetch', function( e ) {
    var url = new URL( e.request.url );
    if ( e.request.method !== 'GET' ) return;
    if ( url.hostname.indexOf( 'acartia.io' ) !== -1 ) return;

    if ( url.hostname.indexOf( 'openstreetmap.org' ) !== -1 ) {
        e.respondWith(
            caches.open( TILE_CACHE ).then( function( cache ) {
                return cache.match( e.request ).then( function( hit ) {
                    var net = fetch( e.request ).then( function( res ) {
                        if ( res.ok ) {
                            cache.put( e.request, res.clone() );
                            trimCache( TILE_CACHE, TILE_LIMIT );
                        }
                        return res;
                    } ).catch( function() {
                        return hit;
                    } );
                    return hit || net;
                } );
            } )
        );
        return;
    }

    e.respondWith(
        caches.match( e.request, { ignoreSearch: true } ).then( function( hit ) {
            return hit || fetch( e.request ).then( function( res ) {
                if ( res.ok && ( url.origin === location.origin || url.hostname === 'unpkg.com' ) ) {
                    var copy = res.clone();
                    caches.open( SHELL_CACHE ).then( function( cache ) {
                        cache.put( e.request, copy );
                    } );
                }
                return res;
            } );
        } )
    );
} );
