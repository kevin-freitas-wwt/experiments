import { angleDiff, bearing, distance } from "./geomath.js";

const CARDINALS = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
const DEG = Math.PI / 180;
const ELEV_CEIL_M = 4400;
const ELEV_FLOOR_M = 1524;
const FADE_PX = 70;
const FLAG_GAP = 10;
const FLAG_HEIGHT = 68;
const FONT = "system-ui, -apple-system, sans-serif";
const HALO_WIDTH = 4;
const HEADING_WINDOW_OTHER = 8;
const HEADING_WINDOW_PORTRAIT = 15;
const HORIZON_OFFSET = 90;
const H_FOV = 70;
const MARKER_TOP_MARGIN = 80;
const MAX_PER_WINDOW = 1;
const MIN_MARKER_PX = 70;
const NEIGHBOR_MARGIN = 15;
const SPIKE_WIDTH = 8;
const TERRAIN_STEP = 6;

// Procedural ridgeline layers (heights as fractions of view height). Wave
// frequencies are whole numbers so the silhouette wraps seamlessly at 360deg.
const BACK_LAYER = {
    base: 0.12,
    fadeBg: 0.1,
    fadeSolid: 0.26,
    min: 0.05,
    peakAmp: 0.36,
    scale: 1,
    span: 0.62,
    waves: [ { amp: 0.05, freq: 5, phase: 0.7 }, { amp: 0.03, freq: 9, phase: 2.1 }, { amp: 0.018, freq: 17, phase: 4.0 } ]
};
const FRONT_LAYER = {
    base: 0.08,
    fadeBg: 0,
    fadeSolid: 0.06,
    min: 0.06,
    peakAmp: 0,
    scale: 0.85,
    span: 0.26,
    waves: [ { amp: 0.04, freq: 7, phase: 3.3 }, { amp: 0.025, freq: 13, phase: 1.2 }, { amp: 0.02, freq: 23, phase: 5.5 } ]
};

function formatDistance( meters, units ) {
    return units === "km"
        ? `${ ( meters / 1000 ).toFixed( 1 ) } km`
        : `${ ( meters / 1609.34 ).toFixed( 1 ) } mi`;
}

function peakName( peak, names ) {
    return names === "native" && peak.native ? peak.native : peak.name;
}

function formatElevation( meters, units ) {
    return units === "km"
        ? `${ Math.round( meters ).toLocaleString( "en-US" ) } m`
        : `${ Math.round( meters * 3.28084 ).toLocaleString( "en-US" ) } ft`;
}

// Theme text/tick colour. inkRgb parses the hex once; ink applies the locked
// per-element opacity on top.
function inkRgb( hex ) {
    let h = hex.replace( "#", "" );
    if ( h.length === 3 ) {
        h = h.replace( /(.)/g, "$1$1" );
    }
    const n = parseInt( h, 16 );
    return `${ ( n >> 16 ) & 255 }, ${ ( n >> 8 ) & 255 }, ${ n & 255 }`;
}

function ink( view, alpha ) {
    return `rgba(${ inkRgb( view.text ) }, ${ alpha })`;
}

// Draw text with a translucent black halo so it stays readable over marker lines.
function drawLabel( ctx, text, x, y, font ) {
    ctx.font = font;
    ctx.lineJoin = "round";
    ctx.lineWidth = HALO_WIDTH;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.strokeText( text, x, y );
    ctx.fillText( text, x, y );
}

// Line height scales with the peak's elevation: a 5000 ft summit sits at the
// minimum, Rainier-class peaks reach near the top of the screen.
function markerHeight( elevation, horizonY ) {
    const maxLine = horizonY - MARKER_TOP_MARGIN;
    const t = ( elevation - ELEV_FLOOR_M ) / ( ELEV_CEIL_M - ELEV_FLOOR_M );
    return MIN_MARKER_PX + Math.max( 0, Math.min( 1, t ) ) * ( maxLine - MIN_MARKER_PX );
}

// Markers fade out over the last stretch before they reach a screen edge, so
// they never pop in or out as the user pans.
function edgeAlpha( x, viewWidth ) {
    return Math.max( 0, Math.min( 1, Math.min( x, viewWidth - x ) / FADE_PX ) );
}

