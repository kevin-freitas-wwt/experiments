( function() {
    "use strict";

    const D2R = Math.PI / 180;
    const PALETTE = [ "#ffb000", "#4fc3f7", "#81c784", "#f06292", "#ba68c8", "#ffd54f", "#4db6ac", "#ff8a65" ];
    const $ = ( id ) => document.getElementById( id );

    /* ---------- store ---------- */

    let items = JSON.parse( localStorage.getItem( "triangulate.items" ) || "[]" );
    let rays = JSON.parse( localStorage.getItem( "triangulate.rays" ) || "[]" );

    function persist() {
        localStorage.setItem( "triangulate.items", JSON.stringify( items ) );
        localStorage.setItem( "triangulate.rays", JSON.stringify( rays ) );
    }

    let idb = null;
    const idbReady = new Promise( ( resolve ) => {
        const req = indexedDB.open( "triangulate-photos", 1 );
        req.onupgradeneeded = () => req.result.createObjectStore( "photos" );
        req.onsuccess = () => { idb = req.result; resolve(); };
        req.onerror = () => resolve();
    } );

    function photoPut( key, blob ) {
        if ( !idb ) return;
        idb.transaction( "photos", "readwrite" ).objectStore( "photos" ).put( blob, key );
    }

    function photoGet( key ) {
        return new Promise( ( resolve ) => {
            if ( !idb ) return resolve( null );
            const req = idb.transaction( "photos" ).objectStore( "photos" ).get( key );
            req.onsuccess = () => resolve( req.result || null );
            req.onerror = () => resolve( null );
        } );
    }

    function photoDel( key ) {
        if ( idb ) idb.transaction( "photos", "readwrite" ).objectStore( "photos" ).delete( key );
    }

    /* ---------- triangulation ----------
       Least-squares point minimizing summed squared perpendicular
       distance to all rays, in a local east/north meter plane. */

    function solveItem( itemRays ) {
        if ( itemRays.length < 2 ) return null;
        const lat0 = itemRays.reduce( ( s, r ) => s + r.lat, 0 ) / itemRays.length;
        const lon0 = itemRays.reduce( ( s, r ) => s + r.lon, 0 ) / itemRays.length;
        const mLat = 111320;
        const mLon = 111320 * Math.cos( lat0 * D2R );
        const pts = itemRays.map( ( r ) => ( {
            x: ( r.lon - lon0 ) * mLon,
            y: ( r.lat - lat0 ) * mLat,
            dx: Math.sin( r.heading * D2R ),
            dy: Math.cos( r.heading * D2R )
        } ) );
        let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
        for ( const p of pts ) {
            const m11 = 1 - p.dx * p.dx, m12 = -p.dx * p.dy, m22 = 1 - p.dy * p.dy;
            a11 += m11; a12 += m12; a22 += m22;
            b1 += m11 * p.x + m12 * p.y;
            b2 += m12 * p.x + m22 * p.y;
        }
        const det = a11 * a22 - a12 * a12;
        if ( Math.abs( det ) < 1e-9 ) return null;
        const x = ( a22 * b1 - a12 * b2 ) / det;
        const y = ( a11 * b2 - a12 * b1 ) / det;
        let rss = 0, rangeSum = 0, behind = 0;
        const alts = [];
        pts.forEach( ( p, i ) => {
            const vx = x - p.x, vy = y - p.y;
            const along = vx * p.dx + vy * p.dy;
            const perp = vx * p.dy - vy * p.dx;
            if ( along < 0 ) behind++;
            rss += perp * perp;
            const range = Math.max( along, 0 );
            rangeSum += range;
            const r = itemRays[ i ];
            if ( r.alt != null && r.pitch != null ) alts.push( r.alt + range * Math.tan( r.pitch * D2R ) );
        } );
        if ( behind > itemRays.length / 2 ) return null;
        const meanRange = rangeSum / pts.length;
        const rms = Math.sqrt( rss / pts.length );
        const headingErr = meanRange * Math.tan( 8 * D2R ) / Math.sqrt( pts.length );
        return {
            lat: lat0 + y / mLat,
            lon: lon0 + x / mLon,
            alt: alts.length ? alts.reduce( ( s, a ) => s + a, 0 ) / alts.length : null,
            err: Math.max( rms, headingErr, 15 ),
            range: meanRange
        };
    }

    /* ---------- map ---------- */

    const map = L.map( "map", { zoomControl: false } ).setView( [ 47.2529, -122.4443 ], 13 );
    L.control.zoom( { position: "bottomright" } ).addTo( map );
    L.tileLayer( "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 20
    } ).addTo( map );

    const overlay = L.layerGroup().addTo( map );

    function itemColor( item ) {
        return PALETTE[ items.indexOf( item ) % PALETTE.length ];
    }

    function fmtFix( f ) {
        let s = `<b>${ f.lat.toFixed( 5 ) }, ${ f.lon.toFixed( 5 ) }</b>\n`;
        s += f.alt != null ? `ALT <b>${ Math.round( f.alt ) } m</b> · ` : "ALT — · ";
        s += `±${ Math.round( f.err ) } m`;
        return s;
    }

    function render() {
        overlay.clearLayers();
        const list = $( "targetList" );
        list.innerHTML = "";
        $( "emptyState" ).hidden = items.length > 0;
        items.forEach( ( item ) => {
            const color = itemColor( item );
            const itemRays = rays.filter( ( r ) => r.itemId === item.id );
            const fix = solveItem( itemRays );

            itemRays.forEach( ( r ) => {
                const len = fix ? Math.max( fix.range * 1.6, 500 ) : 2500;
                const end = destination( r.lat, r.lon, r.heading, len );
                L.circleMarker( [ r.lat, r.lon ], { color: color, fillColor: color, fillOpacity: 1, radius: 4, weight: 1 } ).addTo( overlay );
                L.polyline( [ [ r.lat, r.lon ], end ], { color: color, dashArray: "6 7", opacity: 0.75, weight: 1.5 } ).addTo( overlay );
            } );

            if ( fix ) {
                L.circle( [ fix.lat, fix.lon ], { color: color, fillColor: color, fillOpacity: 0.12, radius: fix.err, weight: 1 } ).addTo( overlay );
                L.marker( [ fix.lat, fix.lon ], { icon: estIcon( color ) } ).addTo( overlay )
                    .bindTooltip( item.name, { direction: "top", offset: [ 0, -14 ] } );
            }

            list.appendChild( targetEl( item, itemRays, fix, color ) );
        } );
    }

    function estIcon( color ) {
        return L.divIcon( {
            className: "est-marker",
            html: `<svg viewBox="0 0 26 26" width="26" height="26"><circle cx="13" cy="13" r="8" fill="none" stroke="${ color }" stroke-width="1.5"/><circle cx="13" cy="13" r="2" fill="${ color }"/><path d="M13 0v6M13 20v6M0 13h6M20 13h6" stroke="${ color }" stroke-width="1.5"/></svg>`,
            iconAnchor: [ 13, 13 ],
            iconSize: [ 26, 26 ]
        } );
    }

    function destination( lat, lon, headingDeg, meters ) {
        const dLat = meters * Math.cos( headingDeg * D2R ) / 111320;
        const dLon = meters * Math.sin( headingDeg * D2R ) / ( 111320 * Math.cos( lat * D2R ) );
        return [ lat + dLat, lon + dLon ];
    }

    function targetEl( item, itemRays, fix, color ) {
        const el = document.createElement( "div" );
        el.className = "target";
        const fixHtml = fix ? fmtFix( fix )
            : `<span class="nofix">${ itemRays.length < 2 ? "Needs " + ( 2 - itemRays.length ) + " more ray" + ( itemRays.length === 1 ? "" : "s" ) : "Rays don't converge — sight from another angle" }</span>`;
        el.innerHTML = `
            <div class="target-row">
                <span class="target-dot" style="background:${ color }"></span>
                <span class="target-name">${ esc( item.name ) }</span>
                <span class="target-rays">${ itemRays.length } RAY${ itemRays.length === 1 ? "" : "S" }</span>
            </div>
            <div class="target-fix">${ fixHtml }</div>`;
        el.querySelector( ".target-row" ).addEventListener( "click", () => {
            if ( fix ) map.setView( [ fix.lat, fix.lon ], Math.max( map.getZoom(), 15 ) );
            else if ( itemRays.length ) map.setView( [ itemRays[ 0 ].lat, itemRays[ 0 ].lon ], Math.max( map.getZoom(), 14 ) );
            toggleDetail( el, item, itemRays );
        } );
        return el;
    }

    async function toggleDetail( el, item, itemRays ) {
        const open = el.querySelector( ".target-detail" );
        if ( open ) { open.remove(); el.querySelector( ".target-del" )?.remove(); return; }
        const detail = document.createElement( "div" );
        detail.className = "target-detail";
        for ( const r of itemRays ) {
            const row = document.createElement( "div" );
            row.className = "ray-row";
            row.innerHTML = `<span>${ new Date( r.ts ).toLocaleString( [], { dateStyle: "short", timeStyle: "short" } ) }</span>
                <span>HDG ${ Math.round( r.heading ) }°</span>
                ${ r.pitch != null ? `<span>${ r.pitch >= 0 ? "+" : "" }${ Math.round( r.pitch ) }°</span>` : "" }
                <button class="ray-del" title="Delete ray">✕</button>`;
            if ( r.photo ) {
                const blob = await photoGet( r.photo );
                if ( blob ) {
                    const img = document.createElement( "img" );
                    img.src = URL.createObjectURL( blob );
                    row.prepend( img );
                }
            }
            row.querySelector( ".ray-del" ).addEventListener( "click", ( e ) => {
                e.stopPropagation();
                if ( r.photo ) photoDel( r.photo );
                rays = rays.filter( ( x ) => x.id !== r.id );
                persist();
                render();
            } );
            detail.appendChild( row );
        }
        const del = document.createElement( "button" );
        del.className = "target-del";
        del.textContent = "DELETE TARGET";
        del.addEventListener( "click", () => {
            rays.filter( ( r ) => r.itemId === item.id ).forEach( ( r ) => r.photo && photoDel( r.photo ) );
            rays = rays.filter( ( r ) => r.itemId !== item.id );
            items = items.filter( ( i ) => i.id !== item.id );
            persist();
            render();
        } );
        el.appendChild( detail );
        el.appendChild( del );
    }

    function esc( s ) {
        return s.replace( /[&<>"]/g, ( c ) => ( { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ c ] ) );
    }

    function addRay( itemId, ray ) {
        rays.push( Object.assign( { id: uid(), itemId: itemId, ts: Date.now() }, ray ) );
        persist();
        render();
    }

    function uid() {
        return Math.random().toString( 36 ).slice( 2, 10 );
    }

    function toast( msg, ms = 2600 ) {
        const t = $( "toast" );
        t.textContent = msg;
        t.hidden = false;
        clearTimeout( toast.tid );
        toast.tid = setTimeout( () => { t.hidden = true; }, ms );
    }

    /* ---------- geolocation ---------- */

    let pos = null;
    if ( "geolocation" in navigator ) {
        navigator.geolocation.watchPosition( ( p ) => {
            const first = !pos;
            pos = p;
            const st = $( "gpsStatus" );
            st.textContent = `GPS ±${ Math.round( p.coords.accuracy ) }m`;
            st.classList.add( "ok" );
            if ( first && !rays.length ) map.setView( [ p.coords.latitude, p.coords.longitude ], 15 );
        }, () => { $( "gpsStatus" ).textContent = "GPS OFF"; }, { enableHighAccuracy: true, maximumAge: 5000 } );
    }

    /* ---------- orientation ---------- */

    let heading = null, pitch = null;

    /* Rays are cast along the rear camera axis (device -z), not the top edge,
       so both heading paths resolve the azimuth of -z in the earth frame. */
    function onOrient( e ) {
        if ( e.webkitCompassHeading != null && e.beta != null && e.gamma != null ) {
            /* webkitCompassHeading tracks the device top edge (+y); shift it by
               the alpha-invariant angle between +y's and -z's azimuths */
            heading = norm360( e.webkitCompassHeading + cameraYawOffset( e.beta, e.gamma ) );
        } else if ( e.absolute && e.alpha != null ) {
            heading = compassHeading( e.alpha, e.beta, e.gamma );
        }
        if ( e.beta != null && e.gamma != null ) pitch = cameraPitch( e.beta, e.gamma );
        $( "roHeading" ).textContent = heading != null ? `HDG ${ String( Math.round( heading ) ).padStart( 3, "0" ) }°` : "HDG ---°";
        $( "roPitch" ).textContent = pitch != null ? `PITCH ${ pitch >= 0 ? "+" : "" }${ Math.round( pitch ) }°` : "PITCH --°";
    }

    /* Azimuth of the rear camera (-z) from absolute alpha/beta/gamma */
    function compassHeading( alpha, beta, gamma ) {
        const x = beta * D2R, y = gamma * D2R, z = alpha * D2R;
        const vx = -Math.cos( z ) * Math.sin( y ) - Math.sin( z ) * Math.sin( x ) * Math.cos( y );
        const vy = -Math.sin( z ) * Math.sin( y ) + Math.cos( z ) * Math.sin( x ) * Math.cos( y );
        let h = Math.atan2( vx, vy ) / D2R;
        return h < 0 ? h + 360 : h;
    }

    /* Azimuth delta between rear camera (-z) and top edge (+y), independent of alpha */
    function cameraYawOffset( beta, gamma ) {
        const b = beta * D2R, g = gamma * D2R;
        const azCam = Math.atan2( -Math.sin( g ), Math.sin( b ) * Math.cos( g ) );
        const azTop = Math.atan2( 0, Math.cos( b ) );
        return ( azCam - azTop ) / D2R;
    }

    /* Elevation of the rear camera axis; +up, accounts for roll */
    function cameraPitch( beta, gamma ) {
        const zUp = -Math.cos( beta * D2R ) * Math.cos( gamma * D2R );
        return clamp( Math.asin( clamp( zUp, -1, 1 ) ) / D2R, -89, 89 );
    }

    function norm360( h ) {
        return ( ( h % 360 ) + 360 ) % 360;
    }

    function clamp( v, lo, hi ) {
        return Math.min( Math.max( v, lo ), hi );
    }

    async function startOrientation() {
        if ( typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission ) {
            try {
                if ( await DeviceOrientationEvent.requestPermission() !== "granted" ) return false;
            } catch { return false; }
            window.addEventListener( "deviceorientation", onOrient );
        } else if ( "ondeviceorientationabsolute" in window ) {
            window.addEventListener( "deviceorientationabsolute", onOrient );
        } else {
            window.addEventListener( "deviceorientation", onOrient );
        }
        return true;
    }

    /* ---------- camera ---------- */

    const video = $( "camVideo" );
    let stream = null, track = null, digitalZoom = 1, activeItem = null;

    const canSight = !!( navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof DeviceOrientationEvent !== "undefined" );
    if ( canSight ) $( "sightBtn" ).hidden = false;

    $( "sightBtn" ).addEventListener( "click", async () => {
        if ( !await startOrientation() ) { toast( "Compass permission denied — can't cast rays" ); return; }
        openPicker( openCamera );
    } );

    let pickCb = null;

    function openPicker( cb ) {
        pickCb = cb;
        const listEl = $( "pickList" );
        listEl.innerHTML = "";
        items.forEach( ( item ) => {
            const b = document.createElement( "button" );
            b.innerHTML = `<span class="target-dot" style="background:${ itemColor( item ) }"></span>${ esc( item.name ) }`;
            b.addEventListener( "click", () => { closePicker(); pickCb( item ); } );
            listEl.appendChild( b );
        } );
        $( "pickName" ).value = "";
        $( "pickVeil" ).hidden = false;
    }

    function closePicker() {
        $( "pickVeil" ).hidden = true;
    }

    $( "pickCancel" ).addEventListener( "click", closePicker );
    $( "pickForm" ).addEventListener( "submit", ( e ) => {
        e.preventDefault();
        const name = $( "pickName" ).value.trim();
        if ( !name ) return;
        const item = { id: uid(), name: name, createdAt: Date.now() };
        items.push( item );
        persist();
        closePicker();
        pickCb( item );
    } );

    async function openCamera( item ) {
        activeItem = item;
        $( "camTarget" ).textContent = item.name;
        try {
            stream = await navigator.mediaDevices.getUserMedia( {
                video: { facingMode: { ideal: "environment" }, height: { ideal: 1080 }, width: { ideal: 1920 } }
            } );
        } catch {
            toast( "Camera unavailable — use + PLOT RAY instead" );
            return;
        }
        video.srcObject = stream;
        track = stream.getVideoTracks()[ 0 ];
        digitalZoom = 1;
        video.style.transform = "";
        buildZoomRow();
        $( "cam" ).hidden = false;
        render();
    }

    function buildZoomRow() {
        const row = $( "zoomRow" );
        row.innerHTML = "";
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        const hw = caps.zoom && caps.zoom.max > caps.zoom.min;
        const min = hw ? caps.zoom.min : 1;
        const max = hw ? caps.zoom.max : 4;
        const stops = [ ...new Set( [ min, 1, 2, Math.min( 3, max ), max ].filter( ( z ) => z >= min && z <= max ) ) ].sort( ( a, b ) => a - b );
        stops.forEach( ( z ) => {
            const b = document.createElement( "button" );
            b.textContent = z + "×";
            b.addEventListener( "click", () => {
                row.querySelectorAll( "button" ).forEach( ( x ) => x.classList.remove( "on" ) );
                b.classList.add( "on" );
                if ( hw ) track.applyConstraints( { advanced: [ { zoom: z } ] } );
                else {
                    digitalZoom = z;
                    video.style.transform = `scale( ${ z } )`;
                }
            } );
            if ( z === 1 || ( z === min && min > 1 ) ) b.classList.add( "on" );
            row.appendChild( b );
        } );
    }

    function closeCamera() {
        if ( stream ) stream.getTracks().forEach( ( t ) => t.stop() );
        stream = null;
        $( "cam" ).hidden = true;
    }

    $( "camClose" ).addEventListener( "click", closeCamera );

    $( "shutter" ).addEventListener( "click", () => {
        if ( !pos ) { toast( "No GPS fix yet — hold on" ); return; }
        if ( heading == null ) { toast( "No compass heading — wave phone in a figure-8" ); return; }
        const flash = $( "camFlash" );
        flash.classList.remove( "go" );
        void flash.offsetWidth;
        flash.classList.add( "go" );
        const key = uid();
        capturePhoto( key );
        addRay( activeItem.id, {
            acc: pos.coords.accuracy,
            alt: pos.coords.altitude,
            heading: heading,
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            photo: key,
            pitch: pitch
        } );
        const n = rays.filter( ( r ) => r.itemId === activeItem.id ).length;
        toast( n < 2 ? "Ray cast — move somewhere else and sight again" : `Ray cast — ${ n } rays on ${ activeItem.name }` );
    } );

    function capturePhoto( key ) {
        const w = video.videoWidth, h = video.videoHeight;
        if ( !w ) return;
        const scale = Math.min( 1, 900 / w );
        const c = document.createElement( "canvas" );
        c.width = Math.round( w * scale / digitalZoom );
        c.height = Math.round( h * scale / digitalZoom );
        const sx = ( w - w / digitalZoom ) / 2, sy = ( h - h / digitalZoom ) / 2;
        c.getContext( "2d" ).drawImage( video, sx, sy, w / digitalZoom, h / digitalZoom, 0, 0, c.width, c.height );
        c.toBlob( ( blob ) => blob && idbReady.then( () => photoPut( key, blob ) ), "image/jpeg", 0.72 );
    }

    /* ---------- hand plotting ---------- */

    let plot = null;

    $( "plotBtn" ).addEventListener( "click", () => {
        if ( plot ) return endPlot();
        plot = { stage: 0 };
        $( "plotBtn" ).classList.add( "armed" );
        toast( "Click the map where the observer stood", 5000 );
    } );

    function endPlot() {
        if ( plot && plot.line ) map.removeLayer( plot.line );
        plot = null;
        $( "plotBtn" ).classList.remove( "armed" );
    }

    map.on( "click", ( e ) => {
        if ( !plot ) return;
        if ( plot.stage === 0 ) {
            plot.origin = e.latlng;
            plot.stage = 1;
            plot.line = L.polyline( [ e.latlng, e.latlng ], { color: "#ffb000", dashArray: "4 6", weight: 1.5 } ).addTo( map );
            toast( "Now click along the direction of the sighting", 5000 );
        } else {
            const hdg = bearing( plot.origin, e.latlng );
            const origin = plot.origin;
            endPlot();
            openPicker( ( item ) => addRay( item.id, { alt: null, heading: hdg, lat: origin.lat, lon: origin.lng, pitch: null } ) );
        }
    } );

    map.on( "mousemove", ( e ) => {
        if ( plot && plot.stage === 1 ) plot.line.setLatLngs( [ plot.origin, e.latlng ] );
    } );

    function bearing( a, b ) {
        const dy = ( b.lat - a.lat ) * 111320;
        const dx = ( b.lng - a.lng ) * 111320 * Math.cos( a.lat * D2R );
        let h = Math.atan2( dx, dy ) / D2R;
        return h < 0 ? h + 360 : h;
    }

    /* ---------- demo ---------- */

    function loadDemo() {
        const t1 = { id: uid(), name: "Osprey nest", createdAt: Date.now() };
        const t2 = { id: uid(), name: "Radio tower", createdAt: Date.now() };
        items.push( t1, t2 );
        const nest = { lat: 47.2662, lon: -122.4448, alt: 55 };
        const tower = { lat: 47.2478, lon: -122.4310, alt: 140 };
        [ [ 47.2597, -122.4523, 60, 6 ], [ 47.2610, -122.4370, 40, 8 ], [ 47.2712, -122.4525, 30, 5 ] ].forEach( ( o ) => {
            rays.push( synthRay( t1.id, o, nest ) );
        } );
        [ [ 47.2530, -122.4443, 20, 12 ], [ 47.2425, -122.4405, 18, 10 ], [ 47.2500, -122.4200, 25, 9 ] ].forEach( ( o ) => {
            rays.push( synthRay( t2.id, o, tower ) );
        } );
        persist();
        render();
        map.setView( [ 47.257, -122.437 ], 14 );
    }

    function synthRay( itemId, obs, tgt ) {
        const h = bearing( { lat: obs[ 0 ], lng: obs[ 1 ] }, { lat: tgt.lat, lng: tgt.lon } ) + ( Math.random() - 0.5 ) * 4;
        const dist = Math.hypot( ( tgt.lat - obs[ 0 ] ) * 111320, ( tgt.lon - obs[ 1 ] ) * 111320 * Math.cos( obs[ 0 ] * D2R ) );
        const p = Math.atan2( tgt.alt - obs[ 2 ], dist ) / D2R + ( Math.random() - 0.5 ) * 2;
        return { id: uid(), itemId: itemId, ts: Date.now(), acc: 10, alt: obs[ 2 ], heading: ( h + 360 ) % 360, lat: obs[ 0 ], lon: obs[ 1 ], pitch: p };
    }

    $( "demoLink" ).addEventListener( "click", ( e ) => {
        e.preventDefault();
        loadDemo();
    } );

    /* ---------- boot ---------- */

    render();
    if ( rays.length ) {
        const b = L.latLngBounds( rays.map( ( r ) => [ r.lat, r.lon ] ) );
        map.fitBounds( b.pad( 0.3 ) );
    }
    if ( new URLSearchParams( location.search ).has( "demo" ) && !items.length ) loadDemo();
} )();
