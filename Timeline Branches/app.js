const NS = "http://www.w3.org/2000/svg";

const BASE = {
    laneHeight: 104,
    marginBottom: 34,
    marginLeft: 26,
    marginRight: 44,
    marginTop: 40,
    yearPx: 100
};

const MONTHS = [ "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" ];

let DATA;
let LAYOUT;
let trackById;
let MEMBERS;
let axisStart;
let axisEnd;
let BREAKPOINTS;
let SEGMENTS;
let UNIT;
let TRANSITIONS;
let selected = null;
let baseDataset;
let searchQuery = "";

function el( name, attrs ) {
    const node = document.createElementNS( NS, name );
    for ( const key in attrs ) {
        node.setAttribute( key, attrs[ key ] );
    }
    return node;
}

function parseDate( value ) {
    if ( typeof value === "number" ) return value;
    const [ year, month ] = String( value ).split( "-" ).map( Number );
    return year + ( month ? ( month - 1 ) / 12 : 0 );
}

function clamp( value, lo, hi ) {
    return Math.max( lo, Math.min( hi, value ) );
}

function xOf( year ) {
    return LAYOUT.marginLeft + ( year - axisStart ) * BASE.yearPx;
}

function laneCenter( trackId ) {
    return LAYOUT.marginTop + trackById[ trackId ].index * LAYOUT.laneHeight + LAYOUT.laneHeight / 2;
}

function byIndex( a, b ) {
    return trackById[ a ].index - trackById[ b ].index;
}

function activeAt( member, year ) {
    return member.tenures.filter( ( t ) => t.start <= year && year < t.end ).map( ( t ) => t.track );
}

function fmtYear( v ) {
    const year = Math.floor( v + 1e-9 );
    const month = Math.round( ( v - year ) * 12 );
    return month ? `${MONTHS[ month ]} ${year}` : String( year );
}

function segGap( i, j ) {
    const wi = SEGMENTS[ i ].xEnd - SEGMENTS[ i ].xStart;
    const wj = SEGMENTS[ j ].xEnd - SEGMENTS[ j ].xStart;
    return Math.min( BASE.yearPx * 0.42, wi * 0.35, wj * 0.35 );
}

