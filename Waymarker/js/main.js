import { moonPosition, moonTimes, sunPosition, sunTimes } from "./astro.js";
import { startCamera, stopCamera } from "./camera.js";
import { createGeo } from "./geo.js";
import { decimalYear, declination } from "./geomag.js";
import { bump } from "./haptics.js";
import { createOrientation, requestSensors } from "./orientation.js";
import { drawScene } from "./render.js";

const canvas = document.getElementById( "scene" );
const ctx = canvas.getContext( "2d" );
const overlay = document.getElementById( "overlay" );
const controls = document.getElementById( "controls" );
const recenter = document.getElementById( "recenter" );
const cameraButton = document.getElementById( "camera-toggle" );
const cameraVideo = document.getElementById( "camera" );
const latInput = document.getElementById( "sim-lat" );
const lonInput = document.getElementById( "sim-lon" );

// Location source: GPS by default; editing lat/lon overrides it, the target
// button snaps back to the device fix.
let useGps = true;
let urlKey = "";

const CAMERA_FADE_STEP = 0.06;
const VELUM_ALPHA = 0.5;

let cameraOn = false;
let cameraFading = false;
let skyVeil = VELUM_ALPHA;

const DRAG_SENSITIVITY = 0.2;
const FRAME_MS = 16.7;
const FRICTION = 0.93;
const MAX_MOMENTUM = 6;
const MOMENTUM_MIN = 0.02;
const CENTER_ENTER_PX = 8;
const CENTER_EXIT_PX = 26;

let centeredKey = null;

const geo = createGeo();
const orientation = createOrientation();

// "sensor": heading follows the compass. "manual": heading is dragged. A drag
// switches to manual; the re-center button switches back to sensor.
let headingMode = "sensor";
const manual = { dragging: false, heading: 0, lat: 47.6062, lon: -122.3321, velocity: 0 };

const SETTINGS_KEY = "waymarker.settings";
const DEFAULT_SETTINGS = { celestial: "on", minTier: 0, names: "western", theme: "field", units: "mi", within: 100 };
const ELEV_TIERS = { km: [ 1500, 2500, 3000 ], mi: [ 5000, 7500, 10000 ] };
const THEMES = {
    dusk: { foothill: "#7a5a55", ridge: "#6e5f78", sky: "#4a3b54", text: "#fed" },
    field: { foothill: "#4a7d42", ridge: "#aaa", sky: "#5b7fa6" },
    mono: { foothill: "#54565c", ridge: "#3c3e44", sky: "#2b2b2b" },
    red: { foothill: "#600", ridge: "#400", sky: "#200", text: "#f00" }
};
const WITHIN_OPTIONS = [ 25, 50, 100 ];

const settings = loadSettings();

function loadSettings() {
    const result = { ...DEFAULT_SETTINGS };
    try {
        Object.assign( result, JSON.parse( localStorage.getItem( SETTINGS_KEY ) ) );
    } catch ( err ) {
        // ignore unreadable storage
    }
    if ( !WITHIN_OPTIONS.includes( result.within ) ) {
        result.within = DEFAULT_SETTINGS.within;
    }
    if ( ![ 0, 1, 2 ].includes( result.minTier ) ) {
        result.minTier = DEFAULT_SETTINGS.minTier;
    }
    if ( !THEMES[ result.theme ] ) {
        result.theme = DEFAULT_SETTINGS.theme;
    }
    return result;
}

function saveSettings() {
    try {
        localStorage.setItem( SETTINGS_KEY, JSON.stringify( settings ) );
    } catch ( err ) {
        // ignore unwritable storage
    }
}

function withinMeters() {
    return settings.within * ( settings.units === "km" ? 1000 : 1609.34 );
}

function minElevMeters() {
    const value = ELEV_TIERS[ settings.units ][ settings.minTier ];
    return settings.units === "km" ? value : value * 0.3048;
}

let peaks = [];
let cssH = 0;
let cssW = 0;

function resize() {
    const dpr = window.devicePixelRatio || 1;
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round( cssW * dpr );
    canvas.height = Math.round( cssH * dpr );
    ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
}

const decl = { lat: null, lon: null, value: 0 };