function drawHorizon( ctx, view, horizonY, pxPerDegH ) {
    ctx.textAlign = "center";
    for ( let deg = 0; deg < 360; deg += 5 ) {
        const dx = angleDiff( deg, view.heading );
        if ( Math.abs( dx ) > H_FOV / 2 + 5 ) {
            continue;
        }
        const isCardinal = deg % 45 === 0;
        const len = isCardinal ? 26 : 11;
        const x = view.w / 2 + dx * pxPerDegH;
        ctx.globalAlpha = edgeAlpha( x, view.w );
        ctx.strokeStyle = ink( view, 0.55 );
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo( x, horizonY );
        ctx.lineTo( x, horizonY - len );
        ctx.stroke();
        if ( isCardinal ) {
            ctx.fillStyle = ink( view, 0.85 );
            drawLabel( ctx, CARDINALS[ deg ], x, horizonY - len - 9, `15px ${ FONT }` );
        }
    }
    ctx.globalAlpha = 1;
}

// All peaks within range, including a margin past the visible edge so that side
// placement stays stable as peaks scroll into and out of view.
function candidatePeaks( peaks, view, horizonY, pxPerDegH ) {
    const raw = [];
    const maxLat = view.withinM / 111320 + 0.05;
    const maxLon = maxLat / Math.max( 0.2, Math.cos( view.location.lat * DEG ) );
    for ( const peak of peaks ) {
        if ( peak.elevation < view.minElevM ) {
            continue;
        }
        if ( Math.abs( peak.lat - view.location.lat ) > maxLat || Math.abs( peak.lon - view.location.lon ) > maxLon ) {
            continue;
        }
        const d = distance( view.location, peak );
        if ( d > view.withinM ) {
            continue;
        }
        const dx = angleDiff( bearing( view.location, peak ), view.heading );
        if ( Math.abs( dx ) > H_FOV / 2 + NEIGHBOR_MARGIN ) {
            continue;
        }
        raw.push( {
            dx,
            elevation: peak.elevation,
            key: peak.name,
            lines: [
                { fill: view.text, font: `20px ${ FONT }`, offset: 20, text: peakName( peak, view.names ) },
                { fill: ink( view, 0.6 ), font: `15px ${ FONT }`, offset: 43, text: formatElevation( peak.elevation, view.units ) },
                { fill: ink( view, 0.6 ), font: `15px ${ FONT }`, offset: 63, text: formatDistance( d, view.units ) }
            ],
            topY: horizonY - markerHeight( peak.elevation, horizonY ),
            x: view.w / 2 + dx * pxPerDegH
        } );
    }

    // Heading declutter: within the heading window keep only the highest
    // MAX_PER_WINDOW peaks. Portrait is narrower, so it crowds more and uses a
    // wider window. Process tallest first so the survivors are the giants.
    const headingWindow = view.h > view.w ? HEADING_WINDOW_PORTRAIT : HEADING_WINDOW_OTHER;
    raw.sort( ( a, b ) => b.elevation - a.elevation );
    const items = [];
    for ( const cand of raw ) {
        let near = 0;
        for ( const kept of items ) {
            if ( Math.abs( kept.dx - cand.dx ) < headingWindow ) {
                near += 1;
                if ( near >= MAX_PER_WINDOW ) {
                    break;
                }
            }
        }
        if ( near < MAX_PER_WINDOW ) {
            items.push( cand );
        }
    }
    return items;
}

function flagWidth( ctx, item ) {
    let w = 0;
    for ( const line of item.lines ) {
        ctx.font = line.font;
        w = Math.max( w, ctx.measureText( line.text ).width );
    }
    return w;
}

function flagRect( item, offsetY ) {
    const top = item.topY + offsetY;
    const x0 = item.side === "right" ? item.x + FLAG_GAP : item.x - FLAG_GAP - item.width;
    return { x0, x1: x0 + item.width, y0: top, y1: top + FLAG_HEIGHT };
}