function prepare( dataset ) {
    DATA = dataset;
    axisStart = parseDate( dataset.start );
    axisEnd = parseDate( dataset.end );
    trackById = Object.fromEntries( dataset.tracks.map( ( t, i ) => [ t.id, {
        ...t,
        end: clamp( parseDate( t.end ), axisStart, axisEnd ),
        index: i,
        start: clamp( parseDate( t.start ), axisStart, axisEnd )
    } ] ) );

    MEMBERS = dataset.members.map( ( m ) => ( {
        name: m.name,
        tenures: m.tenures.filter( ( t ) => trackById[ t.track ] ).map( ( t ) => {
            const track = trackById[ t.track ];
            return { end: Math.min( parseDate( t.end ), track.end ), start: Math.max( parseDate( t.start ), track.start ), track: t.track };
        } ).filter( ( t ) => t.end > t.start )
    } ) );

    LAYOUT = {
        ...BASE,
        height: BASE.marginTop + dataset.tracks.length * BASE.laneHeight + BASE.marginBottom,
        laneHeight: BASE.laneHeight,
        width: BASE.marginLeft + ( axisEnd - axisStart ) * BASE.yearPx + BASE.marginRight
    };

    const years = new Set( [ axisStart, axisEnd ] );
    MEMBERS.forEach( ( m ) => m.tenures.forEach( ( t ) => {
        years.add( t.start );
        years.add( t.end );
    } ) );
    BREAKPOINTS = [ ...years ].sort( ( a, b ) => a - b );

    SEGMENTS = [];
    let maxStack = 1;
    for ( let i = 0; i < BREAKPOINTS.length - 1; i++ ) {
        const start = BREAKPOINTS[ i ];
        const counts = {};
        const present = new Map();
        MEMBERS.forEach( ( member, mi ) => {
            const active = activeAt( member, start );
            if ( active.length ) {
                present.set( mi, active );
                active.forEach( ( c ) => ( counts[ c ] = ( counts[ c ] || 0 ) + 1 ) );
            }
        } );
        Object.values( counts ).forEach( ( n ) => ( maxStack = Math.max( maxStack, n ) ) );
        SEGMENTS.push( { counts, present, xEnd: xOf( BREAKPOINTS[ i + 1 ] ), xStart: xOf( start ) } );
    }
    UNIT = Math.min( 13, ( LAYOUT.laneHeight - 26 ) / maxStack );

    TRANSITIONS = [];
    for ( let i = 0; i < SEGMENTS.length - 1; i++ ) {
        const pairs = {};
        const add = ( from, to ) => {
            ( pairs[ from ] ||= {} );
            pairs[ from ][ to ] = ( pairs[ from ][ to ] || 0 ) + 1;
        };
        const people = new Set( [ ...SEGMENTS[ i ].present.keys(), ...SEGMENTS[ i + 1 ].present.keys() ] );
        people.forEach( ( mi ) => {
            const before = new Set( SEGMENTS[ i ].present.get( mi ) || [] );
            const after = new Set( SEGMENTS[ i + 1 ].present.get( mi ) || [] );
            const stays = [ ...before ].filter( ( c ) => after.has( c ) );
            const endings = [ ...before ].filter( ( c ) => !after.has( c ) ).sort( byIndex );
            const starts = [ ...after ].filter( ( c ) => !before.has( c ) ).sort( byIndex );
            stays.forEach( ( c ) => add( c, c ) );
            for ( let k = 0; k < Math.min( endings.length, starts.length ); k++ ) add( endings[ k ], starts[ k ] );
        } );

        const orderedKeys = ( obj, self ) => Object.keys( obj ).sort( ( a, b ) => ( a === self ? -1 : b === self ? 1 : byIndex( a, b ) ) );

        const sRange = {};
        Object.keys( pairs ).forEach( ( from ) => {
            let cursor = laneCenter( from ) - SEGMENTS[ i ].counts[ from ] * UNIT / 2;
            orderedKeys( pairs[ from ], from ).forEach( ( to ) => {
                const h = pairs[ from ][ to ] * UNIT;
                sRange[ `${from}|${to}` ] = [ cursor, cursor + h ];
                cursor += h;
            } );
        } );

        const inByDest = {};
        Object.keys( pairs ).forEach( ( from ) => Object.keys( pairs[ from ] ).forEach( ( to ) => {
            ( inByDest[ to ] ||= {} );
            inByDest[ to ][ from ] = pairs[ from ][ to ];
        } ) );

        const dRange = {};
        Object.keys( inByDest ).forEach( ( to ) => {
            let cursor = laneCenter( to ) - SEGMENTS[ i + 1 ].counts[ to ] * UNIT / 2;
            orderedKeys( inByDest[ to ], to ).forEach( ( from ) => {
                const h = inByDest[ to ][ from ] * UNIT;
                dRange[ `${from}|${to}` ] = [ cursor, cursor + h ];
                cursor += h;
            } );
        } );

        const gap = segGap( i, i + 1 );
        TRANSITIONS.push( {
            dRange,
            inSet: new Set( Object.keys( inByDest ) ),
            mid: SEGMENTS[ i ].xEnd,
            outSet: new Set( Object.keys( pairs ) ),
            pairs,
            sRange,
            xLeft: SEGMENTS[ i ].xEnd + gap,
            xRight: SEGMENTS[ i ].xEnd - gap
        } );
    }
}

function buildChart() {
    const svg = el( "svg", { height: LAYOUT.height, viewBox: `0 0 ${LAYOUT.width} ${LAYOUT.height}`, width: LAYOUT.width } );

    DATA.tracks.forEach( ( t, i ) => {
        svg.appendChild( el( "rect", {
            fill: i % 2 ? "var(--lane-alt)" : "var(--lane)",
            height: LAYOUT.laneHeight,
            width: LAYOUT.width,
            x: 0,
            y: LAYOUT.marginTop + i * LAYOUT.laneHeight
        } ) );
    } );

    for ( let yr = Math.ceil( axisStart ); yr <= Math.floor( axisEnd ); yr++ ) {
        const x = xOf( yr );
        svg.appendChild( el( "line", { class: "year-line", x1: x, x2: x, y1: LAYOUT.marginTop, y2: LAYOUT.height - LAYOUT.marginBottom } ) );
        const t = el( "text", { class: "year-text", x: x, y: LAYOUT.marginTop - 14 } );
        t.textContent = yr;
        svg.appendChild( t );
    }

    drawTrackLife( svg );
    drawRibbons( svg );
    drawNodes( svg );

    document.getElementById( "chart" ).appendChild( svg );
}