// Magnetic sensors report magnetic north; peak bearings are true north. Correct
// the heading with the local declination, recomputed when the fix moves enough.
function trueHeading( magnetic ) {
    if ( !geo.state.hasFix ) {
        return magnetic;
    }
    if ( decl.lat === null || Math.abs( geo.state.lat - decl.lat ) > 0.1 || Math.abs( geo.state.lon - decl.lon ) > 0.1 ) {
        decl.lat = geo.state.lat;
        decl.lon = geo.state.lon;
        decl.value = declination( geo.state.lat, geo.state.lon, ( geo.state.altitude || 0 ) / 1000, decimalYear( new Date() ) );
    }
    return ( magnetic + decl.value + 360 ) % 360;
}

function sensorLive() {
    return orientation.state.hasData;
}

function effectiveHeading() {
    return headingMode === "sensor" && sensorLive()
        ? trueHeading( orientation.state.heading )
        : manual.heading;
}

async function enableCamera() {
    try {
        await startCamera( cameraVideo );
        cameraVideo.classList.add( "on" );
        cameraButton.classList.add( "active" );
        cameraFading = false;
        skyVeil = VELUM_ALPHA;
        cameraOn = true;
    } catch ( err ) {
        cameraOn = false;
    }
}

// Begin fading the camera out: the loop ramps the sky veil up until it fully
// covers the feed, then tears down the stream.
function disableCamera() {
    if ( cameraOn ) {
        cameraFading = true;
    }
}

function toggleCamera() {
    if ( cameraOn ) {
        disableCamera();
    } else {
        enableCamera();
    }
}

function formatTime( date ) {
    let h = date.getHours();
    const ap = h < 12 ? "am" : "pm";
    h = h % 12 || 12;
    return `${ h }:${ String( date.getMinutes() ).padStart( 2, "0" ) }${ ap }`;
}

function valid( date ) {
    return date && !isNaN( date.valueOf() );
}

// Rise/set markers: sun & moon icons at the bearings where they rise and set
// today, each with its time.
function computeCelestial( loc ) {
    if ( settings.celestial !== "on" ) {
        return null;
    }
    const now = new Date();
    const markers = [];
    const st = sunTimes( now, loc.lat, loc.lon );
    if ( valid( st.sunrise ) ) {
        markers.push( { az: sunPosition( st.sunrise, loc.lat, loc.lon ).azimuth, kind: "sun", label: `${ formatTime( st.sunrise ) } (rise)` } );
    }
    if ( valid( st.sunset ) ) {
        markers.push( { az: sunPosition( st.sunset, loc.lat, loc.lon ).azimuth, kind: "sun", label: `${ formatTime( st.sunset ) } (set)` } );
    }
    const mt = moonTimes( now, loc.lat, loc.lon );
    if ( valid( mt.rise ) ) {
        markers.push( { az: moonPosition( mt.rise, loc.lat, loc.lon ).azimuth, kind: "moon", label: `${ formatTime( mt.rise ) } (rise)` } );
    }
    if ( valid( mt.set ) ) {
        markers.push( { az: moonPosition( mt.set, loc.lat, loc.lon ).azimuth, kind: "moon", label: `${ formatTime( mt.set ) } (set)` } );
    }
    return { markers };
}

function currentView() {
    const theme = THEMES[ settings.theme ];
    const loc = useGps && geo.state.hasFix
        ? { lat: geo.state.lat, lon: geo.state.lon }
        : { lat: manual.lat, lon: manual.lon };
    return {
        camera: cameraOn,
        celestial: computeCelestial( loc ),
        foothill: theme.foothill,
        heading: effectiveHeading(),
        h: cssH,
        location: loc,
        minElevM: minElevMeters(),
        names: settings.names,
        ridge: theme.ridge,
        sky: theme.sky,
        skyVeil: skyVeil,
        text: theme.text || "#ffffff",
        units: settings.units,
        w: cssW,
        withinM: withinMeters()
    };
}

// While tracking GPS, mirror the fix into the lat/lon fields (unless the user is
// editing them) so they always show the active center point.
function syncLocationInputs() {
    if ( useGps && geo.state.hasFix ) {
        manual.lat = geo.state.lat;
        manual.lon = geo.state.lon;
        if ( document.activeElement !== latInput ) {
            latInput.value = geo.state.lat.toFixed( 4 );
        }
        if ( document.activeElement !== lonInput ) {
            lonInput.value = geo.state.lon.toFixed( 4 );
        }
    }
}

function readUrlLocation() {
    const params = new URLSearchParams( window.location.search );
    const lat = parseFloat( params.get( "lat" ) );
    const lon = parseFloat( params.get( "lon" ) );
    if ( isNaN( lat ) || isNaN( lon ) ) {
        return false;
    }
    manual.lat = lat;
    manual.lon = lon;
    useGps = false;
    latInput.value = lat;
    lonInput.value = lon;
    return true;
}

