const CACHE = "waymarker-v1";
const ASSETS = [
    "./",
    "index.html",
    "css/styles.css",
    "js/main.js",
    "js/render.js",
    "js/geomath.js",
    "js/geo.js",
    "js/orientation.js",
    "js/geomag.js",
    "js/camera.js",
    "js/haptics.js",
    "js/astro.js",
    "data/peaks.json",
    "manifest.webmanifest",
    "favicon.svg",
    "icon-192.png",
    "icon-512.png",
    "apple-touch-icon.png"
];

self.addEventListener( "install", ( e ) => {
    e.waitUntil( caches.open( CACHE ).then( ( c ) => c.addAll( ASSETS ) ).then( () => self.skipWaiting() ) );
} );

self.addEventListener( "activate", ( e ) => {
    e.waitUntil(
        caches.keys()
            .then( ( keys ) => Promise.all( keys.filter( ( k ) => k !== CACHE ).map( ( k ) => caches.delete( k ) ) ) )
            .then( () => self.clients.claim() )
    );
} );

// Network-first: always fresh when online (and refresh the cache), fall back to
// the cache offline, and to the app shell for offline navigations. Avoids the
// stale-asset trap of cache-first while still working with no signal.
self.addEventListener( "fetch", ( e ) => {
    if ( e.request.method !== "GET" ) {
        return;
    }
    e.respondWith(
        fetch( e.request ).then( ( resp ) => {
            const url = new URL( e.request.url );
            if ( url.origin === self.location.origin && !url.search && resp.ok ) {
                const copy = resp.clone();
                caches.open( CACHE ).then( ( c ) => c.put( e.request, copy ) );
            }
            return resp;
        } ).catch( () => caches.match( e.request ).then( ( hit ) => hit || caches.match( "index.html" ) ) )
    );
} );
