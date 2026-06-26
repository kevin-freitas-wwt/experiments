/* Map initialisation, markers, popups, and the form mini-map */

let leafletMap;
let markerCluster;
let userLocationMarker;
let formMap;
let formMarker;

const TEMP_STOPS = [
    { max: 5,        color: '#1664A8' },
    { max: 10,       color: '#2590C8' },
    { max: 15,       color: '#25A89A' },
    { max: 20,       color: '#5EA842' },
    { max: 25,       color: '#D4A020' },
    { max: Infinity, color: '#D46030' }
];

function getTempColor( celsius ) {
    return ( TEMP_STOPS.find( ( s ) => celsius < s.max ) || TEMP_STOPS.at( -1 ) ).color;
}

function initMap() {
    leafletMap = L.map( 'map', {
        center: [22, 15],
        zoom: 2,
        minZoom: 2,
        maxBoundsViscosity: 0.6
    });

    L.tileLayer( 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo( leafletMap );

    markerCluster = L.markerClusterGroup({
        maxClusterRadius: 60,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        iconCreateFunction: createClusterIcon
    });

    leafletMap.addLayer( markerCluster );
}

function createClusterIcon( cluster ) {
    const markers = cluster.getAllChildMarkers();
    const avgTemp = markers.reduce( ( s, m ) => s + ( m.options.tempC || 0 ), 0 ) / markers.length;
    const color = getTempColor( avgTemp );
    const count = cluster.getChildCount();
    return L.divIcon({
        className: 'temp-cluster',
        html: `<div class="cluster-body" style="--cluster-color: ${color}">${count}</div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21]
    });
}

function createMarkerIcon( reading, displayCelsius ) {
    const color = getTempColor( reading.tempC );
    const label = displayCelsius
        ? reading.tempC.toFixed( 1 ) + '°'
        : cToF( reading.tempC ) + '°';

    return L.divIcon({
        className: 'temp-marker',
        html: `<div class="marker-body" style="--marker-color: ${color}">${label}</div>` +
              `<div class="marker-tip" style="border-top-color: ${color}"></div>`,
        iconSize: [52, 34],
        iconAnchor: [26, 34],
        popupAnchor: [0, -38]
    });
}

function buildSparkline( history, color, readingId ) {
    const w = 220, h = 52, pad = 4;
    const temps = history.map( ( p ) => p.tempC );
    const minT = Math.min( ...temps );
    const maxT = Math.max( ...temps );
    const range = maxT - minT || 1;
    const pts = history.map( ( p, i ) => {
        const x = pad + ( i / ( history.length - 1 ) ) * ( w - pad * 2 );
        const y = pad + ( 1 - ( p.tempC - minT ) / range ) * ( h - pad * 2 );
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join( ' ' );
    const first = pts.split( ' ' )[0];
    const last = pts.split( ' ' ).at( -1 );
    const [lx] = last.split( ',' );
    const areaPath = `M ${first} L ${pts.split( ' ' ).join( ' L ' )} L ${lx},${h - pad} L ${pad},${h - pad} Z`;
    return `<div class="spark-wrap" id="sparkwrap-${readingId}">
        <svg class="sparkline" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
            <path d="${areaPath}" fill="${color}" opacity="0.12"/>
            <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <line id="sparkcursor-${readingId}" x1="-1" y1="${pad}" x2="-1" y2="${h - pad}" stroke="rgba(0,0,0,0.2)" stroke-width="1" stroke-dasharray="2,2"/>
            <circle id="sparkdot-${readingId}" cx="-10" cy="-10" r="3" fill="${color}" stroke="white" stroke-width="1.5"/>
        </svg>
        <div class="spark-tooltip" id="sparktip-${readingId}" hidden></div>
    </div>`;
}

function initSparklineHover( reading ) {
    const wrap = document.getElementById( `sparkwrap-${reading.id}` );
    if ( !wrap || !reading.history || reading.history.length < 2 ) return;

    const svg = wrap.querySelector( 'svg' );
    const cursor = document.getElementById( `sparkcursor-${reading.id}` );
    const dot = document.getElementById( `sparkdot-${reading.id}` );
    const tip = document.getElementById( `sparktip-${reading.id}` );
    const history = reading.history;
    const w = 220, h = 52, pad = 4;
    const temps = history.map( ( p ) => p.tempC );
    const minT = Math.min( ...temps );
    const maxT = Math.max( ...temps );
    const range = maxT - minT || 1;

    svg.addEventListener( 'mousemove', ( e ) => {
        const rect = svg.getBoundingClientRect();
        const rawX = ( e.clientX - rect.left ) / rect.width * w;
        const idx = Math.round( ( rawX - pad ) / ( w - pad * 2 ) * ( history.length - 1 ) );
        const clamped = Math.max( 0, Math.min( history.length - 1, idx ) );
        const point = history[clamped];

        const svgX = pad + ( clamped / ( history.length - 1 ) ) * ( w - pad * 2 );
        const svgY = pad + ( 1 - ( point.tempC - minT ) / range ) * ( h - pad * 2 );
        cursor.setAttribute( 'x1', svgX );
        cursor.setAttribute( 'x2', svgX );
        dot.setAttribute( 'cx', svgX );
        dot.setAttribute( 'cy', svgY );

        const useFahrenheit = typeof displayCelsius !== 'undefined' && !displayCelsius;
        const dispTemp = useFahrenheit
            ? cToF( point.tempC ) + '°F'
            : point.tempC.toFixed( 1 ) + '°C';
        const [yr, mo, dy] = point.date.split( '-' ).map( Number );
        const label = new Date( yr, mo - 1, dy ).toLocaleDateString( 'en-US', { month: 'short', day: 'numeric' });
        tip.textContent = `${label} · ${dispTemp}`;
        tip.hidden = false;

        const pixelX = e.clientX - rect.left;
        const useRight = pixelX > rect.width * 0.55;
        tip.style.left = useRight ? 'auto' : ( pixelX + 8 ) + 'px';
        tip.style.right = useRight ? ( rect.width - pixelX + 8 ) + 'px' : 'auto';
    });

    svg.addEventListener( 'mouseleave', () => {
        tip.hidden = true;
        cursor.setAttribute( 'x1', -1 );
        cursor.setAttribute( 'x2', -1 );
        dot.setAttribute( 'cx', -10 );
        dot.setAttribute( 'cy', -10 );
    });
}

function buildPopupHtml( reading, displayCelsius ) {
    const color = getTempColor( reading.tempC );
    const tempPrimary = displayCelsius
        ? reading.tempC.toFixed( 1 ) + '°C'
        : cToF( reading.tempC ) + '°F';
    const tempSecondary = displayCelsius
        ? '(' + cToF( reading.tempC ) + '°F)'
        : '(' + reading.tempC.toFixed( 1 ) + '°C)';
    const date = formatDateTime( reading.date );
    const sourceClass = reading.source === 'citizen' ? 'source-citizen' : 'source-public';
    const sourceLabel = reading.source === 'citizen'
        ? '&#129514; Citizen Scientist'
        : '&#128225; ' + escapeHtml( reading.sourceDetail || 'Public Data' );

    const photoHtml = reading.photoUrl
        ? `<img class="popup-photo" src="${escapeHtml( reading.photoUrl )}" alt="Temperature reading photo" loading="lazy">`
        : '';

    const notesHtml = reading.notes
        ? `<div class="popup-notes">&ldquo;${escapeHtml( reading.notes )}&rdquo;</div>`
        : '';

    const sparkHtml = ( reading.history && reading.history.length >= 2 )
        ? buildSparkline( reading.history, color, reading.id )
        : '';

    return `
        <div class="popup-content">
            <div class="popup-header">
                ${reading.waterBody ? `<h3 class="popup-name">${escapeHtml( reading.waterBody )}</h3>` : ''}
                <span class="popup-type-tag type-${reading.type}">${capitalize( reading.type )}</span>
            </div>
            <div class="popup-temp-row">
                <span class="popup-temp" style="color:${color}">${tempPrimary}</span>
                <span class="popup-temp-alt">${tempSecondary}</span>
            </div>
            ${sparkHtml}
            ${photoHtml}
            <div class="popup-meta">
                <div class="popup-date">${date}</div>
                <span class="popup-source-badge ${sourceClass}">${sourceLabel}</span>
            </div>
            ${notesHtml}
        </div>
    `;
}

const FALLBACK_ZOOM = {
    ocean: 5, river: 9, lake: 10, pond: 13, stream: 12, other: 10
};

async function zoomToWaterBody( reading ) {
    const fallback = () => {
        const zoom = FALLBACK_ZOOM[reading.type] || 10;
        leafletMap.setView( [reading.lat, reading.lng], zoom, { animate: true, duration: 0.9 });
    };

    try {
        const q = encodeURIComponent( reading.waterBody );
        const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5&accept-language=en`;
        const res = await fetch( url );
        if ( !res.ok ) { fallback(); return; }

        const results = await res.json();
        if ( !results.length ) { fallback(); return; }

        const best = results.reduce( ( a, b ) => {
            const da = haversineKm( reading.lat, reading.lng, parseFloat( a.lat ), parseFloat( a.lon ) );
            const db = haversineKm( reading.lat, reading.lng, parseFloat( b.lat ), parseFloat( b.lon ) );
            return da <= db ? a : b;
        });

        const [south, north, west, east] = best.boundingbox.map( Number );
        leafletMap.fitBounds( [[south, west], [north, east]], {
            padding: [48, 48],
            maxZoom: 14,
            animate: true,
            duration: 0.9
        });
    } catch ( _e ) {
        fallback();
    }
}

function updateMapMarkers( readings, displayCelsius ) {
    markerCluster.clearLayers();

    readings.forEach( ( reading ) => {
        const icon = createMarkerIcon( reading, displayCelsius );
        const marker = L.marker( [reading.lat, reading.lng], { icon, tempC: reading.tempC });
        marker.bindPopup( buildPopupHtml( reading, displayCelsius ), {
            maxWidth: 260,
            className: 'temp-popup'
        });
        marker.on( 'click', () => zoomToWaterBody( reading ) );
        marker.on( 'popupopen', () => {
            marker.setIcon( createMarkerIcon( reading, displayCelsius ) );
            initSparklineHover( reading );
        });
        markerCluster.addLayer( marker );
    });
}

function updateMarkersUnit( readings, displayCelsius ) {
    updateMapMarkers( readings, displayCelsius );
    updateLegendUnit( displayCelsius );
}

function updateLegendUnit( displayCelsius ) {
    document.querySelectorAll( '.legend-label' ).forEach( ( el ) => {
        const below = el.dataset.below;
        const above = el.dataset.above;
        const range = el.dataset.range;

        if ( below ) {
            const v = displayCelsius ? below : cToF( parseFloat( below ) );
            el.textContent = '<' + v + (displayCelsius ? '°C' : '°F');
        } else if ( above ) {
            const v = displayCelsius ? above : cToF( parseFloat( above ) );
            el.textContent = '>' + v + (displayCelsius ? '°C' : '°F');
        } else if ( range ) {
            const [lo, hi] = range.split( ',' ).map( Number );
            const unit = displayCelsius ? '°C' : '°F';
            const a = displayCelsius ? lo : cToF( lo );
            const b = displayCelsius ? hi : cToF( hi );
            el.textContent = a + '–' + b + unit;
        }
    });
}

function showUserLocation( lat, lng ) {
    const icon = L.divIcon({
        className: '',
        html: '<div class="user-location-marker"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });

    if ( userLocationMarker ) {
        userLocationMarker.setLatLng( [lat, lng] );
    } else {
        userLocationMarker = L.marker( [lat, lng], { icon, zIndexOffset: 1000 }).addTo( leafletMap );
        userLocationMarker.bindTooltip( 'Your location', { permanent: false });
    }

    leafletMap.setView( [lat, lng], 8, { animate: true });
}

/* ── Form mini-map ──────────────────────────────────────────── */

function initFormMap( onLocationSelect ) {
    if ( formMap ) {
        formMap.invalidateSize();
        return;
    }

    formMap = L.map( 'form-map', {
        center: [20, 0],
        zoom: 1,
        zoomControl: true,
        attributionControl: false
    });

    L.tileLayer( 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 18
    }).addTo( formMap );

    formMap.on( 'click', ( e ) => {
        setFormMapPin( e.latlng.lat, e.latlng.lng );
        onLocationSelect( e.latlng.lat, e.latlng.lng );
    });
}

function setFormMapPin( lat, lng ) {
    if ( formMarker ) {
        formMarker.setLatLng( [lat, lng] );
    } else {
        formMarker = L.marker( [lat, lng], { draggable: true }).addTo( formMap );
        formMarker.on( 'dragend', () => {
            const pos = formMarker.getLatLng();
            setFormMapPin( pos.lat, pos.lng );
            if ( typeof window.onFormLocationDrag === 'function' ) {
                window.onFormLocationDrag( pos.lat, pos.lng );
            }
        });
    }
}

function clearFormMapPin() {
    if ( formMarker ) {
        formMarker.remove();
        formMarker = null;
    }
    if ( formMap ) {
        formMap.setView( [20, 0], 1 );
    }
}
