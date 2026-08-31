(function() {
    'use strict';

    var API_CURRENT = 'https://acartia.io/api/v1/sightings/current';
    var API_TRUSTED = 'https://acartia.io/api/v1/sightings/trusted';
    var BOUNDS = { latMin: 46.9, latMax: 49.7, lngMin: -125.3, lngMax: -121.9 };
    var SYNC_KEY = 'soundwatch.lastSync';
    var PREFS_KEY = 'soundwatch.prefs';
    var LEGACY_KEY = 'soundwatch.sightings';
    var SEED_KEY = 'soundwatch.tilesSeeded.v1';
    var MAX_RECORDS = 20000;
    var SYNC_INTERVAL = 5 * 60 * 1000;
    var TRACK_RULES = { maxGapMs: 12 * 3600000, maxKmh: 20, minSegKm: 0.15 };
    var TILE_ZOOMS = [7, 8, 9, 10];
    var TILE_SEED_CAP = 320;

    var GROUPS = {
        Orca: { color: '#0e8f81', match: /orca|killer|srkw|biggs|transient/i },
        Humpback: { color: '#2f86d4', match: /humpback/i },
        Gray: { color: '#7c5cd6', match: /gray|grey/i },
        Minke: { color: '#d68f00', match: /minke|fin whale|sei/i },
        Porpoise: { color: '#d64f6e', match: /porpoise|dolphin/i },
        Other: { color: '#5b83a6', match: /./ }
    };

    var state = {
        sightings: {},
        activeGroups: {},
        rangeDays: 7,
        showTracks: true,
        alertKm: 0,
        token: '',
        playhead: null,
        playing: null,
        pos: null,
        posMarker: null,
        map: null,
        layer: null,
        trackLayer: null,
        markers: {},
        trackOf: {},
        trackShapes: [],
        highlight: null
    };

    Object.keys( GROUPS ).forEach( function( g ) { state.activeGroups[g] = true; } );

    /* ---------- storage ---------- */

    var db = null;

    function idbOpen() {
        return new Promise( function( resolve, reject ) {
            var req = indexedDB.open( 'soundwatch', 1 );
            req.onupgradeneeded = function() {
                req.result.createObjectStore( 'sightings', { keyPath: 'id' } );
            };
            req.onsuccess = function() { resolve( req.result ); };
            req.onerror = function() { reject( req.error ); };
        } );
    }

    function idbAll() {
        return new Promise( function( resolve ) {
            var out = {};
            var tx = db.transaction( 'sightings', 'readonly' );
            tx.objectStore( 'sightings' ).openCursor().onsuccess = function( e ) {
                var cur = e.target.result;
                if ( cur ) {
                    out[cur.value.id] = cur.value;
                    cur.continue();
                } else {
                    resolve( out );
                }
            };
            tx.onerror = function() { resolve( out ); };
        } );
    }

    function idbPutMany( items ) {
        return new Promise( function( resolve ) {
            var tx = db.transaction( 'sightings', 'readwrite' );
            var store = tx.objectStore( 'sightings' );
            items.forEach( function( s ) { store.put( s ); } );
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        } );
    }

    function idbDeleteMany( ids ) {
        return new Promise( function( resolve ) {
            var tx = db.transaction( 'sightings', 'readwrite' );
            var store = tx.objectStore( 'sightings' );
            ids.forEach( function( id ) { store.delete( id ); } );
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        } );
    }

    function prune() {
        var ids = Object.keys( state.sightings );
        if ( ids.length <= MAX_RECORDS ) return;
        ids.sort( function( a, b ) { return state.sightings[a].ts - state.sightings[b].ts; } );
        var drop = ids.slice( 0, ids.length - MAX_RECORDS );
        drop.forEach( function( id ) { delete state.sightings[id]; } );
        idbDeleteMany( drop );
    }

    function migrateLegacy() {
        try {
            var old = JSON.parse( localStorage.getItem( LEGACY_KEY ) );
            if ( old ) {
                var items = Object.keys( old ).map( function( id ) { return old[id]; } );
                items.forEach( function( s ) { state.sightings[s.id] = s; } );
                idbPutMany( items ).then( function() {
                    localStorage.removeItem( LEGACY_KEY );
                } );
            }
        } catch ( e ) {}
    }

    function loadPrefs() {
        try {
            var p = JSON.parse( localStorage.getItem( PREFS_KEY ) ) || {};
            if ( p.activeGroups ) {
                Object.keys( GROUPS ).forEach( function( g ) {
                    if ( typeof p.activeGroups[g] === 'boolean' ) state.activeGroups[g] = p.activeGroups[g];
                } );
            }
            if ( typeof p.rangeDays === 'number' || p.rangeDays === 'today' ) state.rangeDays = p.rangeDays;
            if ( typeof p.showTracks === 'boolean' ) state.showTracks = p.showTracks;
            if ( typeof p.alertKm === 'number' ) state.alertKm = p.alertKm;
            if ( typeof p.token === 'string' ) state.token = p.token;
            if ( p.mapView && isFinite( p.mapView.lat ) && isFinite( p.mapView.lng ) && isFinite( p.mapView.zoom ) ) {
                state.mapView = p.mapView;
            }
        } catch ( e ) {}
    }

    function savePrefs() {
        try {
            localStorage.setItem( PREFS_KEY, JSON.stringify( {
                activeGroups: state.activeGroups,
                rangeDays: state.rangeDays,
                showTracks: state.showTracks,
                alertKm: state.alertKm,
                token: state.token,
                mapView: state.mapView
            } ) );
        } catch ( e ) {}
    }

    /* ---------- parsing ---------- */

    function groupOf( type, comments ) {
        var hay = String( type || '' ) + ' ' + String( comments || '' );
        var found = 'Other';
        Object.keys( GROUPS ).some( function( g ) {
            if ( g !== 'Other' && GROUPS[g].match.test( hay ) ) {
                found = g;
                return true;
            }
            return false;
        } );
        return found;
    }

    function extractTag( type, note ) {
        var hay = String( type || '' ) + ' ' + String( note || '' );
        var m = hay.match( /\bT\d{2,3}[A-Z]{0,2}\d?\b/ );
        if ( m ) return m[0];
        m = hay.match( /\b([JKL])\s?-?\s?pod\b/i );
        if ( m ) return m[1].toUpperCase() + ' pod';
        m = hay.match( /\bCRC-?\s?\d+\b/i );
        if ( m ) return m[0].toUpperCase().replace( /[-\s]/g, '' );
        return null;
    }

    function extractVia( note ) {
        var m = String( note || '' ).match( /^\s*\[([^\]]{2,40})\]/ );
        return m ? m[1] : null;
    }

    function normalize( raw ) {
        var lat = Number( raw.latitude );
        var lng = Number( raw.longitude );
        var ts = Date.parse( String( raw.created || '' ).replace( ' ', 'T' ) + 'Z' );
        if ( !isFinite( lat ) || !isFinite( lng ) || !isFinite( ts ) ) return null;
        if ( lat < BOUNDS.latMin || lat > BOUNDS.latMax || lng < BOUNDS.lngMin || lng > BOUNDS.lngMax ) return null;
        var rawNote = String( raw.data_source_comments || '' ).slice( 0, 400 );
        return {
            id: raw.entry_id || raw.ssemmi_id,
            ts: ts,
            lat: lat,
            lng: lng,
            type: raw.type || 'Unspecified',
            group: groupOf( raw.type, rawNote ),
            tag: extractTag( raw.type, rawNote ),
            via: extractVia( rawNote ),
            count: Number( raw.no_sighted ) || 1,
            note: rawNote.replace( /^\s*\[[^\]]*\]\s*/, '' ),
            source: raw.data_source_entity || raw.data_source_name || 'Unknown',
            trusted: raw.trusted === 1
        };
    }

    /* ---------- sync ---------- */

    function apiUrl() {
        return state.token
            ? API_TRUSTED + '?access_token=' + encodeURIComponent( state.token )
            : API_CURRENT;
    }

    function sync() {
        var btn = document.getElementById( 'sync-btn' );
        btn.disabled = true;
        btn.classList.add( 'spinning' );
        setSyncLabel( 'Syncing…' );
        fetch( apiUrl() )
            .then( function( res ) {
                if ( res.status === 401 && state.token ) {
                    setSyncLabel( 'Token rejected, using public feed' );
                    return fetch( API_CURRENT ).then( function( r ) { return r.json(); } );
                }
                if ( !res.ok ) throw new Error( 'HTTP ' + res.status );
                return res.json();
            } )
            .then( function( rows ) {
                var fresh = [];
                ( rows || [] ).forEach( function( raw ) {
                    var s = normalize( raw );
                    if ( s && s.id ) {
                        if ( !state.sightings[s.id] ) fresh.push( s );
                        state.sightings[s.id] = s;
                    }
                } );
                idbPutMany( fresh );
                prune();
                localStorage.setItem( SYNC_KEY, String( Date.now() ) );
                render();
                setSyncLabel( 'Synced ' + timeAgo( Date.now() ) + ( fresh.length ? ', +' + fresh.length + ' new' : '' ) );
                notifyNearby( fresh );
                seedTiles();
            } )
            .catch( function( err ) {
                setSyncLabel( navigator.onLine ? 'Sync failed: ' + err.message : 'Offline, showing cached data' );
            } )
            .then( function() {
                btn.disabled = false;
                btn.classList.remove( 'spinning' );
            } );
    }

    function setSyncLabel( text ) {
        document.getElementById( 'sync-label' ).textContent = text;
    }

    function refreshSyncLabel() {
        var last = Number( localStorage.getItem( SYNC_KEY ) );
        setSyncLabel( last ? 'Synced ' + timeAgo( last ) : 'Never synced' );
    }

    function timeAgo( ts ) {
        var s = Math.max( 0, ( Date.now() - ts ) / 1000 );
        if ( s < 60 ) return 'just now';
        if ( s < 3600 ) return Math.floor( s / 60 ) + 'm ago';
        if ( s < 86400 ) return Math.floor( s / 3600 ) + 'h ago';
        return Math.floor( s / 86400 ) + 'd ago';
    }

    /* ---------- geometry ---------- */

    function distKm( a, b ) {
        var rad = Math.PI / 180;
        var dLat = ( b.lat - a.lat ) * rad;
        var dLng = ( b.lng - a.lng ) * rad;
        var h = Math.sin( dLat / 2 ) * Math.sin( dLat / 2 ) +
            Math.cos( a.lat * rad ) * Math.cos( b.lat * rad ) *
            Math.sin( dLng / 2 ) * Math.sin( dLng / 2 );
        return 12742 * Math.asin( Math.sqrt( h ) );
    }

    function bearingDeg( a, b ) {
        var rad = Math.PI / 180;
        var dLng = ( b.lng - a.lng ) * rad;
        var y = Math.sin( dLng ) * Math.cos( b.lat * rad );
        var x = Math.cos( a.lat * rad ) * Math.sin( b.lat * rad ) -
            Math.sin( a.lat * rad ) * Math.cos( b.lat * rad ) * Math.cos( dLng );
        return ( Math.atan2( y, x ) * 180 / Math.PI + 360 ) % 360;
    }

    /* ---------- tracks (ID-tagged animals only) ---------- */

    function buildTracks( list ) {
        var byTag = {};
        list.forEach( function( s ) {
            if ( !s.tag ) return;
            ( byTag[s.tag] = byTag[s.tag] || [] ).push( s );
        } );

        var tracks = [];
        Object.keys( byTag ).forEach( function( tag ) {
            var pts = byTag[tag].slice().sort( function( a, b ) { return a.ts - b.ts; } );
            var run = [pts[0]];
            for ( var i = 1; i < pts.length; i++ ) {
                var prev = run[run.length - 1];
                var gapH = ( pts[i].ts - prev.ts ) / 3600000;
                var km = distKm( prev, pts[i] );
                if ( gapH <= TRACK_RULES.maxGapMs / 3600000 && ( gapH === 0 || km / gapH <= TRACK_RULES.maxKmh ) ) {
                    if ( km >= TRACK_RULES.minSegKm ) run.push( pts[i] );
                } else {
                    if ( run.length > 1 ) tracks.push( { key: tag, pts: run, group: run[0].group } );
                    run = [pts[i]];
                }
            }
            if ( run.length > 1 ) tracks.push( { key: tag, pts: run, group: run[0].group } );
        } );
        return tracks;
    }

    /* ---------- rendering ---------- */

    function filtered() {
        var cutoff = 0;
        if ( state.rangeDays === 'today' ) cutoff = new Date().setHours( 0, 0, 0, 0 );
        else if ( state.rangeDays ) cutoff = Date.now() - state.rangeDays * 86400000;
        return Object.keys( state.sightings )
            .map( function( id ) { return state.sightings[id]; } )
            .filter( function( s ) { return s.ts >= cutoff && state.activeGroups[s.group]; } )
            .sort( function( a, b ) { return b.ts - a.ts; } );
    }

    function visible() {
        var list = filtered();
        if ( state.playhead ) {
            list = list.filter( function( s ) { return s.ts <= state.playhead; } );
        }
        return list;
    }

    function timeDomain() {
        var list = filtered();
        if ( !list.length ) return null;
        return { min: list[list.length - 1].ts, max: list[0].ts };
    }

    function pinIcon( color, dx, dy ) {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">' +
            '<circle cx="9" cy="9" r="6.5" fill="' + color + '" stroke="#ffffff" stroke-width="2.5"/></svg>';
        return L.divIcon( {
            className: 'pin',
            html: svg,
            iconSize: [18, 18],
            iconAnchor: [9 - ( dx || 0 ), 9 - ( dy || 0 )]
        } );
    }

    function arrowIcon( color, deg ) {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"' +
            ' style="transform:rotate(' + deg.toFixed( 0 ) + 'deg)">' +
            '<path d="M8 1.5 L13 13 L8 10 L3 13 Z" fill="' + color + '" stroke="#ffffff" stroke-width="1.2"/></svg>';
        return L.divIcon( { className: 'pin', html: svg, iconSize: [16, 16], iconAnchor: [8, 8] } );
    }

    function spiralOffsets( list ) {
        var cells = {};
        var offsets = {};
        list.forEach( function( s ) {
            var cell = s.lat.toFixed( 3 ) + ',' + s.lng.toFixed( 3 );
            var i = cells[cell] = ( cells[cell] || 0 );
            cells[cell]++;
            if ( i === 0 ) {
                offsets[s.id] = [0, 0];
            } else {
                var a = i * 2.4;
                var r = 7 + 3.5 * Math.sqrt( i );
                offsets[s.id] = [Math.round( r * Math.cos( a ) ), Math.round( r * Math.sin( a ) )];
            }
        } );
        return offsets;
    }

    function esc( text ) {
        var div = document.createElement( 'div' );
        div.textContent = text;
        return div.innerHTML;
    }

    function renderTracks( tracks ) {
        state.trackLayer.clearLayers();
        state.trackShapes = [];
        if ( !state.showTracks ) return;
        tracks.forEach( function( t, idx ) {
            var color = GROUPS[t.group].color;
            var latlngs = t.pts.map( function( p ) { return [p.lat, p.lng]; } );
            var shape = { lines: [], arrows: [] };
            shape.lines.push( L.polyline( latlngs, { color: '#0b1522', dashArray: '6 6', opacity: 0.9, weight: 5 } )
                .addTo( state.trackLayer ) );
            shape.lines.push( L.polyline( latlngs, { color: color, dashArray: '6 6', opacity: 0.9, weight: 2 } )
                .bindTooltip( esc( t.key ) + ', ' + t.pts.length + ' sightings, ' +
                    timeAgo( t.pts[0].ts ) + ' to ' + timeAgo( t.pts[t.pts.length - 1].ts ) )
                .addTo( state.trackLayer ) );
            for ( var i = 1; i < t.pts.length; i++ ) {
                var a = t.pts[i - 1];
                var b = t.pts[i];
                if ( distKm( a, b ) < 1 ) continue;
                shape.arrows.push( L.marker( [( a.lat + b.lat ) / 2, ( a.lng + b.lng ) / 2], {
                    icon: arrowIcon( color, bearingDeg( a, b ) ),
                    interactive: false
                } ).addTo( state.trackLayer ) );
            }
            state.trackShapes[idx] = shape;
        } );
    }

    function applyHighlight() {
        var hi = state.highlight;
        Object.keys( state.markers ).forEach( function( id ) {
            var dim = hi !== null && state.trackOf[id] !== hi;
            state.markers[id].setOpacity( dim ? 0.35 : 1 );
        } );
        state.trackShapes.forEach( function( shape, idx ) {
            var dim = hi !== null && idx !== hi;
            shape.lines.forEach( function( l ) { l.setStyle( { opacity: dim ? 0.3 : 0.9 } ); } );
            shape.arrows.forEach( function( a ) { a.setOpacity( dim ? 0.35 : 1 ); } );
        } );
    }

    function setHighlight( id ) {
        var idx = state.trackOf[id];
        state.highlight = typeof idx === 'number' ? idx : null;
        applyHighlight();
    }

    function render() {
        var list = visible();
        var feed = document.getElementById( 'feed' );
        var frag = document.createDocumentFragment();

        state.layer.clearLayers();
        state.markers = {};
        state.trackOf = {};
        state.highlight = null;

        var tracks = state.showTracks ? buildTracks( list ) : [];
        tracks.forEach( function( t, idx ) {
            t.pts.forEach( function( p ) { state.trackOf[p.id] = idx; } );
        } );

        var offsets = spiralOffsets( list );

        list.forEach( function( s ) {
            var off = offsets[s.id] || [0, 0];
            var viaLine = s.via ? '<br><em>via ' + esc( s.via ) + '</em>' : '';
            var m = L.marker( [s.lat, s.lng], { icon: pinIcon( GROUPS[s.group].color, off[0], off[1] ) } )
                .bindPopup( '<strong>' + esc( s.type ) + '</strong> ×' + s.count + '<br>' +
                    new Date( s.ts ).toLocaleString() + ( s.note ? '<br>' + esc( s.note ) : '' ) + viaLine );
            m.on( 'click', function() { setHighlight( s.id ); } );
            state.layer.addLayer( m );
            state.markers[s.id] = m;

            var li = document.createElement( 'li' );
            li.style.borderLeftColor = GROUPS[s.group].color;
            li.innerHTML = '<div class="row"><span class="species">' + esc( s.type ) +
                ( s.count > 1 ? ' ×' + s.count : '' ) + '</span><span class="when">' + timeAgo( s.ts ) +
                '</span></div>' + ( s.note ? '<p class="note">' + esc( s.note ) + '</p>' : '' ) +
                ( s.via ? '<p class="via">via ' + esc( s.via ) + '</p>' : '' );
            li.addEventListener( 'click', function() {
                state.map.setView( [s.lat, s.lng], Math.max( state.map.getZoom(), 10 ) );
                m.openPopup();
                setHighlight( s.id );
            } );
            frag.appendChild( li );
        } );

        renderTracks( tracks );

        feed.innerHTML = '';
        feed.appendChild( frag );
        document.getElementById( 'empty' ).hidden = list.length > 0;
        document.getElementById( 'count-line' ).textContent =
            list.length + ' sightings shown, ' + Object.keys( state.sightings ).length + ' cached locally';
    }

    /* ---------- alerts ---------- */

    function watchPosition() {
        if ( !navigator.geolocation ) return;
        navigator.geolocation.watchPosition( function( p ) {
            state.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
            if ( state.posMarker ) {
                state.posMarker.setLatLng( [state.pos.lat, state.pos.lng] );
            } else {
                state.posMarker = L.circleMarker( [state.pos.lat, state.pos.lng], {
                    color: '#0b1522', fillColor: '#ffffff', fillOpacity: 1, radius: 6, weight: 2
                } ).bindTooltip( 'You are here' ).addTo( state.map );
            }
        }, function() {}, { enableHighAccuracy: false, maximumAge: 60000 } );
    }

    function notifyNearby( fresh ) {
        if ( !state.alertKm || !state.pos || !fresh.length ) return;
        if ( !( 'Notification' in window ) || Notification.permission !== 'granted' ) return;
        var near = fresh.filter( function( s ) {
            return distKm( state.pos, s ) <= state.alertKm;
        } ).sort( function( a, b ) { return distKm( state.pos, a ) - distKm( state.pos, b ); } );
        if ( !near.length ) return;
        var top = near[0];
        var body = top.type + ' ' + distKm( state.pos, top ).toFixed( 1 ) + ' km away' +
            ( near.length > 1 ? ', +' + ( near.length - 1 ) + ' more nearby' : '' );
        new Notification( 'Whale sighting nearby', { body: body } );
    }

    function setAlertKm( km ) {
        state.alertKm = km;
        savePrefs();
        if ( km > 0 ) {
            if ( 'Notification' in window && Notification.permission === 'default' ) {
                Notification.requestPermission();
            }
            watchPosition();
        }
    }

    /* ---------- time scrubber ---------- */

    function setPlayhead( pct ) {
        var d = timeDomain();
        state.playhead = ( !d || pct >= 100 ) ? null : d.min + ( d.max - d.min ) * pct / 100;
        document.getElementById( 'scrub-label' ).textContent = state.playhead
            ? 'Through ' + new Date( state.playhead ).toLocaleString()
            : 'All sightings';
        render();
    }

    function togglePlay() {
        var btn = document.getElementById( 'play-btn' );
        var slider = document.getElementById( 'scrub' );
        if ( state.playing ) {
            clearInterval( state.playing );
            state.playing = null;
            btn.classList.remove( 'playing' );
            return;
        }
        if ( Number( slider.value ) >= 100 ) slider.value = 0;
        btn.classList.add( 'playing' );
        state.playing = setInterval( function() {
            var v = Number( slider.value ) + 1;
            slider.value = v;
            setPlayhead( v );
            if ( v >= 100 ) togglePlay();
        }, 150 );
    }

    /* ---------- tile pre-seeding ---------- */

    function tileRange( z ) {
        var n = Math.pow( 2, z );
        var rad = Math.PI / 180;
        function tx( lng ) { return Math.floor( ( lng + 180 ) / 360 * n ); }
        function ty( lat ) {
            return Math.floor( ( 1 - Math.log( Math.tan( lat * rad ) + 1 / Math.cos( lat * rad ) ) / Math.PI ) / 2 * n );
        }
        return {
            x0: tx( BOUNDS.lngMin ), x1: tx( BOUNDS.lngMax ),
            y0: ty( BOUNDS.latMax ), y1: ty( BOUNDS.latMin )
        };
    }

    function seedTiles() {
        if ( localStorage.getItem( SEED_KEY ) ) return;
        if ( !navigator.onLine || !navigator.serviceWorker || !navigator.serviceWorker.controller ) return;
        var urls = [];
        TILE_ZOOMS.forEach( function( z ) {
            var r = tileRange( z );
            for ( var x = r.x0; x <= r.x1; x++ ) {
                for ( var y = r.y0; y <= r.y1; y++ ) {
                    urls.push( 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png' );
                }
            }
        } );
        urls = urls.slice( 0, TILE_SEED_CAP );
        var i = 0;
        function next() {
            if ( i >= urls.length ) {
                localStorage.setItem( SEED_KEY, String( Date.now() ) );
                return;
            }
            var batch = urls.slice( i, i + 4 );
            i += 4;
            Promise.all( batch.map( function( u ) {
                return fetch( u ).catch( function() {} );
            } ) ).then( function() {
                setTimeout( next, 250 );
            } );
        }
        next();
    }

    /* ---------- misc ---------- */

    function netStatus() {
        document.getElementById( 'net-dot' ).classList.toggle( 'online', navigator.onLine );
    }

    function measureTimeBar() {
        var bar = document.querySelector( '.time-bar' );
        if ( !bar.hidden ) {
            document.documentElement.style.setProperty( '--timebar-h', bar.offsetHeight + 'px' );
        }
        document.documentElement.style.setProperty( '--brand-h',
            document.querySelector( '.brand-card' ).offsetHeight + 'px' );
    }

    function initTimeline() {
        var btn = document.getElementById( 'timeline-btn' );
        var bar = document.querySelector( '.time-bar' );
        btn.addEventListener( 'click', function() {
            bar.hidden = !bar.hidden;
            btn.classList.toggle( 'open', !bar.hidden );
            document.body.classList.toggle( 'timeline-open', !bar.hidden );
            if ( bar.hidden ) {
                if ( state.playing ) togglePlay();
                document.getElementById( 'scrub' ).value = 100;
                setPlayhead( 100 );
            } else {
                measureTimeBar();
            }
        } );
        window.addEventListener( 'resize', measureTimeBar );
    }

    function initPanels() {
        var buttons = document.querySelectorAll( '.icon-btn[data-panel]' );
        var panels = document.querySelectorAll( '.panel-glass[data-panel]' );
        function close( name ) {
            panels.forEach( function( p ) { if ( p.dataset.panel === name ) p.hidden = true; } );
            buttons.forEach( function( b ) { if ( b.dataset.panel === name ) b.classList.remove( 'open' ); } );
        }
        buttons.forEach( function( btn ) {
            btn.addEventListener( 'click', function() {
                var name = btn.dataset.panel;
                var opening = btn.classList.contains( 'open' ) === false;
                panels.forEach( function( p ) { p.hidden = true; } );
                buttons.forEach( function( b ) { b.classList.remove( 'open' ); } );
                if ( opening ) {
                    panels.forEach( function( p ) { if ( p.dataset.panel === name ) p.hidden = false; } );
                    btn.classList.add( 'open' );
                }
            } );
        } );
        panels.forEach( function( p ) {
            p.querySelector( '.close-btn' ).addEventListener( 'click', function() {
                close( p.dataset.panel );
            } );
        } );
    }

    function buildChips() {
        var wrap = document.getElementById( 'species-chips' );
        Object.keys( GROUPS ).forEach( function( g ) {
            var chip = document.createElement( 'button' );
            chip.className = state.activeGroups[g] ? 'chip active' : 'chip';
            chip.type = 'button';
            chip.innerHTML = '<span class="swatch" style="background:' + GROUPS[g].color + '"></span>' + g;
            chip.addEventListener( 'click', function() {
                state.activeGroups[g] = !state.activeGroups[g];
                chip.classList.toggle( 'active', state.activeGroups[g] );
                savePrefs();
                render();
            } );
            wrap.appendChild( chip );
        } );
    }

    function init() {
        loadPrefs();
        var v = state.mapView || { lat: 48.1, lng: -122.8, zoom: 8 };
        state.map = L.map( 'map' ).setView( [v.lat, v.lng], v.zoom );
        state.map.on( 'moveend', function() {
            var c = state.map.getCenter();
            state.mapView = { lat: c.lat, lng: c.lng, zoom: state.map.getZoom() };
            savePrefs();
        } );
        L.tileLayer( 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            crossOrigin: 'anonymous',
            maxZoom: 17
        } ).addTo( state.map );
        state.trackLayer = L.layerGroup().addTo( state.map );
        state.layer = L.layerGroup().addTo( state.map );

        var pendingClear;
        state.map.on( 'popupclose', function() {
            pendingClear = setTimeout( function() {
                state.highlight = null;
                applyHighlight();
            }, 50 );
        } );
        state.map.on( 'popupopen', function() {
            clearTimeout( pendingClear );
        } );

        buildChips();
        initPanels();
        initTimeline();
        measureTimeBar();
        var trackBtn = document.getElementById( 'tracks-toggle' );
        trackBtn.classList.toggle( 'active', state.showTracks );
        trackBtn.addEventListener( 'click', function() {
            state.showTracks = !state.showTracks;
            trackBtn.classList.toggle( 'active', state.showTracks );
            savePrefs();
            render();
        } );
        document.getElementById( 'range' ).value = String( state.rangeDays );
        document.getElementById( 'range' ).addEventListener( 'change', function( e ) {
            state.rangeDays = e.target.value === 'today' ? 'today' : Number( e.target.value );
            savePrefs();
            render();
        } );

        document.getElementById( 'scrub' ).addEventListener( 'input', function( e ) {
            setPlayhead( Number( e.target.value ) );
        } );
        document.getElementById( 'play-btn' ).addEventListener( 'click', togglePlay );

        var alertSel = document.getElementById( 'alert-km' );
        alertSel.value = String( state.alertKm );
        alertSel.addEventListener( 'change', function( e ) {
            setAlertKm( Number( e.target.value ) );
        } );

        var tokenInput = document.getElementById( 'token' );
        tokenInput.value = state.token;
        tokenInput.addEventListener( 'change', function( e ) {
            state.token = e.target.value.trim();
            savePrefs();
        } );

        netStatus();
        refreshSyncLabel();
        document.getElementById( 'sync-btn' ).addEventListener( 'click', sync );
        window.addEventListener( 'online', function() { netStatus(); sync(); } );
        window.addEventListener( 'offline', netStatus );

        if ( navigator.storage && navigator.storage.persist ) {
            navigator.storage.persist();
        }
        if ( state.alertKm > 0 ) watchPosition();

        idbOpen().then( function( d ) {
            db = d;
            return idbAll();
        } ).then( function( all ) {
            state.sightings = all;
            migrateLegacy();
            render();
            if ( navigator.onLine ) sync();
        } ).catch( function() {
            render();
            if ( navigator.onLine ) sync();
        } );

        setInterval( function() {
            if ( navigator.onLine && !state.playing ) sync();
            else refreshSyncLabel();
        }, SYNC_INTERVAL );

        if ( 'serviceWorker' in navigator && location.protocol.indexOf( 'http' ) === 0 ) {
            navigator.serviceWorker.register( 'sw.js' );
        }
    }

    init();
})();