function drawTrackLife( svg ) {
    DATA.tracks.forEach( ( t ) => {
        const track = trackById[ t.id ];
        const cy = laneCenter( t.id );
        svg.appendChild( el( "line", {
            "data-tracks": t.id,
            class: "piece track-life",
            stroke: track.color,
            "stroke-dasharray": "1 5",
            "stroke-opacity": 0.45,
            "stroke-width": 2,
            x1: xOf( track.start ),
            x2: xOf( track.end ),
            y1: cy,
            y2: cy
        } ) );
        [ [ track.start, track.start > axisStart ], [ track.end, track.end < axisEnd ] ].forEach( ( [ at, show ] ) => {
            if ( !show ) return;
            const x = xOf( at );
            svg.appendChild( el( "line", {
                "data-tracks": t.id,
                class: "piece track-edge",
                stroke: track.color,
                "stroke-opacity": 0.7,
                "stroke-width": 2,
                x1: x,
                x2: x,
                y1: cy - 12,
                y2: cy + 12
            } ) );
        } );
    } );
}

function drawRibbons( svg ) {
    TRANSITIONS.forEach( ( tr ) => {
        Object.keys( tr.pairs ).forEach( ( from ) => Object.keys( tr.pairs[ from ] ).forEach( ( to ) => {
            const [ s0, s1 ] = tr.sRange[ `${from}|${to}` ];
            const [ d0, d1 ] = tr.dRange[ `${from}|${to}` ];
            svg.appendChild( el( "path", {
                class: "piece ribbon",
                "data-tracks": `${from} ${to}`,
                d: `M ${tr.xRight} ${s0} C ${tr.mid} ${s0} ${tr.mid} ${d0} ${tr.xLeft} ${d0} L ${tr.xLeft} ${d1} C ${tr.mid} ${d1} ${tr.mid} ${s1} ${tr.xRight} ${s1} Z`,
                fill: trackById[ from ].color,
                "fill-opacity": from === to ? 0.62 : 0.4
            } ) );
        } ) );
    } );
}

function drawNodes( svg ) {
    SEGMENTS.forEach( ( seg, i ) => {
        for ( const track in seg.counts ) {
            const twLeft = i > 0 && TRANSITIONS[ i - 1 ].inSet.has( track ) ? segGap( i - 1, i ) : 0;
            const twRight = i < SEGMENTS.length - 1 && TRANSITIONS[ i ].outSet.has( track ) ? segGap( i, i + 1 ) : 0;
            const left = seg.xStart + twLeft;
            const right = seg.xEnd - twRight;
            const h = seg.counts[ track ] * UNIT;
            if ( right > left ) {
                svg.appendChild( el( "rect", {
                    class: "piece node",
                    "data-tracks": track,
                    fill: trackById[ track ].color,
                    height: h,
                    rx: 2,
                    width: right - left,
                    x: left,
                    y: laneCenter( track ) - h / 2
                } ) );
            }
        }
    } );
}

function buildLanes() {
    const lanes = document.getElementById( "lanes" );
    const spacer = document.createElement( "div" );
    spacer.style.height = `${LAYOUT.marginTop}px`;
    lanes.appendChild( spacer );
    DATA.tracks.forEach( ( t ) => {
        const row = document.createElement( "div" );
        row.className = "lanes__row";
        row.dataset.track = t.id;
        row.style.height = `${LAYOUT.laneHeight}px`;
        row.tabIndex = 0;
        row.setAttribute( "role", "button" );
        row.setAttribute( "aria-pressed", "false" );
        row.innerHTML = `<span class="lanes__bar" style="background:${t.color}"></span><span class="lanes__name">${t.name}</span>`;
        row.addEventListener( "click", () => toggleTrack( t.id ) );
        row.addEventListener( "keydown", ( e ) => {
            if ( e.key === "Enter" || e.key === " " ) {
                e.preventDefault();
                toggleTrack( t.id );
            }
        } );
        lanes.appendChild( row );
    } );
}

function matchedSet() {
    if ( !searchQuery ) return null;
    return new Set( DATA.tracks.filter( ( t ) => trackText( t ).includes( searchQuery ) ).map( ( t ) => t.id ) );
}

function applyHighlight() {
    const focus = selected ? new Set( [ selected ] ) : matchedSet();
    document.querySelectorAll( ".piece" ).forEach( ( p ) => {
        const keep = !focus || p.dataset.tracks.split( " " ).some( ( id ) => focus.has( id ) );
        p.classList.toggle( "is-dim", !keep );
    } );
}

function setActiveRow( trackId ) {
    document.querySelectorAll( ".lanes__row" ).forEach( ( row ) => {
        const on = row.dataset.track === trackId;
        row.classList.toggle( "is-active", on );
        row.setAttribute( "aria-pressed", String( on ) );
    } );
}

