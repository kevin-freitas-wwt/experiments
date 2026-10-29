import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist/maplibre-gl.mjs";
import { PMTiles, Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm";
import { VectorTile } from "https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@3.0.0/+esm";
import { PbfReader } from "https://cdn.jsdelivr.net/npm/pbf@5.1.2/+esm";

const BASE = new URL( ".", import.meta.url ).href;
const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const POINT_ZOOM = 12;
const FADE = [ 11.8, 12.6 ];
const HALVES = [ "w", "e" ];
const US = [ [ -125.5, 24 ], [ -66.5, 49.5 ] ];
const UNSPEC = 0;
const MIN_POP = 500;
const MIN_COUNT = 5;
const MILE = 1609.344;
const REPO = "https://github.com/kevin-freitas-wwt/experiments";

const state = { view: "dots", g: null, g2: null, zip: null, zip2: null, compare: false, lens: null, pin: null, radius: 1 };
const initialHash = location.hash;
let data = null;
let index = [];
let heatMax = 1000;
let pointIntensity = 1;
let pendingZip2 = false;
let pinning = false;
const archives = {};

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
    if ( !archives[ name ] ) {
        archives[ name ] = ( await ranges ) ? new PMTiles( url )
            : new PMTiles( new MemorySource( url, await fetch( url ).then( ( r ) => r.arrayBuffer() ) ) );
        protocol.add( archives[ name ] );
    }
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
    canvasContextAttributes: { preserveDrawingBuffer: true },
} );
map.addControl( new maplibregl.NavigationControl( { showCompass: false } ), "top-right" );
const geo = new maplibregl.GeolocateControl( { positionOptions: { enableHighAccuracy: true }, showUserLocation: true, fitBoundsOptions: { maxZoom: 13 } } );
map.addControl( geo, "top-right" );
geo.on( "geolocate", ( e ) => placePin( [ e.coords.longitude, e.coords.latitude ], state.radius, "Near you" ) );
geo.on( "error", () => toast( "Location unavailable. Drop a pin instead." ) );

const cssVar = ( n ) => getComputedStyle( document.documentElement ).getPropertyValue( n ).trim();
const accent = () => cssVar( "--accent" );
const compareColor = () => cssVar( "--compare" );
const paper = () => cssVar( "--paper" );

/* ---------- expressions ---------- */

const cnt = ( g ) => [ "coalesce", [ "get", "c" + g ], 0 ];
const comparing = () => state.compare && state.g != null && state.g2 != null;
const chainLens = () => state.lens === "chains";
const zipCompare = () => !!( state.zip && state.zip2 );

function countExpr() {
    if ( comparing() ) return [ "+", cnt( state.g ), cnt( state.g2 ) ];
    return state.g == null ? [ "coalesce", [ "get", "point_count" ], 1 ] : cnt( state.g );
}

function labelExpr( c ) {
    return [ "case",
        [ ">=", c, 10000 ], [ "concat", [ "to-string", [ "round", [ "/", c, 1000 ] ] ], "k" ],
        [ ">=", c, 1000 ], [ "concat", [ "to-string", [ "/", [ "round", [ "/", c, 100 ] ], 10 ] ], "k" ],
        [ "to-string", c ] ];
}

const fadeOut = ( expr ) => [ "interpolate", [ "linear" ], [ "zoom" ], FADE[0], expr, FADE[1], 0 ];
const fadeIn = ( expr ) => [ "interpolate", [ "linear" ], [ "zoom" ], POINT_ZOOM, [ "*", expr, 0.15 ], FADE[1], expr ];

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
        base.color = [ "case", [ ">=", a, b ], accent(), compareColor() ];
        base.opacity = [ "interpolate", [ "linear" ], [ "/", [ "abs", [ "-", a, b ] ], [ "max", c, 1 ] ], 0, 0.35, 0.6, 0.95 ];
    } else if ( chainLens() && state.g == null ) {
        const share = [ "/", [ "coalesce", [ "get", "k" ], 0 ], [ "max", c, 1 ] ];
        base.color = [ "interpolate", [ "linear" ], share, 0.05, accent(), 0.21, dark.matches ? "#7d6f75" : "#9a8a90", 0.45, compareColor() ];
        base.opacity = 0.9;
    }
    return base;
}

function pointColor() {
    if ( zipCompare() ) return [ "case", [ "==", [ "get", "z" ], state.zip ], accent(), compareColor() ];
    if ( comparing() ) return [ "case", [ "==", [ "get", "g" ], state.g ], accent(), compareColor() ];
    if ( chainLens() ) return [ "case", [ "==", [ "coalesce", [ "get", "k" ], 0 ], 1 ], compareColor(), accent() ];
    return accent();
}

function heatColor() {
    const a = accent();
    return [ "interpolate", [ "linear" ], [ "heatmap-density" ],
        0, "rgba(0,0,0,0)", 0.15, dark.matches ? "rgba(224,112,124,0.25)" : "rgba(122,31,43,0.18)",
        0.4, a, 0.7, dark.matches ? "#ff9f6e" : "#c9532e", 1, dark.matches ? "#ffe9b0" : "#f2b705" ];
}

function heatLayer( id, source, layer, weight, zoom, opacity ) {
    return {
        id, type: "heatmap", source, "source-layer": layer, ...zoom,
        layout: { visibility: "none" },
        paint: {
            "heatmap-color": heatColor(),
            "heatmap-intensity": [ "interpolate", [ "linear" ], [ "zoom" ], 0, 1.6, 5, 2, 8, 2.8, 11, 3, 12, 1, 16, 1.8 ],
            "heatmap-opacity": opacity,
            "heatmap-radius": [ "interpolate", [ "linear" ], [ "zoom" ], 0, 14, 4, 22, 8, 30, 11, 34, 12, 22, 16, 36 ],
            "heatmap-weight": weight,
        },
    };
}

function heatWeight( c, max ) {
    const m = Math.sqrt( Math.max( max, 4 ) );
    return [ "interpolate", [ "linear" ], [ "sqrt", c ], 0, 0, m * 0.05, 0.06, m * 0.15, 0.18, m * 0.35, 0.45, m * 0.7, 0.85, m, 1 ];
}

function pointFilter() {
    const f = [ "all" ];
    if ( comparing() ) f.push( [ "in", [ "get", "g" ], [ "literal", [ state.g, state.g2 ] ] ] );
    else if ( state.g != null ) f.push( [ "==", [ "get", "g" ], state.g ] );
    if ( zipCompare() ) f.push( [ "in", [ "get", "z" ], [ "literal", [ state.zip, state.zip2 ] ] ] );
    else if ( state.zip ) f.push( [ "==", [ "get", "z" ], state.zip ] );
    return f;
}

/* ---------- per-capita choropleth ---------- */