function overlaps( a, b ) {
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

// Each label is a flag off the top of its line. The side is decided purely from
// bearing-space neighbours, so it never flips while panning: a peak points away
// from a close neighbour, otherwise it sits on the right. A flag drops down only
// if it still collides with one already placed.
function placeFlags( ctx, items ) {
    items.sort( ( a, b ) => a.x - b.x );
    const placed = [];
    for ( const item of items ) {
        item.width = flagWidth( ctx, item );
        const span = item.width + FLAG_GAP * 2;
        const neighborRight = items.some( ( o ) => o !== item && o.x > item.x && o.x - item.x < span );
        const neighborLeft = items.some( ( o ) => o !== item && o.x < item.x && item.x - o.x < span );
        item.side = neighborRight && !neighborLeft ? "left" : "right";
        item.offsetY = 0;
        while ( placed.some( ( r ) => overlaps( flagRect( item, item.offsetY ), r ) ) ) {
            item.offsetY += FLAG_HEIGHT;
        }
        placed.push( flagRect( item, item.offsetY ) );
    }
}

function drawPeaks( ctx, items, horizonY, view ) {
    let visible = 0;
    for ( const item of items ) {
        const alpha = edgeAlpha( item.x, view.w );
        if ( alpha <= 0 ) {
            continue;
        }
        visible += 1;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = view.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo( item.x, horizonY );
        ctx.lineTo( item.x, item.topY );
        ctx.stroke();

        const alignLeft = item.side === "right";
        const tx = alignLeft ? item.x + FLAG_GAP : item.x - FLAG_GAP;
        const top = item.topY + item.offsetY;
        ctx.textAlign = alignLeft ? "left" : "right";
        for ( const line of item.lines ) {
            ctx.fillStyle = line.fill;
            drawLabel( ctx, line.text, tx, top + line.offset, line.font );
        }
    }
    ctx.globalAlpha = 1;
    return visible;
}

// Terrain ridgeline ignores the elevation cutoff: it always reflects every peak
// within the chosen distance, so the silhouette stays true even when labels are
// thinned by the "Above" filter.
function peakAzimuths( peaks, location, withinM ) {
    const list = [];
    const maxLat = withinM / 111320 + 0.05;
    const maxLon = maxLat / Math.max( 0.2, Math.cos( location.lat * DEG ) );
    for ( const peak of peaks ) {
        if ( Math.abs( peak.lat - location.lat ) > maxLat ||
             Math.abs( peak.lon - location.lon ) > maxLon ) {
            continue;
        }
        if ( distance( location, peak ) > withinM ) {
            continue;
        }
        const amp = Math.max( 0, Math.min( 1, ( peak.elevation - ELEV_FLOOR_M ) / ( ELEV_CEIL_M - ELEV_FLOOR_M ) ) );
        list.push( { amp, az: bearing( location, peak ) } );
    }
    return list;
}

function ridgeHeight( az, layer, azimuths, viewHeight ) {
    let h = layer.base;
    for ( const w of layer.waves ) {
        h += w.amp * Math.sin( w.freq * az * DEG + w.phase );
    }
    h = Math.max( layer.min, h ) * layer.scale;
    if ( layer.peakAmp && azimuths ) {
        let spike = 0;
        for ( const p of azimuths ) {
            const dd = Math.abs( angleDiff( p.az, az ) );
            if ( dd < SPIKE_WIDTH ) {
                spike = Math.max( spike, p.amp * ( 1 - dd / SPIKE_WIDTH ) );
            }
        }
        h += spike * layer.peakAmp;
    }
    return h * viewHeight;
}

function drawRidge( ctx, view, horizonY, pxPerDegH, layer, azimuths, color ) {
    const margin = 40;
    const xs = [];
    for ( let x = -margin; x <= view.w + margin; x += TERRAIN_STEP ) {
        xs.push( x );
    }
    if ( layer.peakAmp && azimuths ) {
        for ( const p of azimuths ) {
            const x = view.w / 2 + angleDiff( p.az, view.heading ) * pxPerDegH;
            if ( x > -margin && x < view.w + margin ) {
                xs.push( x );
            }
        }
        xs.sort( ( a, b ) => a - b );
    }

    ctx.beginPath();
    ctx.moveTo( xs[ 0 ], view.h );
    for ( const x of xs ) {
        const az = view.heading + ( x - view.w / 2 ) / pxPerDegH;
        ctx.lineTo( x, horizonY - ridgeHeight( az, layer, azimuths, view.h ) );
    }
    ctx.lineTo( xs[ xs.length - 1 ], view.h );
    ctx.closePath();

    const top = horizonY - layer.span * view.h;
    const tSolid = ( horizonY - layer.fadeSolid * view.h - top ) / ( view.h - top );
    const tBg = ( horizonY - layer.fadeBg * view.h - top ) / ( view.h - top );
    const grad = ctx.createLinearGradient( 0, top, 0, view.h );
    grad.addColorStop( 0, color );
    grad.addColorStop( Math.max( 0, Math.min( 1, tSolid ) ), color );
    grad.addColorStop( Math.max( 0, Math.min( 1, tBg ) ), view.sky );
    grad.addColorStop( 1, view.sky );
    ctx.fillStyle = grad;
    ctx.fill();
}

function drawTerrain( ctx, peaks, view, horizonY, pxPerDegH ) {
    const azimuths = view.location ? peakAzimuths( peaks, view.location, view.withinM ) : null;
    drawRidge( ctx, view, horizonY, pxPerDegH, BACK_LAYER, azimuths, view.ridge );
    drawRidge( ctx, view, horizonY, pxPerDegH, FRONT_LAYER, null, view.foothill );
}

// Small monochrome sun icon (disc + rays) in the theme text colour.
function sunIcon( ctx, x, y, color ) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc( x, y, 4.5, 0, 2 * Math.PI );
    ctx.fill();
    for ( let i = 0; i < 8; i++ ) {
        const a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo( x + Math.cos( a ) * 7, y + Math.sin( a ) * 7 );
        ctx.lineTo( x + Math.cos( a ) * 9.5, y + Math.sin( a ) * 9.5 );
        ctx.stroke();
    }
}