function closeDetail() {
    const detail = document.getElementById( "detail" );
    detail.classList.remove( "is-open" );
    detail.innerHTML = "";
}

function toggleTrack( trackId ) {
    selected = selected === trackId ? null : trackId;
    setActiveRow( selected );
    if ( selected ) showDetail( selected );
    else closeDetail();
    applyHighlight();
}

function relatedTracks( trackId ) {
    const incoming = {};
    const outgoing = {};
    TRANSITIONS.forEach( ( tr ) => Object.keys( tr.pairs ).forEach( ( from ) => Object.keys( tr.pairs[ from ] ).forEach( ( to ) => {
        if ( from === to ) return;
        const n = tr.pairs[ from ][ to ];
        if ( to === trackId ) incoming[ from ] = ( incoming[ from ] || 0 ) + n;
        if ( from === trackId ) outgoing[ to ] = ( outgoing[ to ] || 0 ) + n;
    } ) ) );
    const toList = ( obj ) => Object.entries( obj ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] );
    return { incoming: toList( incoming ), outgoing: toList( outgoing ) };
}

function showDetail( trackId ) {
    const track = trackById[ trackId ];
    const { incoming, outgoing } = relatedTracks( trackId );
    const rows = ( list ) => list.length
        ? `<ul>${list.map( ( [ id, n ] ) => `<li><span class="detail__swatch" style="background:${trackById[ id ].color}"></span>${trackById[ id ].name}<span class="detail__count">${n}</span></li>` ).join( "" )}</ul>`
        : `<p class="detail__none">None</p>`;
    const loc = [ track.location.city, track.location.state, track.location.country ].filter( Boolean ).join( ", " );
    const detail = document.getElementById( "detail" );
    detail.classList.add( "is-open" );
    detail.innerHTML =
        `<h3><span class="detail__bar" style="background:${track.color}"></span>${track.name}</h3>` +
        `<p class="detail__loc">${loc}</p>` +
        `<h4>Incoming from</h4>${rows( incoming )}` +
        `<h4>Outgoing to</h4>${rows( outgoing )}`;
}

function render( dataset ) {
    prepare( dataset );
    document.getElementById( "title" ).textContent = dataset.title;
    document.getElementById( "caption" ).textContent = dataset.caption;
    document.title = `Timeline Branches — ${dataset.title}`;
    [ "lanes", "chart" ].forEach( ( id ) => ( document.getElementById( id ).innerHTML = "" ) );
    buildLanes();
    buildChart();
    selected = null;
    setActiveRow( null );
    closeDetail();
    applyHighlight();
    document.getElementById( "scroller" ).scrollLeft = 0;
}

function trackText( t ) {
    const l = t.location || {};
    return [ t.name, l.city, l.state, l.country ].filter( Boolean ).join( " " ).toLowerCase();
}

function applyView() {
    const lo = Math.floor( parseDate( baseDataset.start ) );
    const hi = Math.ceil( parseDate( baseDataset.end ) );
    const fromVal = document.getElementById( "from" ).value;
    const toVal = document.getElementById( "to" ).value;
    const start = fromVal === "" ? lo : clamp( Math.round( Number( fromVal ) ), lo, hi - 1 );
    const end = toVal === "" ? hi : clamp( Math.round( Number( toVal ) ), start + 1, hi );
    render( { ...baseDataset, end, start } );
}

function setBase( dataset ) {
    baseDataset = dataset;
    searchQuery = "";
    document.getElementById( "search" ).value = "";
    document.getElementById( "from" ).value = Math.floor( parseDate( dataset.start ) );
    document.getElementById( "to" ).value = Math.ceil( parseDate( dataset.end ) );
    applyView();
}

function init() {
    const picker = document.getElementById( "dataset" );
    DATASETS.forEach( ( d ) => {
        const opt = document.createElement( "option" );
        opt.textContent = d.title;
        opt.value = d.id;
        picker.appendChild( opt );
    } );
    picker.closest( ".picker" ).style.display = DATASETS.length > 1 ? "" : "none";
    picker.addEventListener( "change", () => setBase( DATASETS.find( ( d ) => d.id === picker.value ) ) );
    document.getElementById( "search" ).addEventListener( "input", ( e ) => {
        searchQuery = e.target.value.trim().toLowerCase();
        applyHighlight();
    } );
    [ "from", "to" ].forEach( ( id ) => document.getElementById( id ).addEventListener( "input", applyView ) );
    document.getElementById( "clear" ).addEventListener( "click", () => setBase( baseDataset ) );
    setBase( DATASETS[ 0 ] );
}

init();