function capitaMetric() {
    if ( state.lens === "desert" ) return "desert";
    if ( zipCompare() ) return "zips";
    if ( comparing() ) return "share";
    if ( chainLens() ) return "indie";
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
            if ( pop >= MIN_POP ) vals[ z ] = t / pop * 1e4;
        } else if ( metric === "lq" ) {
            if ( t >= MIN_COUNT * 4 ) vals[ z ] = Math.log2( Math.max( c[ state.g ] / t, 0.002 ) / natShare );
        } else if ( metric === "share" ) {
            const a = c[ state.g ], b = c[ state.g2 ];
            if ( a + b >= MIN_COUNT ) vals[ z ] = a / ( a + b );
        } else if ( metric === "indie" ) {
            if ( t >= MIN_COUNT * 2 ) vals[ z ] = 1 - r[8] / t;
        } else if ( metric === "desert" ) {
            if ( state.g != null ) { if ( pop >= 2000 && c[ state.g ] === 0 ) vals[ z ] = 1; }
            else if ( pop >= 1000 ) vals[ z ] = t / pop * 1e4;
        } else if ( metric === "zips" ) {
            if ( z === state.zip ) vals[ z ] = 1; else if ( z === state.zip2 ) vals[ z ] = 0;
        }
    }
    if ( metric === "desert" ) {
        for ( const [ z, pop ] of Object.entries( data.empty ) ) if ( pop >= ( state.g != null ? 2000 : 1000 ) ) vals[ z ] = state.g != null ? 1 : 0;
        if ( state.g == null ) {
            const sorted = Object.values( vals ).sort( ( a, b ) => a - b );
            const cut = quantile( sorted, 0.1 );
            for ( const z of Object.keys( vals ) ) if ( vals[ z ] > cut ) delete vals[ z ]; else vals[ z ] = 1 - vals[ z ] / Math.max( cut, 0.01 );
        }
    }
    return { metric, vals };
}

function quantile( sorted, q ) {
    if ( !sorted.length ) return 0;
    const i = ( sorted.length - 1 ) * q;
    const lo = Math.floor( i ), hi = Math.ceil( i );
    return sorted[ lo ] + ( sorted[ hi ] - sorted[ lo ] ) * ( i - lo );
}

let capitaDomain = [ 0, 0.5, 1 ];
function applyCapita() {
    const { metric, vals } = capitaValues();
    const all = Object.values( vals ).sort( ( a, b ) => a - b );
    if ( metric === "density" ) capitaDomain = [ 0, quantile( all, 0.5 ), quantile( all, 0.97 ) ];
    else if ( metric === "lq" ) { const m = Math.min( 2, Math.max( Math.abs( quantile( all, 0.03 ) ), Math.abs( quantile( all, 0.97 ) ), 0.5 ) ); capitaDomain = [ -m, 0, m ]; }
    else if ( metric === "indie" ) capitaDomain = [ quantile( all, 0.03 ), quantile( all, 0.5 ), quantile( all, 0.97 ) ];
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
    const soft = dark.matches ? "rgba(224,112,124,0.08)" : "rgba(122,31,43,0.06)";
    const half = dark.matches ? "rgba(224,112,124,0.5)" : "rgba(122,31,43,0.42)";
    if ( metric === "density" ) return [ soft, half, a ];
    if ( metric === "desert" ) return state.g != null ? [ a, a, a ] : [ half, dark.matches ? "#ff9f6e" : "#c9532e", dark.matches ? "#ffe9b0" : "#f2b705" ];
    if ( metric === "indie" ) return [ b, mid, a ];
    return [ b, mid, a ];
}

/* ---------- layers ---------- */

async function decorate() {
    const c = countExpr();
    const cp = clusterPaint( c );
    const [ overview, heat, zcta, words, ...halves ] = await Promise.all( [ "overview", "heat", "zcta", "words", ...HALVES.map( ( h ) => "points_" + h ) ].map( tileUrl ) );
    map.addSource( "overview", { type: "vector", url: overview } );
    map.addSource( "heat", { type: "vector", url: heat } );
    map.addSource( "zcta", { type: "vector", url: zcta } );
    map.addSource( "words", { type: "vector", url: words } );
    HALVES.forEach( ( h, i ) => map.addSource( "points-" + h, { type: "vector", url: halves[ i ] } ) );
    map.addSource( "ring", { type: "geojson", data: ringGeoJSON() } );

    const firstSymbol = map.getStyle().layers.find( ( l ) => l.type === "symbol" )?.id;
    map.addLayer( { id: "zcta-fill", type: "fill", source: "zcta", "source-layer": "zcta", layout: { visibility: "none" },
        paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0.85 } }, firstSymbol );
    map.addLayer( { id: "zcta-line", type: "line", source: "zcta", "source-layer": "zcta", minzoom: 8, layout: { visibility: "none" },
        paint: { "line-color": paper(), "line-opacity": 0.6, "line-width": 0.6 } }, firstSymbol );
    map.addLayer( { id: "zcta-hit", type: "fill", source: "zcta", "source-layer": "zcta", minzoom: 7, paint: { "fill-color": "rgba(0,0,0,0)" } }, firstSymbol );
    map.addLayer( { id: "words", type: "circle", source: "words", "source-layer": "words", maxzoom: POINT_ZOOM, paint: { "circle-radius": 0, "circle-opacity": 0 } }, firstSymbol );
    map.addLayer( { id: "zcta-selected", type: "line", source: "zcta", "source-layer": "zcta", filter: [ "==", [ "get", "z" ], "" ],
        paint: { "line-color": [ "case", [ "==", [ "get", "z" ], state.zip || "" ], accent(), compareColor() ], "line-dasharray": [ 2, 1.5 ], "line-width": [ "interpolate", [ "linear" ], [ "zoom" ], 8, 1.5, 14, 3 ] } } );
    map.addLayer( { id: "ring-fill", type: "fill", source: "ring", paint: { "fill-color": accent(), "fill-opacity": 0.06 } } );
    map.addLayer( { id: "ring-line", type: "line", source: "ring", paint: { "line-color": accent(), "line-width": 2, "line-dasharray": [ 3, 2 ] } } );

    map.addLayer( { id: "clusters", type: "circle", source: "overview", "source-layer": "clusters", maxzoom: FADE[1], filter: [ ">", c, 0 ],
        paint: { "circle-color": cp.color, "circle-opacity": fadeOut( cp.opacity ), "circle-radius": cp.radius, "circle-stroke-color": paper(), "circle-stroke-opacity": fadeOut( 1 ), "circle-stroke-width": cp.stroke } } );
    map.addLayer( { id: "cluster-labels", type: "symbol", source: "overview", "source-layer": "clusters", maxzoom: FADE[1], filter: [ ">=", c, 2 ],
        layout: { "text-allow-overlap": true, "text-field": labelExpr( c ), "text-font": [ "Noto Sans Regular" ], "text-size": cp.text },
        paint: { "text-color": "#fff", "text-opacity": fadeOut( 1 ) } } );
    map.addLayer( { id: "zippoints", type: "circle", source: "overview", "source-layer": "zippoints", maxzoom: FADE[1], filter: pointFilter(), layout: { visibility: "none" },
        paint: { "circle-color": pointColor(), "circle-opacity": fadeOut( 1 ), "circle-radius": [ "interpolate", [ "linear" ], [ "zoom" ], 6, 2, 11, 4 ], "circle-stroke-color": paper(), "circle-stroke-opacity": fadeOut( 1 ), "circle-stroke-width": 1 } } );
    map.addLayer( heatLayer( "heat-clusters", "heat", "heat", heatWeight( c, heatMax ), { maxzoom: FADE[1] }, fadeOut( 0.9 ) ) );
    map.addLayer( heatLayer( "heat-zip", "overview", "zippoints", 0.15, { maxzoom: FADE[1] }, fadeOut( 0.9 ) ) );
    for ( const h of HALVES ) map.addLayer( heatLayer( "heat-" + h, "points-" + h, "points", 0.15, { minzoom: POINT_ZOOM }, fadeIn( 0.9 ) ) );
    for ( const h of HALVES ) map.addLayer( { id: "points-" + h, type: "circle", source: "points-" + h, "source-layer": "points", minzoom: POINT_ZOOM, filter: pointFilter(),
        paint: { "circle-color": pointColor(), "circle-opacity": fadeIn( 1 ), "circle-radius": [ "interpolate", [ "linear" ], [ "zoom" ], 12, 3, 16, 7 ], "circle-stroke-color": paper(), "circle-stroke-opacity": fadeIn( 1 ), "circle-stroke-width": 1 } } );
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
    map.setPaintProperty( "clusters", "circle-opacity", fadeOut( cp.opacity ) );
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
    const ring = ringGeoJSON().features[0];
    const dim = ring ? [ "case", [ "within", ring.geometry ], 1, 0.22 ] : 1;
    for ( const h of HALVES ) {
        map.setFilter( "points-" + h, pointFilter() );
        map.setFilter( "heat-" + h, pointFilter() );
        map.setPaintProperty( "points-" + h, "circle-color", pointColor() );
        map.setPaintProperty( "points-" + h, "circle-opacity", fadeIn( dim ) );
        map.setPaintProperty( "points-" + h, "circle-stroke-opacity", fadeIn( dim ) );
        show( "points-" + h, !heat );
        show( "heat-" + h, heat );
    }
    map.setFilter( "zcta-selected", [ "in", [ "get", "z" ], [ "literal", [ state.zip, state.zip2 ].filter( Boolean ) ] ] );
    map.setPaintProperty( "zcta-selected", "line-color", [ "case", [ "==", [ "get", "z" ], state.zip || "" ], accent(), compareColor() ] );
    map.getSource( "ring" )?.setData( ringGeoJSON() );
    if ( capita ) applyCapita();
    if ( heat ) rescaleHeat();
    updateLegend();
    updateNames();
}

