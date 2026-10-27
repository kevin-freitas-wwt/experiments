import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist/maplibre-gl.mjs";
import { Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm";

const BASE = new URL( ".", import.meta.url ).href;
const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const POINT_ZOOM = 12;
const HALVES = [ "w", "e" ];
const US = [ [ -125.5, 24 ], [ -66.5, 49.5 ] ];

const state = { g: null, zip: null };
const initialHash = location.hash;
let data = null;
let index = [];

maplibregl.addProtocol( "pmtiles", new Protocol().tile );

const dark = matchMedia( "( prefers-color-scheme: dark )" );
const map = new maplibregl.Map( {
    container: "map",
    style: dark.matches ? STYLES.dark : STYLES.light,
    bounds: US,
    fitBoundsOptions: { padding: 20 },
    hash: "map",
    attributionControl: { compact: true },
} );
map.addControl( new maplibregl.NavigationControl( { showCompass: false } ), "top-right" );

const accent = () => getComputedStyle( document.documentElement ).getPropertyValue( "--accent" ).trim();
const paper = () => getComputedStyle( document.documentElement ).getPropertyValue( "--paper" ).trim();

function countExpr() {
    return state.g == null
        ? [ "coalesce", [ "get", "point_count" ], 1 ]
        : [ "coalesce", [ "get", "c" + state.g ], 0 ];
}

function labelExpr( c ) {
    return [ "case",
        [ ">=", c, 10000 ], [ "concat", [ "to-string", [ "round", [ "/", c, 1000 ] ] ], "k" ],
        [ ">=", c, 1000 ], [ "concat", [ "to-string", [ "/", [ "round", [ "/", c, 100 ] ], 10 ] ], "k" ],
        [ "to-string", c ] ];
}

function clusterPaint( c ) {
    return {
        opacity: [ "interpolate", [ "linear" ], [ "sqrt", c ], 1, 0.9, 30, 0.75, 900, 0.6 ],
        radius: [ "interpolate", [ "linear" ], [ "sqrt", c ], 1, 3.5, 1.41, 8, 5.5, 12, 17.3, 17, 60, 22, 245, 27, 1000, 31 ],
        stroke: [ "step", c, 0, 2, 1.5 ],
        text: [ "interpolate", [ "linear" ], [ "sqrt", c ], 1.41, 10, 17.3, 12, 245, 14 ],
    };
}

function pointFilter() {
    const f = [ "all" ];
    if ( state.g != null ) f.push( [ "==", [ "get", "g" ], state.g ] );
    if ( state.zip ) f.push( [ "==", [ "get", "z" ], state.zip ] );
    return f;
}

function decorate() {
    const c = countExpr();
    const cp = clusterPaint( c );
    map.addSource( "overview", { type: "vector", url: `pmtiles://${ BASE }data/overview.pmtiles` } );
    for ( const h of HALVES ) map.addSource( "points-" + h, { type: "vector", url: `pmtiles://${ BASE }data/points_${ h }.pmtiles` } );

    map.addLayer( {
        id: "clusters", type: "circle", source: "overview", "source-layer": "clusters", maxzoom: POINT_ZOOM,
        filter: [ ">", c, 0 ],
        paint: {
            "circle-color": accent(),
            "circle-opacity": cp.opacity,
            "circle-radius": cp.radius,
            "circle-stroke-color": paper(),
            "circle-stroke-width": cp.stroke,
        },
    } );
    map.addLayer( {
        id: "cluster-labels", type: "symbol", source: "overview", "source-layer": "clusters", maxzoom: POINT_ZOOM,
        filter: [ ">=", c, 2 ],
        layout: {
            "text-allow-overlap": true,
            "text-field": labelExpr( c ),
            "text-font": [ "Noto Sans Regular" ],
            "text-size": cp.text,
        },
        paint: { "text-color": "#fff" },
    } );
    map.addLayer( {
        id: "zippoints", type: "circle", source: "overview", "source-layer": "zippoints", maxzoom: POINT_ZOOM,
        filter: pointFilter(),
        layout: { visibility: "none" },
        paint: {
            "circle-color": accent(),
            "circle-radius": [ "interpolate", [ "linear" ], [ "zoom" ], 6, 2, 11, 4 ],
            "circle-stroke-color": paper(),
            "circle-stroke-width": 1,
        },
    } );
    for ( const h of HALVES ) map.addLayer( {
        id: "points-" + h, type: "circle", source: "points-" + h, "source-layer": "points", minzoom: POINT_ZOOM,
        filter: pointFilter(),
        paint: {
            "circle-color": accent(),
            "circle-radius": [ "interpolate", [ "linear" ], [ "zoom" ], 12, 3, 16, 7 ],
            "circle-stroke-color": paper(),
            "circle-stroke-width": 1,
        },
    } );
    applyState();
}

function applyState() {
    if ( !map.getLayer( "clusters" ) ) return;
    const c = countExpr();
    const cp = clusterPaint( c );
    const zipMode = !!state.zip;
    map.setFilter( "clusters", [ ">", c, 0 ] );
    map.setFilter( "cluster-labels", [ ">=", c, 2 ] );
    map.setPaintProperty( "clusters", "circle-radius", cp.radius );
    map.setPaintProperty( "clusters", "circle-opacity", cp.opacity );
    map.setPaintProperty( "clusters", "circle-stroke-width", cp.stroke );
    map.setLayoutProperty( "cluster-labels", "text-field", labelExpr( c ) );
    map.setLayoutProperty( "cluster-labels", "text-size", cp.text );
    map.setLayoutProperty( "clusters", "visibility", zipMode ? "none" : "visible" );
    map.setLayoutProperty( "cluster-labels", "visibility", zipMode ? "none" : "visible" );
    map.setLayoutProperty( "zippoints", "visibility", zipMode ? "visible" : "none" );
    map.setFilter( "zippoints", pointFilter() );
    for ( const h of HALVES ) map.setFilter( "points-" + h, pointFilter() );
    updateLegend();
}

function updateLegend() {
    const z = map.getZoom();
    const el = document.getElementById( "legendText" );
    if ( state.zip ) el.textContent = `Each dot is one restaurant in ${ state.zip }`;
    else if ( z >= POINT_ZOOM ) el.textContent = "Each dot is one restaurant";
    else el.textContent = "Circles are counts. Zoom in for individual restaurants";
}

map.on( "style.load", decorate );
map.on( "zoomend", updateLegend );

map.on( "click", "clusters", ( e ) => {
    const f = e.features[0];
    map.easeTo( { center: f.geometry.coordinates, zoom: Math.min( map.getZoom() + 2.5, POINT_ZOOM + 1 ) } );
} );

const popup = new maplibregl.Popup( { closeButton: false, closeOnClick: false, offset: 8, maxWidth: "280px" } );
function showPopup( e ) {
    const p = e.features[0].properties;
    map.getCanvas().style.cursor = "pointer";
    popup.setLngLat( e.features[0].geometry.coordinates )
        .setHTML( `<div class="popup"><h3>${ esc( p.n ) }</h3><p><span class="tag">${ data.groups[ p.g ] }</span>${ p.a ? " · " + esc( p.a ) : "" }${ p.z ? " " + p.z : "" }</p></div>` )
        .addTo( map );
}
function hidePopup() {
    map.getCanvas().style.cursor = "";
    popup.remove();
}
for ( const h of HALVES ) {
    map.on( "mousemove", "points-" + h, showPopup );
    map.on( "mouseleave", "points-" + h, hidePopup );
}
map.on( "mouseenter", "clusters", () => map.getCanvas().style.cursor = "pointer" );
map.on( "mouseleave", "clusters", () => map.getCanvas().style.cursor = "" );
map.on( "click", "zippoints", ( e ) => {
    map.easeTo( { center: e.features[0].geometry.coordinates, zoom: POINT_ZOOM + 2 } );
} );

function esc( s ) {
    return String( s ?? "" ).replace( /[&<>"]/g, ( ch ) => ( { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ ch ] ) );
}

dark.addEventListener( "change", ( e ) => map.setStyle( e.matches ? STYLES.dark : STYLES.light ) );

/* ---------- rail ---------- */

const fmt = new Intl.NumberFormat( "en-US" );
const compact = new Intl.NumberFormat( "en-US", { notation: "compact", maximumFractionDigits: 1 } );
const list = document.getElementById( "cuisines" );

function renderCuisines() {
    const counts = state.zip ? data.zips[ state.zip ][4] : data.totals;
    const total = counts.reduce( ( a, b ) => a + b, 0 );
    const order = counts.map( ( n, i ) => i ).sort( ( a, b ) => counts[ b ] - counts[ a ] );
    const max = counts[ order[0] ] || 1;
    const row = ( i, name, n, share ) => `
        <li data-g="${ i }" role="button" aria-pressed="${ state.g === ( i === "" ? null : i ) }"${ i === "" ? ' class="all"' : "" }>
            <span class="name">${ name }</span>
            <span class="count">${ fmt.format( n ) }</span>
            <span class="bar"><i style="width:${ ( share * 100 ).toFixed( 1 ) }%"></i></span>
        </li>`;
    list.innerHTML = row( "", "All cuisines", total, 1 ) + order.filter( ( i ) => counts[ i ] > 0 || !state.zip )
        .map( ( i ) => row( i, data.groups[ i ], counts[ i ], counts[ i ] / max ) ).join( "" );
    document.getElementById( "total" ).textContent = compact.format( data.totals.reduce( ( a, b ) => a + b, 0 ) );
}

list.addEventListener( "click", ( e ) => {
    const li = e.target.closest( "li" );
    if ( !li ) return;
    const g = li.dataset.g === "" ? null : Number( li.dataset.g );
    state.g = state.g === g ? null : g;
    sync();
} );

/* ---------- ZIP / city search ---------- */

const input = document.getElementById( "zip" );
const suggest = document.getElementById( "suggest" );
let active = -1;
let matches = [];

function search( q ) {
    q = q.trim().toLowerCase();
    if ( !q ) return [];
    if ( /^\d+$/.test( q ) ) return index.filter( ( r ) => r[0].startsWith( q ) ).slice( 0, 8 );
    const words = q.split( /[\s,]+/ ).filter( Boolean );
    return index.filter( ( r ) => words.every( ( w ) => r[1].includes( w ) || r[2].toLowerCase() === w ) ).slice( 0, 8 );
}

function renderSuggest() {
    suggest.hidden = matches.length === 0;
    suggest.innerHTML = matches.map( ( r, i ) =>
        `<li role="option" aria-selected="${ i === active }" data-zip="${ r[0] }"><b>${ r[0] }</b><span>${ esc( r[3] ) }${ r[2] ? ", " + r[2] : "" }</span><small>${ fmt.format( r[4] ) }</small></li>` ).join( "" );
}

input.addEventListener( "input", () => {
    matches = search( input.value );
    active = matches.length ? 0 : -1;
    renderSuggest();
} );
input.addEventListener( "keydown", ( e ) => {
    if ( e.key === "ArrowDown" || e.key === "ArrowUp" ) {
        e.preventDefault();
        if ( !matches.length ) return;
        active = ( active + ( e.key === "ArrowDown" ? 1 : matches.length - 1 ) ) % matches.length;
        renderSuggest();
    } else if ( e.key === "Enter" ) {
        if ( active >= 0 ) selectZip( matches[ active ][0] );
        else if ( /^\d{5}$/.test( input.value ) && data.zips[ input.value ] ) selectZip( input.value );
    } else if ( e.key === "Escape" ) {
        matches = []; renderSuggest(); input.blur();
    }
} );
suggest.addEventListener( "mousedown", ( e ) => {
    const li = e.target.closest( "li" );
    if ( li ) { e.preventDefault(); selectZip( li.dataset.zip ); }
} );
input.addEventListener( "blur", () => setTimeout( () => { matches = []; renderSuggest(); }, 150 ) );

function selectZip( zip ) {
    const r = data.zips[ zip ];
    if ( !r ) return;
    state.zip = zip;
    matches = []; renderSuggest();
    input.value = zip;
    input.blur();
    sync();
    const [ w, s, e, n ] = r[2];
    map.fitBounds( [ [ w, s ], [ e, n ] ], { padding: 60, maxZoom: 15, duration: 1200 } );
}

document.getElementById( "clearZip" ).addEventListener( "click", () => {
    state.zip = null;
    input.value = "";
    sync();
} );

function renderScope() {
    const el = document.getElementById( "scope" );
    el.hidden = !state.zip;
    if ( !state.zip ) return;
    const r = data.zips[ state.zip ];
    document.getElementById( "scopeZip" ).textContent = state.zip;
    document.getElementById( "scopePlace" ).textContent = [ r[5], r[6] ].filter( Boolean ).join( ", " );
}

/* ---------- state ---------- */

function readHash() {
    const h = new URLSearchParams( location.hash.slice( 1 ) );
    const g = h.get( "g" );
    state.g = g != null && data.groups[ g ] ? Number( g ) : null;
    const zip = h.get( "zip" );
    state.zip = zip && data.zips[ zip ] ? zip : null;
    if ( state.zip ) input.value = state.zip;
}

function writeHash() {
    const h = new URLSearchParams( location.hash.slice( 1 ) );
    state.g == null ? h.delete( "g" ) : h.set( "g", state.g );
    state.zip ? h.set( "zip", state.zip ) : h.delete( "zip" );
    history.replaceState( null, "", "#" + h.toString() );
}

function sync() {
    renderCuisines();
    renderScope();
    applyState();
    writeHash();
}

if ( matchMedia( "( max-width: 760px )" ).matches ) document.getElementById( "toggle" ).setAttribute( "aria-expanded", "false" );
document.getElementById( "toggle" ).addEventListener( "click", ( e ) => {
    const b = e.currentTarget;
    b.setAttribute( "aria-expanded", b.getAttribute( "aria-expanded" ) !== "true" );
    setTimeout( () => map.resize(), 50 );
} );

fetch( `${ BASE }data/zips.json` ).then( ( r ) => r.json() ).then( ( d ) => {
    data = d;
    index = Object.entries( d.zips ).map( ( [ z, r ] ) => [ z, r[5].toLowerCase(), r[6], r[5], r[3] ] )
        .sort( ( a, b ) => b[4] - a[4] );
    readHash();
    sync();
    if ( state.zip && !initialHash.includes( "map=" ) ) {
        const [ w, s, e, n ] = d.zips[ state.zip ][2];
        map.fitBounds( [ [ w, s ], [ e, n ] ], { padding: 60, maxZoom: 15, duration: 0 } );
    }
} );