// Small monochrome crescent-moon icon (a lune) in the theme text colour.
function moonIcon( ctx, x, y, color ) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc( x, y, 7, 0.45 * Math.PI, 1.55 * Math.PI, false );
    ctx.arc( x + 3.5, y, 7.5, 1.4 * Math.PI, 0.6 * Math.PI, true );
    ctx.closePath();
    ctx.fill();
}

// Sun/moon rise & set markers on the horizon strip, just above the cardinal
// labels: an icon plus the time, all in the theme text colour.
function drawSky( ctx, view, horizonY, pxPerDegH ) {
    const c = view.celestial;
    if ( !c ) {
        return;
    }
    const iconY = horizonY - 56;
    const labelY = horizonY - 72;
    ctx.textAlign = "center";
    for ( const mk of c.markers ) {
        const x = view.w / 2 + angleDiff( mk.az, view.heading ) * pxPerDegH;
        const alpha = edgeAlpha( x, view.w );
        if ( alpha <= 0 ) {
            continue;
        }
        ctx.globalAlpha = alpha;
        if ( mk.kind === "sun" ) {
            sunIcon( ctx, x, iconY, view.text );
        } else {
            moonIcon( ctx, x, iconY, view.text );
        }
        ctx.fillStyle = view.text;
        drawLabel( ctx, mk.label, x, labelY, `12px ${ FONT }` );
        ctx.globalAlpha = 1;
    }
}

export function drawScene( ctx, peaks, view ) {
    // Camera mode: clear to transparent so the live feed shows through, and skip
    // the synthetic sky/terrain. Otherwise paint the themed sky and ridges.
    if ( view.camera ) {
        ctx.clearRect( 0, 0, view.w, view.h );
        ctx.fillStyle = `rgba(${ inkRgb( view.sky ) }, ${ view.skyVeil })`;
        ctx.fillRect( 0, 0, view.w, view.h );
    } else {
        ctx.fillStyle = view.sky;
        ctx.fillRect( 0, 0, view.w, view.h );
    }
    const pxPerDegH = view.w / H_FOV;
    const horizonY = view.h - HORIZON_OFFSET;

    if ( !view.camera ) {
        drawTerrain( ctx, peaks, view, horizonY, pxPerDegH );
    }
    drawHorizon( ctx, view, horizonY, pxPerDegH );
    drawSky( ctx, view, horizonY, pxPerDegH );

    let nearest = null;
    if ( view.location ) {
        const items = candidatePeaks( peaks, view, horizonY, pxPerDegH );
        placeFlags( ctx, items );
        drawPeaks( ctx, items, horizonY, view );
        const cx = view.w / 2;
        for ( const item of items ) {
            const dist = Math.abs( item.x - cx );
            if ( !nearest || dist < nearest.dist ) {
                nearest = { dist, key: item.key };
            }
        }
    }
    return nearest;
}