// The URL carries lat/lon only as a manual location pin (which also skips the
// welcome screen on load). In GPS mode the URL stays clean, so normal launches
// still show the welcome and request sensor permission.
function syncUrl() {
    if ( useGps ) {
        if ( window.location.search ) {
            urlKey = "";
            window.history.replaceState( null, "", window.location.pathname );
        }
        return;
    }
    const key = `${ manual.lat.toFixed( 4 ) },${ manual.lon.toFixed( 4 ) }`;
    if ( key !== urlKey ) {
        urlKey = key;
        window.history.replaceState( null, "", `${ window.location.pathname }?lat=${ manual.lat.toFixed( 4 ) }&lon=${ manual.lon.toFixed( 4 ) }` );
    }
}

function updateControls() {
    const sensorMode = headingMode === "sensor" && sensorLive();
    recenter.classList.toggle( "hidden", !( headingMode === "manual" && sensorLive() ) );
    cameraButton.classList.toggle( "hidden", !sensorMode );
    syncLocationInputs();
    syncUrl();
}

// Bump once when a peak settles dead-center. Hysteresis (enter < exit) keeps
// compass jitter from re-triggering while a peak hovers near the middle.
function checkCenter( nearest ) {
    if ( centeredKey && ( !nearest || nearest.key !== centeredKey || nearest.dist > CENTER_EXIT_PX ) ) {
        centeredKey = null;
    }
    if ( !centeredKey && nearest && nearest.dist < CENTER_ENTER_PX ) {
        centeredKey = nearest.key;
        bump();
    }
}

function loop() {
    if ( headingMode === "manual" && !manual.dragging && Math.abs( manual.velocity ) > MOMENTUM_MIN ) {
        manual.heading = ( manual.heading + manual.velocity + 360 ) % 360;
        manual.velocity *= FRICTION;
    }
    if ( cameraFading ) {
        skyVeil = Math.min( 1, skyVeil + CAMERA_FADE_STEP );
        if ( skyVeil >= 1 ) {
            cameraOn = false;
            cameraFading = false;
            skyVeil = VELUM_ALPHA;
            stopCamera( cameraVideo );
            cameraVideo.classList.remove( "on" );
            cameraButton.classList.remove( "active" );
        }
    }
    checkCenter( drawScene( ctx, peaks, currentView() ) );
    updateControls();
    requestAnimationFrame( loop );
}

function bindDrag() {
    let lastX = 0;
    let lastT = 0;
    let velPerMs = 0;

    canvas.addEventListener( "pointerdown", ( e ) => {
        manual.dragging = true;
        manual.velocity = 0;
        velPerMs = 0;
        lastX = e.clientX;
        lastT = e.timeStamp;
    } );
    window.addEventListener( "pointermove", ( e ) => {
        if ( !manual.dragging ) {
            return;
        }
        if ( headingMode === "sensor" ) {
            manual.heading = effectiveHeading();
            headingMode = "manual";
            disableCamera();
        }
        const dt = Math.max( e.timeStamp - lastT, 1 );
        const delta = -( e.clientX - lastX ) * DRAG_SENSITIVITY;
        manual.heading = ( manual.heading + delta + 360 ) % 360;
        velPerMs = velPerMs * 0.8 + ( delta / dt ) * 0.2;
        lastX = e.clientX;
        lastT = e.timeStamp;
    } );
    window.addEventListener( "pointerup", ( e ) => {
        if ( !manual.dragging ) {
            return;
        }
        manual.dragging = false;
        const idle = e.timeStamp - lastT > 60;
        const v = idle ? 0 : velPerMs * FRAME_MS;
        manual.velocity = Math.max( -MAX_MOMENTUM, Math.min( MAX_MOMENTUM, v ) );
    } );

    bindInput( "sim-lat", ( v ) => { manual.lat = v; useGps = false; } );
    bindInput( "sim-lon", ( v ) => { manual.lon = v; useGps = false; } );
}

function dropdownValue( raw ) {
    const n = parseInt( raw, 10 );
    return isNaN( n ) ? raw : n;
}

function closeMenus() {
    for ( const menu of document.querySelectorAll( ".dropdown-menu" ) ) {
        menu.classList.add( "hidden" );
    }
}

