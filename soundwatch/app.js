(function() {
    'use strict';

    var API = 'https://acartia.io/api/v1/sightings/current';
    var BOUNDS = { latMin: 46.9, latMax: 49.7, lngMin: -125.3, lngMax: -121.9 };
    var STORE_KEY = 'soundwatch.sightings';
    var SYNC_KEY = 'soundwatch.lastSync';
    var PREFS_KEY = 'soundwatch.prefs';
    var MAX_RECORDS = 5000;
    var SYNC_INTERVAL = 5 * 60 * 1000;
    var TRACK_RULES = { maxGapMs: 12 * 3600000, maxKmh: 20, minSegKm: 0.15 };

    var GROUPS = {
        Orca: { color: '#5eead4', match: /orca|killer|srkw|biggs|transient/i },
        Humpback: { color: '#7dd3fc', match: /humpback/i },
        Gray: { color: '#c4b5fd', match: /gray|grey/i },
        Minke: { color: '#fbbf24', match: /minke|fin whale|sei/i },
        Porpoise: { color: '#fb7185', match: /porpoise|dolphin/i },
        Other: { color: '#8aa2b8', match: /./ }
    };

    var state = {
        sightings: loadStore(),
        activeGroups: {},
        rangeDays: 7,
        showTracks: true,
        map: null,
        layer: null,
        trackLayer: null,
        markers: {},
        trackOf: {},
        trackShapes: [],
        highlight: null
    };

    Object.keys( GROUPS ).forEach( function( g ) { state.activeGroups[g] = true; } );

    function loadPrefs() {
        try {
            var p = JSON.parse( localStorage.getItem( PREFS_KEY ) ) || {};
            if ( p.activeGroups ) {
                Object.keys( GROUPS ).forEach( function( g ) {
                    if ( typeof p.activeGroups[g] === 'boolean' ) state.activeGroups[g] = p.activeGroups[g];
                } );
            }
            if ( typeof p.rangeDays === 'number' ) state.rangeDays = p.rangeDays;
            if ( typeof p.showTracks === 'boolean' ) state.showTracks = p.showTracks;
        } catch ( e ) {}
    }

    function savePrefs() {
        try {
            localStorage.setItem( PREFS_KEY, JSON.stringify( {
                activeGroups: state.activeGroups,
                rangeDays: state.rangeDays,
                showTracks: state.showTracks
            } ) );
        } catch ( e ) {}
    }

    function loadStore() {
        try {
            return JSON.parse( localStorage.getItem( STORE_KEY ) ) || {};
        } catch ( e ) {
            return {};
        }
    }

    function saveStore() {
        var ids = Object.keys( state.sightings );
        if ( ids.length > MAX_RECORDS ) {
            ids.sort( function( a, b ) { return state.sightings[a].ts - state.sightings[b].ts; } );
            ids.slice( 0, ids.length - MAX_RECORDS ).forEach( function( id ) { delete state.sightings[id]; } );
        }
        try {
            localStorage.setItem( STORE_KEY, JSON.stringify( state.sightings ) );
        } catch ( e ) {
            console.warn( 'Storage full, could not persist', e );
        }
    }

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

    function normalize( raw ) {
        var lat = Number( raw.latitude );
        var lng = Number( raw.longitude );
        var ts = Date.parse( String( raw.created || '' ).replace( ' ', 'T' ) + 'Z' );
        if ( !isFinite( lat ) || !isFinite( lng ) || !isFinite( ts ) ) return null;
        if ( lat < BOUNDS.latMin || lat > BOUNDS.latMax || lng < BOUNDS.lngMin || lng > BOUNDS.lngMax ) return null;
        return {
            id: raw.entry_id || raw.ssemmi_id,
            ts: ts,
            lat: lat,
            lng: lng,
            type: raw.type || 'Unspecified',
            group: groupOf( raw.type, raw.data_source_comments ),
            tag: extractTag( raw.type, raw.data_source_comments ),
            count: Number( raw.no_sighted ) || 1,
            note: String( raw.data_source_comments || '' ).slice( 0, 400 ),
            source: raw.data_source_entity || raw.data_source_name || 'Unknown',
            trusted: raw.trusted === 1
        };
    }

    function sync() {
        var btn = document.getElementById( 'sync-btn' );
        btn.disabled = true;
        setSyncLabel( 'Syncing…' );
        fetch( API )
            .then( function( res ) {
                if ( !res.ok ) throw new Error( 'HTTP ' + res.status );
                return res.json();
            } )
            .then( function( rows ) {
                var added = 0;
                ( rows || [] ).forEach( function( raw ) {
                    var s = normalize( raw );
                    if ( s && s.id ) {
                        if ( !state.sightings[s.id] ) added++;
                        state.sightings[s.id] = s;
                    }
                } );
                saveStore();
                localStorage.setItem( SYNC_KEY, String( Date.now() ) );
                render();
                setSyncLabel( 'Synced ' + timeAgo( Date.now() ) + ( added ? ', +' + added + ' new' : '' ) );
            } )
            .catch( function( err ) {
                setSyncLabel( navigator.onLine ? 'Sync failed: ' + err.message : 'Offline, showing cached data' );
            } )
            .then( function() {
                btn.disabled = false;
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

    function visible() {
        var cutoff = state.rangeDays ? Date.now() - state.rangeDays * 86400000 : 0;
        return Object.keys( state.sightings )
            .map( function( id ) { return state.sightings[id]; } )
            .filter( function( s ) { return s.ts >= cutoff && state.activeGroups[s.group]; } )
            .sort( function( a, b ) { return b.ts - a.ts; } );
    }

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

    function buildTracks( list ) {
        var byKey = {};
        list.forEach( function( s ) {
            var key = s.tag || ( s.group !== 'Other' ? s.group : null );
            if ( !key ) return;
            ( byKey[key] = byKey[key] || [] ).push( s );
        } );

        var tracks = [];
        Object.keys( byKey ).forEach( function( key ) {
            var pts = byKey[key].slice().sort( function( a, b ) { return a.ts - b.ts; } );
            var run = [pts[0]];
            for ( var i = 1; i < pts.length; i++ ) {
                var prev = run[run.length - 1];
                var gapH = ( pts[i].ts - prev.ts ) / 3600000;
                var km = distKm( prev, pts[i] );
                if ( gapH <= TRACK_RULES.maxGapMs / 3600000 && ( gapH === 0 || km / gapH <= TRACK_RULES.maxKmh ) ) {
                    if ( km >= TRACK_RULES.minSegKm ) run.push( pts[i] );
                } else {
                    if ( run.length > 1 ) tracks.push( { key: key, pts: run, group: run[0].group } );
                    run = [pts[i]];
                }
            }
            if ( run.length > 1 ) tracks.push( { key: key, pts: run, group: run[0].group } );
        } );
        return tracks;
    }

    function arrowIcon( color, deg ) {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"' +
            ' style="transform:rotate(' + deg.toFixed( 0 ) + 'deg)">' +
            '<path d="M8 1.5 L13 13 L8 10 L3 13 Z" fill="' + color + '" stroke="#0b1522" stroke-width="1"/></svg>';
        return L.divIcon( { className: 'pin', html: svg, iconSize: [16, 16], iconAnchor: [8, 8] } );
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

    function pinIcon( color ) {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">' +
            '<circle cx="9" cy="9" r="6.5" fill="' + color + '" stroke="#0b1522" stroke-width="2"/></svg>';
        return L.divIcon( { className: 'pin', html: svg, iconSize: [18, 18], iconAnchor: [9, 9] } );
    }

    function esc( text ) {
        var div = document.createElement( 'div' );
        div.textContent = text;
        return div.innerHTML;
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

        list.forEach( function( s ) {
            var m = L.marker( [s.lat, s.lng], { icon: pinIcon( GROUPS[s.group].color ) } )
                .bindPopup( '<strong>' + esc( s.type ) + '</strong> ×' + s.count + '<br>' +
                    new Date( s.ts ).toLocaleString() + ( s.note ? '<br>' + esc( s.note ) : '' ) );
            m.on( 'click', function() { setHighlight( s.id ); } );
            state.layer.addLayer( m );
            state.markers[s.id] = m;

            var li = document.createElement( 'li' );
            li.style.borderLeftColor = GROUPS[s.group].color;
            li.innerHTML = '<div class="row"><span class="species">' + esc( s.type ) +
                ( s.count > 1 ? ' ×' + s.count : '' ) + '</span><span class="when">' + timeAgo( s.ts ) +
                '</span></div>' + ( s.note ? '<p class="note">' + esc( s.note ) + '</p>' : '' );
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

    function netStatus() {
        document.getElementById( 'net-dot' ).classList.toggle( 'online', navigator.onLine );
    }

    function init() {
        loadPrefs();
        state.map = L.map( 'map' ).setView( [48.1, -122.8], 8 );
        L.tileLayer( 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
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
        var trackBtn = document.getElementById( 'tracks-toggle' );
        trackBtn.classList.toggle( 'active', state.showTracks );
        trackBtn.addEventListener( 'click', function() {
            state.showTracks = !state.showTracks;
            trackBtn.classList.toggle( 'active', state.showTracks );
            savePrefs();
            render();
        } );
        document.getElementById( 'range' ).value = String( state.rangeDays );
        netStatus();
        refreshSyncLabel();
        render();

        document.getElementById( 'sync-btn' ).addEventListener( 'click', sync );
        document.getElementById( 'range' ).addEventListener( 'change', function( e ) {
            state.rangeDays = Number( e.target.value );
            savePrefs();
            render();
        } );
        window.addEventListener( 'online', function() { netStatus(); sync(); } );
        window.addEventListener( 'offline', netStatus );

        if ( navigator.onLine ) sync();
        setInterval( function() {
            if ( navigator.onLine ) sync();
            else refreshSyncLabel();
        }, SYNC_INTERVAL );

        if ( 'serviceWorker' in navigator && location.protocol.indexOf( 'http' ) === 0 ) {
            navigator.serviceWorker.register( 'sw.js' );
        }
    }

    init();
})();
