import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist/maplibre-gl.mjs";
import { PMTiles, Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm";

const BASE = new URL( ".", import.meta.url ).href;
const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const POINT_ZOOM = 12;
const HALVES = [ "w", "e" ];
const US = [ [ -125.5, 24 ], [ -66.5, 49.5 ] ];
const UNSPEC = 0;
const MIN_POP = 500;
const MIN_COUNT = 5;

const state = { view: "dots", g: null, g2: null, zip: null, compare: false };
const initialHash = location.hash;
let data = null;
let index = [];
let heatMax = 1000;
let pointIntensity = 1;

const protocol = new Protocol();
maplibregl.addProtocol( "pmtiles", protocol.tile );

/* Servers without HTTP range support (python -m http.server, some static hosts) can't
   byte-serve PMTiles, so fall back to loading each archive whole into memory. */
class MemorySource {
    constructor( key, buf ) { this.key = key; this.buf = buf; }
    getKey() { return this.key; }
    async getBytes( offset, length ) { return { data: this.buf.slice( offset, offset + length ) }; }
}
const ranges = fetch( `${ BASE }data/overview.pmtiles`, { headers: { Range: "bytes=0-15" } } )
    .then( ( r ) => r.status === 206 ).catch( () => false );
async function tileUrl( name ) {
    const url = `${ BASE }data/${ name }.pmtiles`;
    if ( await ranges ) return `pmtiles://${ url }`;
    const buf = await fetch( url ).then( ( r ) => r.arrayBuffer() );
    protocol.add( new PMTiles( new MemorySource( url, buf ) ) );
    return `pmtiles://${ url }`;
}

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

const cssVar = ( n ) => getComputedStyle( document.documentElement ).getPropertyValue( n ).trim();
const accent = () => cssVar( "--accent" );
const compareColor = () => cssVar( "--compare" );
const paper = () => cssVar( "--paper" );

/* ---------- expressions ---------- */

const cnt = ( g ) => [ "coalesce", [ "get", "c" + g ], 0 ];

function countExpr() {
    if ( state.compare && state.g != null && state.g2 != null ) return [ "+", cnt( state.g ), cnt( state.g2 ) ];
    return state.g == null ? [ "coalesce", [ "get", "point_count" ], 1 ] : cnt( state.g );
}

const comparing = () => state.compare && state.g != null && state.g2 != null;

function labelExpr( c ) {
    return [ "case",
        [ ">=", c, 10000 ], [ "concat", [ "to-string", [ "round", [ "/", c, 1000 ] ] ], "k" ],
        [ ">=", c, 1000 ], [ "concat", [ "to-string", [ "/", [ "round", [ "/", c, 100 ] ], 10 ] ], "k" ],
        [ "to-string", c ] ];
}

function clusterPaint( c ) {
    const base = {
        color: accent(),
        opacity: [ "interpolate", [ "linear" ], [ "sqrt", c ], 1, 0.9, 30, 0.75, 900, 0.6 ],
        radius: [ "interpolate", [ "linear" ], [ "sqrt", c ], 1, 3.5, 1.41, 8, 5.5, 12, 17.3, 17, 60, 22, 245, 27, 1000, 31 ],
        stroke: [ "step", c, 0, 2, 1.5 ],
        text: [ "interpolate", [ "linear" ], [ "sqrt", c ], 1.41, 10, 17.3, 12, 245, 14 ],
    };
    if ( comparing() ) {
        const a = cnt( state.g ), b = cnt( state.g2 );
        const margin = [ "/", [ "abs", [ "-", a, b ] ], [ "max", c, 1 ] ];
        base.color = [ "case", [ ">=", a, b ], accent(), compareColor() ];
        base.opacity = [ "interpolate", [ "linear" ], margin, 0, 0.35, 0.6, 0.95 ];
    }
    return base;
}

function pointColor() {
    return comparing() ? [ "case", [ "==", [ "get", "g" ], state.g ], accent(), compareColor() ] : accent();
}

function heatColor() {
    const a = accent();
    return [ "interpolate", [ "linear" ], [ "heatmap-density" ],
        0, "rgba(0,0,0,0)", 0.15, dark.matches ? "rgba(224,112,124,0.25)" : "rgba(122,31,43,0.18)",
        0.4, a, 0.7, dark.matches ? "#ff9f6e" : "#c9532e", 1, dark.matches ? "#ffe9b0" : "#f2b705" ];
}

function heatLayer( id, source, layer, weight, zoom ) {
    return {
        id, type: "heatmap", source, "source-layer": layer, ...zoom,
        layout: { visibility: "none" },
        paint: {
            "heatmap-color": heatColor(),
            "heatmap-intensity": [ "interpolate", [ "linear" ], [ "zoom" ], 0, 1.6, 5, 2, 8, 2.8, 11, 3, 12, 1, 16, 1.8 ],
            "heatmap-opacity": 0.9,
            "heatmap-radius": [ "interpolate", [ "linear" ], [ "zoom" ], 0, 14, 4, 22, 8, 30, 11, 34, 12, 22, 16, 36 ],
            "heatmap-weight": weight,
        },
    };
}

/* Relative scale: the brightest cluster currently on screen maps to 1. */
function heatWeight( c, max ) {
    const m = Math.sqrt( Math.max( max, 4 ) );
    return [ "interpolate", [ "linear" ], [ "sqrt", c ], 0, 0, m * 0.05, 0.06, m * 0.15, 0.18, m * 0.35, 0.45, m * 0.7, 0.85, m, 1 ];
}

function pointFilter( withCompare = true ) {
    const f = [ "all" ];
    if ( withCompare && comparing() ) f.push( [ "in", [ "get", "g" ], [ "literal", [ state.g, state.g2 ] ] ] );
    else if ( state.g != null ) f.push( [ "==", [ "get", "g" ], state.g ] );
    if ( state.zip ) f.push( [ "==", [ "get", "z" ], state.zip ] );
    return f;
}

/* ---------- per-capita choropleth ---------- */

function capitaMetric() {
    if ( comparing() ) return "share";
    return state.g == null ? "density" : "lq";
}

function capitaValues() {
    const metric = capitaMetric();
    const T = data.totals.reduce( ( a, b ) => a + b, 0 );
    const natShare = state.g != null ? data.totals[ state.g ] / T : 0;
    const vals = {};
    for ( const [ z, r ] of Object.entries( data.zips ) ) {
        const t = r[3], pop = r[7], c = r[4];
        if ( metric === "density" ) {
            if ( pop < MIN_POP ) continue;
            vals[ z ] = t / pop * 1e4;
        } else if ( metric === "lq" ) {
            if ( t < MIN_COUNT * 4 ) continue;
            vals[ z ] = Math.log2( Math.max( c[ state.g ] / t, 0.002 ) / natShare );
        } else {
            const a = c[ state.g ], b = c[ state.g2 ];
            if ( a + b < MIN_COUNT ) continue;
            vals[ z ] = a / ( a + b );
        }
    }
    return { metric, vals };
}

function quantile( sorted, q ) {
    const i = ( sorted.length - 1 ) * q;
    const lo = Math.floor( i ), hi = Math.ceil( i );
    return sorted[ lo ] + ( sorted[ hi ] - sorted[ lo ] ) * ( i - lo );
}

let capitaDomain = [ 0, 1 ];
function applyCapita() {
    const { metric, vals } = capitaValues();
    const all = Object.values( vals ).sort( ( a, b ) => a - b );
    if ( metric === "density" ) capitaDomain = [ 0, quantile( all, 0.5 ), quantile( all, 0.97 ) ];
    else if ( metric === "lq" ) { const m = Math.min( 2, Math.max( Math.abs( quantile( all, 0.03 ) ), Math.abs( quantile( all, 0.97 ) ) ) ); capitaDomain = [ -m, 0, m ]; }
    else capitaDomain = [ 0, 0.5, 1 ];
    map.removeFeatureState( { source: "zcta", sourceLayer: "zcta" } );
    for ( const [ z, v ] of Object.entries( vals ) ) map.setFeatureState( { source: "zcta", sourceLayer: "zcta", id: Number( z ) }, { v } );
    const [ lo, mid, hi ] = capitaDomain;
    const ramp = capitaRamp( metric );
    map.setPaintProperty( "zcta-fill", "fill-color", [ "case", [ "==", [ "feature-state", "v" ], null ], "rgba(0,0,0,0)",
        [ "interpolate", [ "linear" ], [ "feature-state", "v" ], lo, ramp[0], mid, ramp[1], hi, ramp[2] ] ] );
    document.documentElement.style.setProperty( "--ramp-lo", ramp[0] );
    document.documentElement.style.setProperty( "--ramp-mid", ramp[1] );
    document.documentElement.style.setProperty( "--ramp-hi", ramp[2] );
}

function capitaRamp( metric ) {
    const a = accent(), b = compareColor();
    const mid = dark.matches ? "rgba(239,232,220,0.18)" : "rgba(31,26,23,0.08)";
    if ( metric === "density" ) return [ dark.matches ? "rgba(224,112,124,0.08)" : "rgba(122,31,43,0.06)", dark.matches ? "rgba(224,112,124,0.5)" : "rgba(122,31,43,0.42)", a ];
    if ( metric === "lq" ) return [ b, mid, a ];
    return [ b, mid, a ];
}

/* ---------- layers ---------- */

async function decorate() {
    const c = countExpr();
    const cp = clusterPaint( c );
    const [ overview, heat, zcta, ...halves ] = await Promise.all( [ tileUrl( "overview" ), tileUrl( "heat" ), tileUrl( "zcta" ), ...HALVES.map( ( h ) => tileUrl( "points_" + h ) ) ] );
    map.addSource( "overview", { type: "vector", url: overview } );
    map.addSource( "heat", { type: "vector", url: heat } );
    map.addSource( "zcta", { type: "vector", url: zcta } );
    HALVES.forEach( ( h, i ) => map.addSource( "points-" + h, { type: "vector", url: halves[ i ] } ) );

    const firstSymbol = map.getStyle().layers.find( ( l ) => l.type === "symbol" )?.id;
    map.addLayer( {
        id: "zcta-fill", type: "fill", source: "zcta", "source-layer": "zcta",
        layout: { visibility: "none" },
        paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0.85 },
    }, firstSymbol );
    map.addLayer( {
        id: "zcta-line", type: "line", source: "zcta", "source-layer": "zcta", minzoom: 8,
        layout: { visibility: "none" },
        paint: { "line-color": paper(), "line-opacity": 0.6, "line-width": 0.6 },
    }, firstSymbol );
    map.addLayer( {
        id: "zcta-hit", type: "fill", source: "zcta", "source-layer": "zcta", minzoom: 7,
        paint: { "fill-color": "rgba(0,0,0,0)" },
    }, firstSymbol );
    map.addLayer( {
        id: "zcta-selected", type: "line", source: "zcta", "source-layer": "zcta",
        filter: [ "==", [ "get", "z" ], "" ],
        paint: { "line-color": accent(), "line-dasharray": [ 2, 1.5 ], "line-width": [ "interpolate", [ "linear" ], [ "zoom" ], 8, 1.5, 14, 3 ] },
    } );

    map.addLayer( {
        id: "clusters", type: "circle", source: "overview", "source-layer": "clusters", maxzoom: POINT_ZOOM,
        filter: [ ">", c, 0 ],
        paint: {
            "circle-color": cp.color,
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
            "circle-color": pointColor(),
            "circle-radius": [ "interpolate", [ "linear" ], [ "zoom" ], 6, 2, 11, 4 ],
            "circle-stroke-color": paper(),
            "circle-stroke-width": 1,
        },
    } );
    map.addLayer( heatLayer( "heat-clusters", "heat", "heat", heatWeight( c, heatMax ), { maxzoom: POINT_ZOOM } ) );
    map.addLayer( heatLayer( "heat-zip", "overview", "zippoints", 0.15, { maxzoom: POINT_ZOOM } ) );
    for ( const h of HALVES ) map.addLayer( heatLayer( "heat-" + h, "points-" + h, "points", 0.15, { minzoom: POINT_ZOOM } ) );
    for ( const h of HALVES ) map.addLayer( {
        id: "points-" + h, type: "circle", source: "points-" + h, "source-layer": "points", minzoom: POINT_ZOOM,
        filter: pointFilter(),
        paint: {
            "circle-color": pointColor(),
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
    const heat = state.view === "heat";
    const capita = state.view === "capita";
    const dots = state.view === "dots";
    const show = ( id, on ) => map.setLayoutProperty( id, "visibility", on ? "visible" : "none" );

    map.setFilter( "clusters", [ ">", c, 0 ] );
    map.setFilter( "cluster-labels", [ ">=", c, 2 ] );
    map.setPaintProperty( "clusters", "circle-color", cp.color );
    map.setPaintProperty( "clusters", "circle-radius", cp.radius );
    map.setPaintProperty( "clusters", "circle-opacity", cp.opacity );
    map.setPaintProperty( "clusters", "circle-stroke-width", cp.stroke );
    map.setLayoutProperty( "cluster-labels", "text-field", labelExpr( c ) );
    map.setLayoutProperty( "cluster-labels", "text-size", cp.text );
    show( "clusters", dots && !zipMode );
    show( "cluster-labels", dots && !zipMode );
    show( "zippoints", dots && zipMode );
    show( "heat-clusters", heat && !zipMode );
    show( "heat-zip", heat && zipMode );
    show( "zcta-fill", capita );
    show( "zcta-line", capita );
    map.setFilter( "zippoints", pointFilter() );
    map.setPaintProperty( "zippoints", "circle-color", pointColor() );
    map.setFilter( "heat-clusters", [ ">", c, 0 ] );
    map.setFilter( "heat-zip", pointFilter() );
    map.setPaintProperty( "heat-clusters", "heatmap-weight", heatWeight( c, heatMax ) );
    for ( const h of HALVES ) {
        map.setFilter( "points-" + h, pointFilter() );
        map.setFilter( "heat-" + h, pointFilter() );
        map.setPaintProperty( "points-" + h, "circle-color", pointColor() );
        show( "points-" + h, !heat );
        show( "heat-" + h, heat );
    }
    map.setFilter( "zcta-selected", [ "==", [ "get", "z" ], state.zip || "" ] );
    if ( capita ) applyCapita();
    if ( heat ) rescaleHeat();
    updateLegend();
}

/* Relative heat: rescale to what is on screen after each move. */
function rescaleHeat() {
    if ( state.view !== "heat" || !map.getLayer( "heat-clusters" ) ) return;
    if ( map.getZoom() < POINT_ZOOM ) {
        if ( state.zip ) return;
        const feats = map.queryRenderedFeatures( { layers: [ "heat-clusters" ] } );
        let max = 0;
        for ( const f of feats ) {
            const p = f.properties;
            const v = comparing() ? ( p[ "c" + state.g ] || 0 ) + ( p[ "c" + state.g2 ] || 0 )
                : state.g == null ? ( p.point_count || 1 ) : ( p[ "c" + state.g ] || 0 );
            if ( v > max ) max = v;
        }
        if ( max > 0 && Math.abs( Math.log( max / heatMax ) ) > 0.15 ) {
            heatMax = max;
            map.setPaintProperty( "heat-clusters", "heatmap-weight", heatWeight( countExpr(), heatMax ) );
        }
    } else {
        const n = HALVES.reduce( ( s, h ) => s + map.queryRenderedFeatures( { layers: [ "heat-" + h ] } ).length, 0 );
        const target = Math.min( 3, Math.max( 0.4, 1.1 * Math.sqrt( 1200 / Math.max( n, 1 ) ) ) );
        if ( Math.abs( target - pointIntensity ) > 0.15 ) {
            pointIntensity = target;
            const expr = [ "interpolate", [ "linear" ], [ "zoom" ], 12, pointIntensity, 16, pointIntensity * 1.8 ];
            for ( const h of HALVES ) map.setPaintProperty( "heat-" + h, "heatmap-intensity", expr );
            map.setPaintProperty( "heat-zip", "heatmap-intensity", expr );
        }
    }
}

let rescaleTimer;
map.on( "moveend", () => { clearTimeout( rescaleTimer ); rescaleTimer = setTimeout( rescaleHeat, 120 ); } );
map.on( "idle", () => { if ( state.view === "heat" && heatMax === 1000 ) rescaleHeat(); } );

/* ---------- legend ---------- */

const fmt = new Intl.NumberFormat( "en-US" );
const compact = new Intl.NumberFormat( "en-US", { notation: "compact", maximumFractionDigits: 1 } );
const fmt1 = new Intl.NumberFormat( "en-US", { maximumFractionDigits: 1 } );

function updateLegend() {
    const z = map.getZoom();
    const el = document.getElementById( "legendText" );
    const ramp = document.getElementById( "legendRamp" );
    const dot = document.getElementById( "legendDot" );
    const legend = document.getElementById( "legend" );
    const capita = state.view === "capita";
    ramp.hidden = !capita;
    dot.hidden = capita || ( comparing() && state.view === "dots" );
    legend.classList.toggle( "legend--heat", state.view === "heat" );
    const where = state.zip ? ` in ${ state.zip }` : "";
    const name = ( g ) => data.groups[ g ];
    if ( capita ) {
        const metric = capitaMetric();
        const [ lo, , hi ] = capitaDomain;
        if ( metric === "density" ) {
            el.textContent = "Restaurants per 10,000 residents, by ZIP";
            document.getElementById( "legendLo" ).textContent = "0";
            document.getElementById( "legendHi" ).textContent = fmt1.format( hi ) + "+";
        } else if ( metric === "lq" ) {
            el.textContent = `${ name( state.g ) } share vs. national average, by ZIP`;
            document.getElementById( "legendLo" ).textContent = "÷" + fmt1.format( 2 ** hi );
            document.getElementById( "legendHi" ).textContent = "×" + fmt1.format( 2 ** hi );
        } else {
            el.textContent = `${ name( state.g ) } vs. ${ name( state.g2 ) }, share by ZIP`;
            document.getElementById( "legendLo" ).textContent = name( state.g2 );
            document.getElementById( "legendHi" ).textContent = name( state.g );
        }
    } else if ( state.view === "heat" ) {
        el.textContent = `Density${ where }, scaled to what is on screen`;
    } else if ( comparing() ) {
        el.innerHTML = `<i class="sw sw-a"></i>${ esc( name( state.g ) ) } <i class="sw sw-b"></i>${ esc( name( state.g2 ) ) }${ z >= POINT_ZOOM || state.zip ? "" : ". Color is which leads, opacity is by how much" }`;
    } else if ( state.zip ) el.textContent = `Each dot is one restaurant in ${ state.zip }`;
    else if ( z >= POINT_ZOOM ) el.textContent = "Each dot is one restaurant";
    else el.textContent = "Circles are counts. Zoom in for individual restaurants";
}

map.on( "style.load", decorate );
map.on( "zoomend", updateLegend );

/* ---------- map interaction ---------- */

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

function zipPopup( e, z ) {
    const r = data.zips[ z ];
    if ( !r ) { popup.remove(); return; }
    const pop = r[7] ? `${ compact.format( r[7] ) } residents · ` : "";
    let line = `${ pop }${ fmt.format( r[3] ) } restaurants`;
    if ( state.view === "capita" ) {
        const st = map.getFeatureState( { source: "zcta", sourceLayer: "zcta", id: Number( z ) } );
        if ( st.v != null ) {
            const m = capitaMetric();
            line += m === "density" ? ` · ${ fmt1.format( st.v ) } per 10k` : m === "lq" ? ` · ${ fmt1.format( 2 ** st.v ) }× national` : ` · ${ Math.round( st.v * 100 ) }% ${ data.groups[ state.g ] }`;
        }
    }
    popup.setLngLat( e.lngLat ).setHTML( `<div class="popup"><h3>${ z } <span class="tag">${ esc( [ r[5], r[6] ].filter( Boolean ).join( ", " ) ) }</span></h3><p>${ line }</p></div>` ).addTo( map );
}
map.on( "mousemove", "zcta-hit", ( e ) => {
    if ( map.getZoom() >= POINT_ZOOM && state.view !== "capita" ) return;
    const pts = HALVES.flatMap( ( h ) => map.queryRenderedFeatures( e.point, { layers: [ "points-" + h ] } ) );
    if ( pts.length ) return;
    zipPopup( e, e.features[0].properties.z );
} );
map.on( "mouseleave", "zcta-hit", () => popup.remove() );

map.on( "click", ( e ) => {
    const pick = ( layers ) => map.queryRenderedFeatures( e.point, { layers: layers.filter( ( l ) => map.getLayer( l ) ) } )[0];
    const cl = state.view === "dots" && !state.zip && map.getZoom() < POINT_ZOOM && pick( [ "clusters" ] );
    if ( cl ) {
        map.easeTo( { center: cl.geometry.coordinates, zoom: Math.min( map.getZoom() + 2.5, POINT_ZOOM + 1 ) } );
        return;
    }
    const zp = state.view === "dots" && state.zip && map.getZoom() < POINT_ZOOM && pick( [ "zippoints" ] );
    if ( zp ) {
        map.easeTo( { center: zp.geometry.coordinates, zoom: POINT_ZOOM + 2 } );
        return;
    }
    if ( pick( HALVES.map( ( h ) => "points-" + h ) ) ) return;
    const zc = pick( [ "zcta-hit" ] );
    if ( zc && data.zips[ zc.properties.z ] ) {
        state.zip === zc.properties.z ? clearZip() : selectZip( zc.properties.z, false );
    }
} );

function esc( s ) {
    return String( s ?? "" ).replace( /[&<>"]/g, ( ch ) => ( { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ ch ] ) );
}

dark.addEventListener( "change", ( e ) => map.setStyle( e.matches ? STYLES.dark : STYLES.light ) );

/* ---------- rail ---------- */

const list = document.getElementById( "cuisines" );

function renderCuisines() {
    const counts = state.zip ? data.zips[ state.zip ][4] : data.totals;
    const total = counts.reduce( ( a, b ) => a + b, 0 );
    const order = counts.map( ( n, i ) => i ).filter( ( i ) => i !== UNSPEC ).sort( ( a, b ) => counts[ b ] - counts[ a ] );
    order.push( UNSPEC );
    const max = counts[ order[0] ] || 1;
    const ab = ( i ) => state.compare ? ( i === state.g ? "a" : i === state.g2 ? "b" : "" ) : "";
    const row = ( i, name, n, share, cls = "" ) => `
        <li data-g="${ i }" data-ab="${ ab( i ) }" role="button" aria-pressed="${ !state.compare && state.g === ( i === "" ? null : i ) }" class="${ cls }">
            <span class="name">${ name }<span class="badge">${ ab( i ).toUpperCase() }</span></span>
            <span class="count">${ fmt.format( n ) }</span>
            <span class="bar"><i style="width:${ ( share * 100 ).toFixed( 1 ) }%"></i></span>
        </li>`;
    list.innerHTML = ( state.compare ? "" : row( "", "All cuisines", total, 1, "all" ) ) + order.filter( ( i ) => counts[ i ] > 0 || !state.zip )
        .map( ( i ) => row( i, data.groups[ i ], counts[ i ], counts[ i ] / max, i === UNSPEC ? "unspecified" : "" ) ).join( "" );
    document.getElementById( "total" ).textContent = compact.format( data.totals.reduce( ( a, b ) => a + b, 0 ) );
    document.getElementById( "listTitle" ).textContent = state.compare ? "Pick two to compare" : "Cuisine";
    document.getElementById( "compare" ).setAttribute( "aria-pressed", state.compare );
}

list.addEventListener( "click", ( e ) => {
    const li = e.target.closest( "li" );
    if ( !li ) return;
    const g = li.dataset.g === "" ? null : Number( li.dataset.g );
    if ( state.compare ) {
        if ( g == null ) return;
        if ( g === state.g ) { state.g = state.g2; state.g2 = null; }
        else if ( g === state.g2 ) state.g2 = null;
        else if ( state.g == null ) state.g = g;
        else if ( state.g2 == null ) state.g2 = g;
        else { state.g = state.g2; state.g2 = g; }
    } else {
        state.g = state.g === g ? null : g;
    }
    sync();
} );

document.getElementById( "compare" ).addEventListener( "click", () => {
    state.compare = !state.compare;
    if ( !state.compare ) state.g2 = null;
    sync();
} );

document.getElementById( "views" ).addEventListener( "click", ( e ) => {
    const b = e.target.closest( "button" );
    if ( !b ) return;
    state.view = b.dataset.view;
    heatMax = 1000;
    sync();
} );

function renderViews() {
    for ( const b of document.querySelectorAll( "#views button" ) ) b.setAttribute( "aria-checked", b.dataset.view === state.view );
}

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

function selectZip( zip, fly = true ) {
    const r = data.zips[ zip ];
    if ( !r ) return;
    state.zip = zip;
    matches = []; renderSuggest();
    input.value = zip;
    input.blur();
    sync();
    if ( !fly ) return;
    const [ w, s, e, n ] = r[2];
    map.fitBounds( [ [ w, s ], [ e, n ] ], { padding: 60, maxZoom: 15, duration: 1200 } );
}

function clearZip() {
    state.zip = null;
    input.value = "";
    sync();
}
document.getElementById( "clearZip" ).addEventListener( "click", clearZip );

function renderScope() {
    const el = document.getElementById( "scope" );
    el.hidden = !state.zip;
    if ( !state.zip ) return;
    const r = data.zips[ state.zip ];
    document.getElementById( "scopeZip" ).textContent = state.zip;
    document.getElementById( "scopePlace" ).textContent = [ r[5], r[6] ].filter( Boolean ).join( ", " ) + ( r[7] ? ` · ${ compact.format( r[7] ) } residents` : "" );
}

/* ---------- state ---------- */

function readHash() {
    const h = new URLSearchParams( location.hash.slice( 1 ) );
    const g = h.get( "g" ), g2 = h.get( "g2" );
    state.g = g != null && data.groups[ g ] ? Number( g ) : null;
    state.g2 = g2 != null && data.groups[ g2 ] ? Number( g2 ) : null;
    state.compare = state.g2 != null || h.get( "compare" ) === "1";
    const zip = h.get( "zip" );
    state.zip = zip && data.zips[ zip ] ? zip : null;
    const v = h.get( "view" );
    state.view = [ "heat", "capita" ].includes( v ) ? v : "dots";
    if ( state.zip ) input.value = state.zip;
}

function writeHash() {
    const h = new URLSearchParams( location.hash.slice( 1 ) );
    const set = ( k, v ) => v == null || v === false || v === "" ? h.delete( k ) : h.set( k, v );
    set( "g", state.g );
    set( "g2", state.g2 );
    set( "compare", state.compare && state.g2 == null ? "1" : null );
    set( "zip", state.zip );
    set( "view", state.view === "dots" ? null : state.view );
    history.replaceState( null, "", "#" + h.toString() );
}

function sync() {
    renderViews();
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