/* Relative heat: rescale to what is on screen after each move. */
function rescaleHeat() {
    if ( state.view !== "heat" || !map.getLayer( "heat-clusters" ) ) return;
    if ( map.getZoom() < POINT_ZOOM ) {
        if ( state.zip ) return;
        let max = 0;
        for ( const f of map.queryRenderedFeatures( { layers: [ "heat-clusters" ] } ) ) {
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

let moveTimer;
map.on( "moveend", () => { clearTimeout( moveTimer ); moveTimer = setTimeout( () => { rescaleHeat(); updateNames(); }, 150 ); } );
map.on( "idle", () => { if ( state.view === "heat" && heatMax === 1000 ) rescaleHeat(); if ( namesStale ) updateNames(); } );

/* ---------- name clouds ---------- */

const STOP = new Set( [ "the", "and", "for", "with", "inc", "llc", "restaurant", "restaurants", "food", "foods", "cafe", "bar", "grill", "grille", "kitchen", "house", "place", "eatery", "shop", "store", "company", "center" ] );
let namesStale = true;
let nationalTotal = 0;

function updateNames() {
    if ( !data || !map.getLayer( "words" ) ) return;
    const el = document.getElementById( "names" );
    const z = map.getZoom();
    const local = new Map();
    let total = 0;
    if ( z >= POINT_ZOOM ) {
        for ( const h of HALVES ) for ( const f of map.queryRenderedFeatures( { layers: [ "points-" + h, "heat-" + h ].filter( ( l ) => map.getLayer( l ) && map.getLayoutProperty( l, "visibility" ) !== "none" ) } ) ) {
            for ( const w of new Set( ( f.properties.n || "" ).toLowerCase().match( /[a-z]{3,}/g ) || [] ) ) if ( !STOP.has( w ) ) { local.set( w, ( local.get( w ) || 0 ) + 1 ); total++; }
        }
    } else {
        for ( const f of map.queryRenderedFeatures( { layers: [ "words" ] } ) ) {
            let w; try { w = JSON.parse( f.properties.w ); } catch { continue; }
            for ( const [ k, v ] of Object.entries( w ) ) { local.set( k, ( local.get( k ) || 0 ) + v ); total += v; }
        }
    }
    namesStale = total === 0 && !map.areTilesLoaded();
    if ( total < 30 ) { el.hidden = true; return; }
    const minC = z >= POINT_ZOOM ? 2 : 5;
    const scored = [];
    for ( const [ w, c ] of local ) {
        const nat = data.words[ w ];
        if ( c < minC || !nat ) continue;
        const lift = ( c / total ) / ( nat / nationalTotal );
        scored.push( [ w, c, lift ] );
    }
    scored.sort( ( a, b ) => b[2] * Math.log( b[1] + 1 ) - a[2] * Math.log( a[1] + 1 ) );
    const top = scored.slice( 0, 18 );
    if ( !top.length ) { el.hidden = true; return; }
    const maxLift = Math.max( ...top.map( ( t ) => Math.log2( t[2] ) ), 1 );
    document.getElementById( "nameChips" ).innerHTML = top.map( ( [ w, c, lift ] ) =>
        `<span style="--lift:${ Math.max( 0, Math.min( 1, Math.log2( lift ) / maxLift ) ).toFixed( 2 ) }" title="${ fmt1.format( lift ) }× the national rate">${ esc( w ) }<b>${ fmt1.format( lift ) }×</b></span>` ).join( "" );
    document.getElementById( "namesHint" ).textContent = "ranked by lift vs. national";
    el.hidden = false;
}

/* ---------- legend ---------- */

const fmt = new Intl.NumberFormat( "en-US" );
const compact = new Intl.NumberFormat( "en-US", { notation: "compact", maximumFractionDigits: 1 } );
const fmt1 = new Intl.NumberFormat( "en-US", { maximumFractionDigits: 1 } );
const pct = ( v ) => Math.round( v * 100 ) + "%";

function updateLegend() {
    const z = map.getZoom();
    const el = document.getElementById( "legendText" );
    const ramp = document.getElementById( "legendRamp" );
    const dot = document.getElementById( "legendDot" );
    const capita = state.view === "capita";
    const two = ( comparing() || zipCompare() || chainLens() ) && !capita;
    ramp.hidden = !capita;
    dot.hidden = capita || two;
    document.getElementById( "legend" ).classList.toggle( "legend--heat", state.view === "heat" );
    const where = state.zip ? ` in ${ state.zip }` : "";
    const name = ( g ) => data.groups[ g ];
    const lo = document.getElementById( "legendLo" ), hi = document.getElementById( "legendHi" );
    const sw = ( a, b ) => `<i class="sw sw-a"></i>${ esc( a ) } <i class="sw sw-b"></i>${ esc( b ) }`;
    if ( capita ) {
        const metric = capitaMetric();
        const [ , , top ] = capitaDomain;
        if ( metric === "density" ) { el.textContent = "Restaurants per 10,000 residents, by ZIP"; lo.textContent = "0"; hi.textContent = fmt1.format( top ) + "+"; }
        else if ( metric === "lq" ) { el.textContent = `${ name( state.g ) } share vs. national average, by ZIP`; lo.textContent = "÷" + fmt1.format( 2 ** top ); hi.textContent = "×" + fmt1.format( 2 ** top ); }
        else if ( metric === "share" ) { el.textContent = `${ name( state.g ) } vs. ${ name( state.g2 ) }, share by ZIP`; lo.textContent = name( state.g2 ); hi.textContent = name( state.g ); }
        else if ( metric === "indie" ) { el.textContent = "Share of restaurants that are independents, by ZIP"; lo.textContent = pct( capitaDomain[0] ); hi.textContent = pct( top ); }
        else if ( metric === "desert" ) { el.textContent = state.g != null ? `ZIPs with 2,000+ residents and no ${ name( state.g ) } restaurant` : "Food deserts: bottom 10% of ZIPs (1,000+ residents) by restaurants per resident"; lo.textContent = state.g != null ? "" : "fewer"; hi.textContent = state.g != null ? "" : "none"; ramp.hidden = state.g != null; dot.hidden = state.g == null; }
        else { el.textContent = `${ state.zip } vs. ${ state.zip2 }`; lo.textContent = state.zip2; hi.textContent = state.zip; }
    } else if ( zipCompare() ) {
        el.innerHTML = sw( state.zip, state.zip2 );
    } else if ( state.view === "heat" ) {
        el.textContent = `Density${ where }, scaled to what is on screen`;
    } else if ( comparing() ) {
        el.innerHTML = sw( name( state.g ), name( state.g2 ) ) + ( z >= POINT_ZOOM || state.zip ? "" : ". Color is which leads, opacity is by how much" );
    } else if ( chainLens() ) {
        el.innerHTML = sw( "Independent", "Chain" ) + ( z >= POINT_ZOOM || state.zip || state.g != null ? "" : ". Circles blend by chain share" );
    } else if ( state.zip ) el.textContent = `Each dot is one restaurant in ${ state.zip }`;
    else if ( z >= POINT_ZOOM ) el.textContent = "Each dot is one restaurant";
    else el.textContent = "Circles are counts. Zoom in for individual restaurants";
}

map.on( "style.load", decorate );
map.on( "zoomend", updateLegend );

/* ---------- map interaction ---------- */

const popup = new maplibregl.Popup( { closeButton: false, closeOnClick: false, offset: 8, maxWidth: "300px" } );
let stickyPopup = false;

function pointHTML( p, lngLat ) {
    const flagged = flaggedKey( p, lngLat ) in flags;
    const issue = `${ REPO }/issues/new?${ new URLSearchParams( { title: `Platemap: wrong cuisine for ${ p.n }`, body: `Name: ${ p.n }\nAddress: ${ p.a }\nShown as: ${ data.groups[ p.g ] }${ p.i ? " (inferred from name)" : "" }\nLocation: ${ lngLat[1].toFixed( 5 ) }, ${ lngLat[0].toFixed( 5 ) }\n\nShould be: ` } ) }`;
    return `<div class="popup"><h3>${ esc( p.n ) }</h3><p><span class="tag">${ data.groups[ p.g ] }</span>${ p.i ? ' <span class="inferred" title="Foursquare has no cuisine for this place; Platemap guessed from the name">guessed from name</span>' : "" }${ p.k ? ' <span class="chain">chain</span>' : "" }</p><p>${ esc( p.a ) }${ p.z ? " " + p.z : "" }</p><p class="flagline">${ flagged ? "Flagged, thanks" : `<a href="${ issue }" target="_blank" rel="noopener" data-flag="${ esc( flaggedKey( p, lngLat ) ) }">Looks wrong?</a>` }</p></div>`;
}
function showPopup( e ) {
    if ( stickyPopup ) return;
    const f = e.features[0];
    map.getCanvas().style.cursor = "pointer";
    popup.setLngLat( f.geometry.coordinates ).setHTML( pointHTML( f.properties, f.geometry.coordinates ) ).addTo( map );
}
function hidePopup() {
    if ( stickyPopup ) return;
    map.getCanvas().style.cursor = "";
    popup.remove();
}
for ( const h of HALVES ) {
    map.on( "mousemove", "points-" + h, showPopup );
    map.on( "mouseleave", "points-" + h, hidePopup );
}
map.on( "mouseenter", "clusters", () => map.getCanvas().style.cursor = "pointer" );
map.on( "mouseleave", "clusters", () => map.getCanvas().style.cursor = "" );
document.addEventListener( "click", ( e ) => {
    const a = e.target.closest( "a[data-flag]" );
    if ( a ) { flags[ a.dataset.flag ] = 1; saveFlags(); a.replaceWith( "Flagged, thanks" ); }
} );

function zipPopup( e, z ) {
    const r = data.zips[ z ];
    const emptyPop = data.empty[ z ];
    if ( !r && !emptyPop ) { popup.remove(); return; }
    const pop = r ? r[7] : emptyPop;
    let line = `${ pop ? compact.format( pop ) + " residents · " : "" }${ fmt.format( r ? r[3] : 0 ) } restaurants`;
    if ( r && r[8] ) line += ` · ${ pct( 1 - r[8] / r[3] ) } independent`;
    if ( state.view === "capita" && r ) {
        const st = map.getFeatureState( { source: "zcta", sourceLayer: "zcta", id: Number( z ) } );
        if ( st.v != null ) {
            const m = capitaMetric();
            line += m === "density" ? ` · ${ fmt1.format( st.v ) } per 10k` : m === "lq" ? ` · ${ fmt1.format( 2 ** st.v ) }× national` : m === "share" ? ` · ${ pct( st.v ) } ${ data.groups[ state.g ] }` : "";
        }
    }
    popup.setLngLat( e.lngLat ).setHTML( `<div class="popup"><h3>${ z } <span class="tag">${ esc( r ? [ r[5], r[6] ].filter( Boolean ).join( ", " ) : "" ) }</span></h3><p>${ line }</p></div>` ).addTo( map );
}
map.on( "mousemove", "zcta-hit", ( e ) => {
    if ( stickyPopup || pinning ) return;
    if ( map.getZoom() >= POINT_ZOOM && state.view !== "capita" ) return;
    if ( HALVES.some( ( h ) => map.queryRenderedFeatures( e.point, { layers: [ "points-" + h ] } ).length ) ) return;
    zipPopup( e, e.features[0].properties.z );
} );
map.on( "mouseleave", "zcta-hit", () => { if ( !stickyPopup ) popup.remove(); } );

map.on( "click", ( e ) => {
    const pick = ( layers ) => map.queryRenderedFeatures( e.point, { layers: layers.filter( ( l ) => map.getLayer( l ) ) } )[0];
    if ( pinning ) { placePin( [ e.lngLat.lng, e.lngLat.lat ], state.radius ); setPinning( false ); return; }
    const pt = pick( HALVES.map( ( h ) => "points-" + h ) );
    if ( pt ) {
        stickyPopup = !stickyPopup;
        if ( stickyPopup ) popup.setLngLat( pt.geometry.coordinates ).setHTML( pointHTML( pt.properties, pt.geometry.coordinates ) ).addTo( map );
        return;
    }
    if ( stickyPopup ) { stickyPopup = false; popup.remove(); return; }
    const cl = state.view === "dots" && !state.zip && map.getZoom() < POINT_ZOOM && pick( [ "clusters" ] );
    if ( cl ) { map.easeTo( { center: cl.geometry.coordinates, zoom: Math.min( map.getZoom() + 2.5, POINT_ZOOM + 1 ) } ); return; }
    const zp = state.view === "dots" && state.zip && map.getZoom() < POINT_ZOOM && pick( [ "zippoints" ] );
    if ( zp ) { map.easeTo( { center: zp.geometry.coordinates, zoom: POINT_ZOOM + 2 } ); return; }
    const zc = pick( [ "zcta-hit" ] );
    if ( zc && ( data.zips[ zc.properties.z ] || data.empty[ zc.properties.z ] ) ) {
        const z = zc.properties.z;
        if ( pendingZip2 ) { if ( z !== state.zip ) state.zip2 = z; pendingZip2 = false; sync(); fitZips(); }
        else if ( z === state.zip ) clearZip();
        else if ( data.zips[ z ] ) selectZip( z, false );
    }
} );

function esc( s ) {
    return String( s ?? "" ).replace( /[&<>"]/g, ( ch ) => ( { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ ch ] ) );
}

dark.addEventListener( "change", ( e ) => map.setStyle( e.matches ? STYLES.dark : STYLES.light ) );

/* ---------- flags (local) ---------- */

let flags = {};
try { flags = JSON.parse( localStorage.getItem( "platemap-flags" ) || "{}" ); } catch { flags = {}; }
const flaggedKey = ( p, ll ) => `${ p.n }|${ ll[0].toFixed( 4 ) }|${ ll[1].toFixed( 4 ) }`;
function saveFlags() { try { localStorage.setItem( "platemap-flags", JSON.stringify( flags ) ); } catch {} }

/* ---------- radius report ---------- */

function ringGeoJSON() {
    if ( !state.pin ) return { type: "FeatureCollection", features: [] };
    const [ lng, lat ] = state.pin;
    const r = state.radius * MILE;
    const coords = [];
    for ( let i = 0; i <= 96; i++ ) {
        const t = i / 96 * 2 * Math.PI;
        coords.push( [ lng + r * Math.sin( t ) / ( 111320 * Math.cos( lat * Math.PI / 180 ) ), lat + r * Math.cos( t ) / 110574 ] );
    }
    return { type: "FeatureCollection", features: [ { type: "Feature", geometry: { type: "Polygon", coordinates: [ coords ] } } ] };
}

function haversine( a, b ) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = ( b[1] - a[1] ) * toR, dLng = ( b[0] - a[0] ) * toR;
    const h = Math.sin( dLat / 2 ) ** 2 + Math.cos( a[1] * toR ) * Math.cos( b[1] * toR ) * Math.sin( dLng / 2 ) ** 2;
    return 2 * R * Math.asin( Math.sqrt( h ) );
}

function tileXY( lng, lat, z ) {
    const n = 2 ** z;
    const x = Math.floor( ( lng + 180 ) / 360 * n );
    const latR = lat * Math.PI / 180;
    const y = Math.floor( ( 1 - Math.log( Math.tan( latR ) + 1 / Math.cos( latR ) ) / Math.PI ) / 2 * n );
    return [ x, y ];
}

/* Read every z12 point tile the ring touches straight from the archives, so the
   report is exact regardless of what the viewport happens to have loaded. */
async function pointsWithin( center, radiusM ) {
    const [ lng, lat ] = center;
    const dLat = radiusM / 110574, dLng = radiusM / ( 111320 * Math.cos( lat * Math.PI / 180 ) );
    const [ x0, y0 ] = tileXY( lng - dLng, lat + dLat, POINT_ZOOM );
    const [ x1, y1 ] = tileXY( lng + dLng, lat - dLat, POINT_ZOOM );
    const jobs = [];
    for ( let x = x0; x <= x1; x++ ) for ( let y = y0; y <= y1; y++ ) {
        const west = ( x + 0.5 ) / 2 ** POINT_ZOOM * 360 - 180 < -90;
        const name = "points_" + ( west ? "w" : "e" );
        jobs.push( archives[ name ]?.getZxy( POINT_ZOOM, x, y ).then( ( t ) => ( { t, x, y } ) ) );
    }
    const out = [];
    for ( const res of await Promise.all( jobs.filter( Boolean ) ) ) {
        if ( !res?.t ) continue;
        const layer = new VectorTile( new PbfReader( new Uint8Array( res.t.data ) ) ).layers.points;
        if ( !layer ) continue;
        for ( let i = 0; i < layer.length; i++ ) {
            const f = layer.feature( i ).toGeoJSON( res.x, res.y, POINT_ZOOM );
            const d = haversine( center, f.geometry.coordinates );
            if ( d <= radiusM ) out.push( { ...f.properties, d, c: f.geometry.coordinates } );
        }
    }
    return out;
}

let reportToken = 0;
async function runReport() {
    const el = document.getElementById( "report" );
    if ( !state.pin ) { el.hidden = true; return; }
    const token = ++reportToken;
    el.hidden = false;
    el.innerHTML = `<p class="muted">Reading restaurants within ${ state.radius } mi…</p>`;
    const pts = await pointsWithin( state.pin, state.radius * MILE );
    if ( token !== reportToken ) return;
    const T = data.totals.reduce( ( a, b ) => a + b, 0 );
    const counts = new Array( data.groups.length ).fill( 0 );
    const nearest = {};
    let chains = 0;
    for ( const p of pts ) {
        counts[ p.g ]++;
        if ( p.k ) chains++;
        if ( !nearest[ p.g ] || p.d < nearest[ p.g ].d ) nearest[ p.g ] = p;
    }
    const n = pts.length;
    const mi = ( m ) => m < 160 ? `${ Math.round( m * 3.281 ) } ft` : `${ fmt1.format( m / MILE ) } mi`;
    const over = counts.map( ( c, g ) => [ g, c, ( c / Math.max( n, 1 ) ) / ( data.totals[ g ] / T ) ] )
        .filter( ( [ g, c ] ) => g !== UNSPEC && c >= 3 ).sort( ( a, b ) => b[2] - a[2] );
    const missing = data.groups.map( ( _, g ) => g ).filter( ( g ) => g !== UNSPEC && g !== 25 && counts[ g ] === 0 )
        .sort( ( a, b ) => data.totals[ b ] - data.totals[ a ] );
    const order = Object.keys( nearest ).map( Number ).filter( ( g ) => g !== UNSPEC ).sort( ( a, b ) => nearest[ a ].d - nearest[ b ].d );
    const areaMi = Math.PI * state.radius ** 2;
    el.innerHTML = `
        <div class="big">${ fmt.format( n ) }<small>restaurants within ${ state.radius } mi · ${ fmt1.format( n / areaMi ) } per sq mi</small></div>
        ${ n ? `<p class="muted">${ pct( 1 - chains / n ) } independent · ${ pct( counts[ UNSPEC ] / n ) } uncategorized</p>` : "" }
        ${ over.length ? `<h4>Over-represented vs. the US</h4><p>${ over.slice( 0, 3 ).map( ( [ g, c, l ] ) => `${ esc( data.groups[ g ] ) } <span class="muted">${ fmt1.format( l ) }× (${ c })</span>` ).join( " · " ) }</p>` : "" }
        ${ missing.length ? `<h4>Not within ${ state.radius } mi</h4><p class="gap">${ missing.slice( 0, 6 ).map( ( g ) => esc( data.groups[ g ] ) ).join( ", " ) }${ missing.length > 6 ? ` <span class="muted">+${ missing.length - 6 } more</span>` : "" }</p>` : n ? `<h4>Coverage</h4><p>Every cuisine group is within ${ state.radius } mi.</p>` : "" }
        ${ order.length ? `<h4>Nearest of each</h4><dl class="nearest">${ order.map( ( g ) => `<dt>${ esc( data.groups[ g ] ) }</dt><dd title="${ esc( nearest[ g ].n ) }">${ esc( nearest[ g ].n ) }</dd><dd class="dist">${ mi( nearest[ g ].d ) }</dd>` ).join( "" ) }</dl>` : "" }`;
    pinCounts = counts;
    renderCuisines();
}
let pinCounts = null;

let pinMarker = null;
function placePin( lngLat, radius, label ) {
    state.pin = lngLat;
    state.radius = radius;
    state.zip = null; state.zip2 = null;
    document.getElementById( "zip" ).value = "";
    if ( !pinMarker ) {
        const el = document.createElement( "div" );
        el.className = "pin-marker";
        el.innerHTML = `<svg viewBox="0 0 32 32" width="32" height="32"><path d="M16 31s10-10.4 10-18A10 10 0 0 0 6 13c0 7.6 10 18 10 18z" fill="currentColor" stroke="#fff" stroke-width="1.5"/><circle cx="16" cy="13" r="3.5" fill="#fff"/></svg>`;
        pinMarker = new maplibregl.Marker( { element: el, anchor: "bottom", draggable: true } );
        pinMarker.on( "dragend", () => { const ll = pinMarker.getLngLat(); state.pin = [ ll.lng, ll.lat ]; sync(); } );
    }
    pinMarker.setLngLat( lngLat ).addTo( map );
    document.getElementById( "pinPlace" ).textContent = label || `${ lngLat[1].toFixed( 4 ) }, ${ lngLat[0].toFixed( 4 ) }`;
    sync();
    const r = radius * MILE;
    const dLat = r / 110574, dLng = r / ( 111320 * Math.cos( lngLat[1] * Math.PI / 180 ) );
    map.fitBounds( [ [ lngLat[0] - dLng, lngLat[1] - dLat ], [ lngLat[0] + dLng, lngLat[1] + dLat ] ], { padding: 40, duration: 900 } );
}

function clearPin() {
    state.pin = null;
    pinCounts = null;
    pinMarker?.remove();
    document.getElementById( "report" ).hidden = true;
    sync();
}

function setPinning( on ) {
    pinning = on;
    document.getElementById( "pinmode" ).setAttribute( "aria-pressed", on );
    document.getElementById( "map" ).classList.toggle( "pinning", on );
    if ( on ) toast( "Click the map to drop a pin" );
}

document.getElementById( "pinmode" ).addEventListener( "click", () => setPinning( !pinning ) );
document.getElementById( "nearme" ).addEventListener( "click", () => geo.trigger() );
document.getElementById( "clearPin" ).addEventListener( "click", clearPin );
document.getElementById( "radii" ).addEventListener( "click", ( e ) => {
    const b = e.target.closest( "button" );
    if ( !b ) return;
    state.radius = Number( b.dataset.r );
    if ( state.pin ) placePin( state.pin, state.radius, document.getElementById( "pinPlace" ).textContent ); else sync();
} );

/* ---------- rail ---------- */

const list = document.getElementById( "cuisines" );

function renderCuisines() {
    const counts = state.pin && pinCounts ? pinCounts : state.zip ? data.zips[ state.zip ][4] : data.totals;
    const counts2 = zipCompare() ? data.zips[ state.zip2 ][4] : null;
    const total = counts.reduce( ( a, b ) => a + b, 0 );
    const total2 = counts2 ? counts2.reduce( ( a, b ) => a + b, 0 ) : 0;
    const order = counts.map( ( n, i ) => i ).filter( ( i ) => i !== UNSPEC ).sort( ( a, b ) => counts2 ? ( counts[ b ] / total + counts2[ b ] / total2 ) - ( counts[ a ] / total + counts2[ a ] / total2 ) : counts[ b ] - counts[ a ] );
    order.push( UNSPEC );
    const max = counts2 ? Math.max( ...order.map( ( i ) => Math.max( counts[ i ] / total, counts2[ i ] / total2 ) ) ) || 1 : counts[ order[0] ] || 1;
    const ab = ( i ) => state.compare ? ( i === state.g ? "a" : i === state.g2 ? "b" : "" ) : "";
    const row = ( i, name, cls = "" ) => {
        const n = i === "" ? total : counts[ i ];
        const bars = counts2
            ? `<span class="bars"><span class="bar"><i style="width:${ ( ( i === "" ? 1 : counts[ i ] / total ) / ( i === "" ? 1 : max ) * 100 ).toFixed( 1 ) }%"></i></span><span class="bar"><i style="width:${ ( ( i === "" ? 1 : counts2[ i ] / total2 ) / ( i === "" ? 1 : max ) * 100 ).toFixed( 1 ) }%"></i></span></span>`
            : `<span class="bar"><i style="width:${ ( ( i === "" ? 1 : counts[ i ] / max ) * 100 ).toFixed( 1 ) }%"></i></span>`;
        const count = counts2 ? `${ fmt.format( n ) } <span class="b">${ fmt.format( i === "" ? total2 : counts2[ i ] ) }</span>` : fmt.format( n );
        return `<li data-g="${ i }" data-ab="${ ab( i ) }" role="button" aria-pressed="${ !state.compare && state.g === ( i === "" ? null : i ) }" class="${ cls }">
            <span class="name">${ name }<span class="badge">${ ab( i ).toUpperCase() }</span></span>
            <span class="count">${ count }</span>${ bars }</li>`;
    };
    list.innerHTML = ( state.compare ? "" : row( "", "All cuisines", "all" ) ) + order.filter( ( i ) => counts[ i ] > 0 || ( counts2 && counts2[ i ] > 0 ) || ( !state.zip && !state.pin ) )
        .map( ( i ) => row( i, data.groups[ i ], i === UNSPEC ? "unspecified" : "" ) ).join( "" );
    document.getElementById( "total" ).textContent = compact.format( data.totals.reduce( ( a, b ) => a + b, 0 ) );
    document.getElementById( "listTitle" ).textContent = state.compare ? "Pick two to compare" : counts2 ? `Share of ${ state.zip } vs. ${ state.zip2 }` : state.pin ? `Within ${ state.radius } mi` : "Cuisine";
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
    if ( state.view !== "capita" && state.lens === "desert" ) state.lens = null;
    sync();
} );

document.getElementById( "lenses" ).addEventListener( "click", ( e ) => {
    const b = e.target.closest( "button[data-lens]" );
    if ( !b ) return;
    state.lens = state.lens === b.dataset.lens ? null : b.dataset.lens;
    sync();
} );

function renderViews() {
    for ( const b of document.querySelectorAll( "#views button" ) ) b.setAttribute( "aria-checked", b.dataset.view === state.view );
    for ( const b of document.querySelectorAll( "#lenses button[data-lens]" ) ) {
        b.setAttribute( "aria-pressed", state.lens === b.dataset.lens );
        if ( b.dataset.lens === "desert" ) b.hidden = state.view !== "capita";
    }
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

input.addEventListener( "input", () => { matches = search( input.value ); active = matches.length ? 0 : -1; renderSuggest(); } );
input.addEventListener( "keydown", ( e ) => {
    if ( e.key === "ArrowDown" || e.key === "ArrowUp" ) {
        e.preventDefault();
        if ( !matches.length ) return;
        active = ( active + ( e.key === "ArrowDown" ? 1 : matches.length - 1 ) ) % matches.length;
        renderSuggest();
    } else if ( e.key === "Enter" ) {
        if ( active >= 0 ) selectZip( matches[ active ][0] );
        else if ( /^\d{5}$/.test( input.value ) && data.zips[ input.value ] ) selectZip( input.value );
    } else if ( e.key === "Escape" ) { matches = []; renderSuggest(); input.blur(); }
} );
suggest.addEventListener( "mousedown", ( e ) => {
    const li = e.target.closest( "li" );
    if ( li ) { e.preventDefault(); selectZip( li.dataset.zip ); }
} );
input.addEventListener( "blur", () => setTimeout( () => { matches = []; renderSuggest(); }, 150 ) );

function selectZip( zip, fly = true ) {
    const r = data.zips[ zip ];
    if ( !r ) return;
    if ( pendingZip2 && state.zip && zip !== state.zip ) { state.zip2 = zip; pendingZip2 = false; }
    else { state.zip = zip; state.zip2 = null; }
    if ( state.pin ) { state.pin = null; pinCounts = null; pinMarker?.remove(); document.getElementById( "report" ).hidden = true; }
    matches = []; renderSuggest();
    input.value = state.zip2 ? "" : zip;
    input.blur();
    sync();
    if ( fly ) fitZips();
}

function fitZips() {
    const boxes = [ state.zip, state.zip2 ].filter( Boolean ).map( ( z ) => data.zips[ z ][2] );
    const b = [ Math.min( ...boxes.map( ( x ) => x[0] ) ), Math.min( ...boxes.map( ( x ) => x[1] ) ), Math.max( ...boxes.map( ( x ) => x[2] ) ), Math.max( ...boxes.map( ( x ) => x[3] ) ) ];
    map.fitBounds( [ [ b[0], b[1] ], [ b[2], b[3] ] ], { padding: 60, maxZoom: 15, duration: 1200 } );
}

function clearZip() {
    state.zip = null; state.zip2 = null; pendingZip2 = false;
    input.value = "";
    sync();
}
document.getElementById( "clearZip" ).addEventListener( "click", clearZip );
document.getElementById( "vsZip" ).addEventListener( "click", () => {
    if ( state.zip2 ) { state.zip2 = null; sync(); return; }
    pendingZip2 = !pendingZip2;
    renderScope();
    if ( pendingZip2 ) { toast( "Search or click a second ZIP" ); input.focus(); }
} );

function renderScope() {
    const el = document.getElementById( "scope" );
    el.hidden = !state.zip;
    document.getElementById( "pinScope" ).hidden = !state.pin;
    for ( const b of document.querySelectorAll( "#radii button" ) ) b.setAttribute( "aria-checked", Number( b.dataset.r ) === state.radius );
    if ( !state.zip ) return;
    const r = data.zips[ state.zip ];
    const place = ( z ) => { const q = data.zips[ z ]; return [ q[5], q[6] ].filter( Boolean ).join( ", " ) + ( q[7] ? ` · ${ compact.format( q[7] ) } residents` : "" ); };
    document.getElementById( "scopeZip" ).innerHTML = state.zip2 ? `${ state.zip } <span class="vs">vs.</span> <span class="b">${ state.zip2 }</span>` : state.zip;
    document.getElementById( "scopePlace" ).textContent = state.zip2 ? `${ r[5] } vs. ${ data.zips[ state.zip2 ][5] }` : place( state.zip );
    const vs = document.getElementById( "vsZip" );
    vs.textContent = state.zip2 ? "Drop second ZIP" : pendingZip2 ? "Pick the second ZIP…" : "vs. another ZIP";
    vs.setAttribute( "aria-pressed", pendingZip2 );
}

/* ---------- share card ---------- */

document.getElementById( "share" ).addEventListener( "click", async () => {
    const src = map.getCanvas();
    const W = src.width, H = src.height;
    const c = document.createElement( "canvas" );
    c.width = W; c.height = H + Math.round( H * 0.26 );
    const ctx = c.getContext( "2d" );
    const s = W / src.clientWidth;
    ctx.fillStyle = paper(); ctx.fillRect( 0, 0, c.width, c.height );
    ctx.drawImage( src, 0, 0 );
    const pad = 28 * s, y0 = H + 24 * s;
    ctx.fillStyle = cssVar( "--fg" );
    ctx.font = `500 ${ 34 * s }px Fraunces, Georgia, serif`;
    ctx.fillText( "Platemap", pad, y0 + 30 * s );
    ctx.font = `400 ${ 15 * s }px Inter, sans-serif`;
    ctx.fillStyle = cssVar( "--muted" );
    const legend = document.getElementById( "legendText" ).textContent;
    const scopeLine = state.pin ? document.getElementById( "report" ).querySelector( ".big" )?.textContent.replace( /(\d)([a-z])/i, "$1 $2" ) : state.zip ? document.getElementById( "scopePlace" ).textContent.replace( /^/, state.zip + ( state.zip2 ? " vs. " + state.zip2 : "" ) + " · " ) : "United States";
    ctx.fillText( scopeLine, pad, y0 + 56 * s );
    ctx.fillText( legend, pad, y0 + 78 * s );
    const counts = state.pin && pinCounts ? pinCounts : state.zip ? data.zips[ state.zip ][4] : data.totals;
    const total = counts.reduce( ( a, b ) => a + b, 0 );
    const top = counts.map( ( n, i ) => [ i, n ] ).filter( ( [ i ] ) => i !== UNSPEC ).sort( ( a, b ) => b[1] - a[1] ).slice( 0, 5 );
    const colX = W * 0.56;
    ctx.fillStyle = cssVar( "--fg" );
    ctx.font = `500 ${ 13 * s }px Inter, sans-serif`;
    top.forEach( ( [ i, n ], k ) => {
        const yy = y0 + ( 14 + k * 20 ) * s;
        ctx.fillStyle = cssVar( "--fg" ); ctx.fillText( data.groups[ i ], colX, yy );
        ctx.fillStyle = cssVar( "--muted" ); ctx.textAlign = "right"; ctx.fillText( `${ fmt.format( n ) } · ${ pct( n / total ) }`, W - pad, yy ); ctx.textAlign = "left";
        ctx.fillStyle = accent(); ctx.fillRect( colX, yy + 5 * s, ( W - pad - colX ) * ( n / top[0][1] ), 3 * s );
    } );
    ctx.fillStyle = cssVar( "--muted" );
    ctx.font = `400 ${ 11 * s }px Inter, sans-serif`;
    ctx.fillText( "kevin-freitas-wwt.github.io/experiments/Platemap · Foursquare OS Places, OpenFreeMap, OpenStreetMap", pad, c.height - 14 * s );
    const a = document.createElement( "a" );
    a.download = `platemap${ state.zip ? "-" + state.zip : "" }.png`;
    a.href = c.toDataURL( "image/png" );
    a.click();
    toast( "Share card saved" );
} );

/* ---------- misc ---------- */

let toastTimer;
function toast( msg ) {
    const el = document.getElementById( "toast" );
    el.textContent = msg; el.hidden = false;
    clearTimeout( toastTimer );
    toastTimer = setTimeout( () => el.hidden = true, 2600 );
}

/* ---------- state ---------- */

function readHash() {
    const h = new URLSearchParams( location.hash.slice( 1 ) );
    const g = h.get( "g" ), g2 = h.get( "g2" );
    state.g = g != null && data.groups[ g ] ? Number( g ) : null;
    state.g2 = g2 != null && data.groups[ g2 ] ? Number( g2 ) : null;
    state.compare = state.g2 != null || h.get( "compare" ) === "1";
    const zip = h.get( "zip" ), zip2 = h.get( "zip2" );
    state.zip = zip && data.zips[ zip ] ? zip : null;
    state.zip2 = state.zip && zip2 && data.zips[ zip2 ] && zip2 !== zip ? zip2 : null;
    const v = h.get( "view" );
    state.view = [ "heat", "capita" ].includes( v ) ? v : "dots";
    const lens = h.get( "lens" );
    state.lens = [ "chains", "desert" ].includes( lens ) ? lens : null;
    const pin = ( h.get( "pin" ) || "" ).split( "," ).map( Number );
    const r = Number( h.get( "r" ) );
    if ( [ 1, 3, 5 ].includes( r ) ) state.radius = r;
    if ( pin.length === 2 && pin.every( Number.isFinite ) && !state.zip ) state.pin = pin;
    if ( state.zip ) input.value = state.zip;
}

function writeHash() {
    const h = new URLSearchParams( location.hash.slice( 1 ) );
    const set = ( k, v ) => v == null || v === false || v === "" ? h.delete( k ) : h.set( k, v );
    set( "g", state.g ); set( "g2", state.g2 );
    set( "compare", state.compare && state.g2 == null ? "1" : null );
    set( "zip", state.zip ); set( "zip2", state.zip2 );
    set( "view", state.view === "dots" ? null : state.view );
    set( "lens", state.lens );
    set( "pin", state.pin ? state.pin.map( ( v ) => v.toFixed( 5 ) ).join( "," ) : null );
    set( "r", state.pin && state.radius !== 1 ? state.radius : null );
    history.replaceState( null, "", "#" + h.toString() );
}

function sync() {
    renderViews();
    renderCuisines();
    renderScope();
    applyState();
    writeHash();
    if ( state.pin && map.getSource( "ring" ) ) runReport();
}

const railEl = document.getElementById( "rail" );
if ( matchMedia( "( max-width: 760px )" ).matches ) { railEl.classList.add( "collapsed" ); document.getElementById( "toggle" ).setAttribute( "aria-expanded", "false" ); }
document.getElementById( "toggle" ).addEventListener( "click", ( e ) => {
    const open = railEl.classList.toggle( "collapsed" ) === false;
    e.currentTarget.setAttribute( "aria-expanded", open );
    setTimeout( () => map.resize(), 50 );
} );

fetch( `${ BASE }data/zips.json` ).then( ( r ) => r.json() ).then( ( d ) => {
    data = d;
    data.empty = data.empty || {};
    nationalTotal = Object.values( d.words ).reduce( ( a, b ) => a + b, 0 );
    index = Object.entries( d.zips ).map( ( [ z, r ] ) => [ z, r[5].toLowerCase(), r[6], r[5], r[3] ] ).sort( ( a, b ) => b[4] - a[4] );
    readHash();
    sync();
    if ( state.zip && !initialHash.includes( "map=" ) ) fitZips();
    if ( state.pin ) placePin( state.pin, state.radius );
    if ( new URLSearchParams( initialHash.slice( 1 ) ).get( "near" ) === "1" ) map.once( "load", () => geo.trigger() );
    map.once( "idle", () => { if ( state.pin ) runReport(); } );
} );