function syncSettings() {
    for ( const seg of document.querySelectorAll( ".seg" ) ) {
        const key = seg.dataset.setting;
        for ( const btn of seg.querySelectorAll( "button" ) ) {
            btn.classList.toggle( "active", btn.dataset.value === settings[ key ] );
        }
    }
    for ( const dd of document.querySelectorAll( ".dropdown" ) ) {
        const key = dd.dataset.setting;
        const value = settings[ key ];
        let label = "";
        for ( const btn of dd.querySelectorAll( ".dropdown-menu button" ) ) {
            const raw = dropdownValue( btn.dataset.value );
            if ( key === "minTier" ) {
                btn.textContent = ELEV_TIERS[ settings.units ][ raw ].toLocaleString( "en-US" );
            }
            const active = raw === value;
            btn.classList.toggle( "active", active );
            if ( active ) {
                label = btn.textContent;
            }
        }
        dd.querySelector( ".dropdown-value" ).textContent = label;
    }
    for ( const el of document.querySelectorAll( ".within-unit" ) ) {
        el.textContent = settings.units;
    }
    for ( const el of document.querySelectorAll( ".elev-unit" ) ) {
        el.textContent = settings.units === "km" ? "m" : "ft";
    }
}

function bindSettings() {
    const gear = document.getElementById( "settings-gear" );
    const panel = document.getElementById( "settings-panel" );

    gear.addEventListener( "click", () => {
        panel.classList.remove( "hidden" );
        controls.classList.add( "hidden" );
    } );
    document.getElementById( "settings-close" ).addEventListener( "click", () => {
        closeMenus();
        panel.classList.add( "hidden" );
        controls.classList.remove( "hidden" );
    } );

    for ( const seg of document.querySelectorAll( ".seg" ) ) {
        const key = seg.dataset.setting;
        for ( const btn of seg.querySelectorAll( "button" ) ) {
            btn.addEventListener( "click", () => {
                settings[ key ] = btn.dataset.value;
                saveSettings();
                syncSettings();
            } );
        }
    }

    for ( const dd of document.querySelectorAll( ".dropdown" ) ) {
        const key = dd.dataset.setting;
        const trigger = dd.querySelector( ".dropdown-trigger" );
        const menu = dd.querySelector( ".dropdown-menu" );
        trigger.addEventListener( "click", ( e ) => {
            e.stopPropagation();
            const opening = menu.classList.contains( "hidden" );
            closeMenus();
            if ( opening ) {
                const r = trigger.getBoundingClientRect();
                menu.style.bottom = `${ window.innerHeight - r.top + 6 }px`;
                menu.style.left = `${ r.left }px`;
                menu.style.minWidth = `${ r.width }px`;
                menu.classList.remove( "hidden" );
            }
        } );
        for ( const btn of menu.querySelectorAll( "button" ) ) {
            btn.addEventListener( "click", () => {
                settings[ key ] = dropdownValue( btn.dataset.value );
                saveSettings();
                syncSettings();
                closeMenus();
            } );
        }
    }

    window.addEventListener( "click", closeMenus );
    syncSettings();
}

function bindInput( id, apply ) {
    const el = document.getElementById( id );
    el.addEventListener( "input", () => {
        const v = parseFloat( el.value );
        if ( !isNaN( v ) ) {
            apply( v );
        }
    } );
}

async function start() {
    overlay.classList.add( "hidden" );
    headingMode = "sensor";
    if ( await requestSensors() ) {
        orientation.start();
    }
    geo.start();
}

async function init() {
    resize();
    window.addEventListener( "resize", resize );
    window.addEventListener( "orientationchange", resize );
    // iOS ignores the viewport no-zoom flags, so block its pinch gestures here.
    for ( const ev of [ "gesturestart", "gesturechange", "gestureend" ] ) {
        document.addEventListener( ev, ( e ) => e.preventDefault() );
    }
    bindDrag();
    bindSettings();
    // A URL with coords is a direct link to a view — skip the welcome screen.
    if ( readUrlLocation() ) {
        start();
    }

    document.getElementById( "start" ).addEventListener( "click", start );
    recenter.addEventListener( "click", () => {
        headingMode = "sensor";
        manual.velocity = 0;
    } );
    cameraButton.addEventListener( "click", toggleCamera );
    document.getElementById( "loc-target" ).addEventListener( "click", () => {
        useGps = true;
        geo.start();
    } );

    if ( "serviceWorker" in navigator ) {
        navigator.serviceWorker.register( "sw.js" ).catch( () => {} );
    }

    requestAnimationFrame( loop );

    try {
        peaks = await ( await fetch( "data/peaks.json" ) ).json();
    } catch ( err ) {
        peaks = [];
    }
}

init();
