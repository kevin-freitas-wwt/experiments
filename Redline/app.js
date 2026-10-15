( function() {
    "use strict";

    const $ = ( id ) => document.getElementById( id );
    const main = $( "main" ), video = $( "video" ), transcript = $( "transcript" );
    const float = $( "float" ), insert = $( "insert" );
    const MOBILE = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test( navigator.userAgent );
    const IOS = /iPhone|iPad|iPod/.test( navigator.userAgent ) || ( navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 );
    const MODELS = {
        small: "onnx-community/whisper-small.en_timestamped",
        base: "onnx-community/whisper-base.en_timestamped"
    };
    const KEEP = 0, CUT = 1, BLEEP = 2;
    const SNAP = 0.35;
    const PAD = 0.04;
    const BLEEP_PAD = 0.14;
    const BLEEP_INTRUDE = 0.05;
    const FALLBACK_MAX_SEC = 2 * 3600;
    const MEM_EXPORT_MAX = 1.5e9;

    /* ---------- state ---------- */

    let file = null, url = null, duration = 0, docKey = null;
    let words = [];
    let mark = [];
    let seq = [];
    let moved = [];
    let undo = [];
    let segments = [];
    let spans = [];
    let sel = null;
    let caret = -1, anchor = -1;
    let nowIndex = -1;
    let worker = null, exporter = null, runCounter = 0, skippedSec = 0;
    let userScrolledAt = 0;
    let transcribing = false;
    let env = null;
    let outputTime = false;
    let skipping = false;
    let moving = null;
    let settings = { pauses: false, pauseMin: 1.5, pauseTo: 0.4, captions: false, capSize: "m", punch: false, punchPct: 5 };

    /* ---------- helpers ---------- */

    const pad = ( n, w = 2 ) => String( n ).padStart( w, "0" );

    function tc( t, frac = true ) {
        t = Math.max( 0, t || 0 );
        const h = Math.floor( t / 3600 ), m = Math.floor( t / 60 ) % 60, s = Math.floor( t % 60 );
        const base = ( h ? h + ":" + pad( m ) : pad( m ) ) + ":" + pad( s );
        return frac ? base + "." + pad( Math.floor( ( t % 1 ) * 100 ) ) : base;
    }

    function fmtBytes( b ) {
        if ( b > 1e9 ) return ( b / 1e9 ).toFixed( 2 ) + " GB";
        if ( b > 1e6 ) return ( b / 1e6 ).toFixed( 0 ) + " MB";
        return ( b / 1e3 ).toFixed( 0 ) + " KB";
    }

    function setStatus( text ) { $( "status" ).textContent = text || ""; }

    function wordAt( t ) {
        let lo = 0, hi = words.length - 1, best = -1;
        while ( lo <= hi ) {
            const mid = ( lo + hi ) >> 1;
            if ( words[ mid ].start <= t ) { best = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if ( best >= 0 && t > words[ best ].end + 1.5 ) return -1;
        return best;
    }

    function segAt( t ) {
        for ( const g of segments ) if ( t >= g.s && t < g.e ) return g;
        return null;
    }

    function outTime( t ) {
        const g = segAt( t );
        if ( g ) return g.out + ( t - g.s );
        let best = null;
        for ( const g2 of segments ) if ( g2.e <= t && ( !best || g2.e > best.e ) ) best = g2;
        return best ? best.out + ( best.e - best.s ) : 0;
    }

    const shown = ( t ) => outputTime ? outTime( t ) : t;
    const outLength = () => segments.reduce( ( s, g ) => s + ( g.e - g.s ), 0 );

    /* ---------- persistence (IndexedDB) ---------- */

    let idb = null;
    const idbReady = new Promise( ( resolve ) => {
        const req = indexedDB.open( "redline", 1 );
        req.onupgradeneeded = () => req.result.createObjectStore( "docs" );
        req.onsuccess = () => { idb = req.result; resolve(); };
        req.onerror = () => resolve();
    } );

    let saveTimer = 0;
    function save() {
        if ( !docKey ) return;
        clearTimeout( saveTimer );
        saveTimer = setTimeout( () => {
            if ( !idb ) return;
            const tx = idb.transaction( "docs", "readwrite" );
            tx.objectStore( "docs" ).put( { words, mark: mark.join( "" ), seq, moved: moved.map( Number ).join( "" ), env, done: !transcribing, at: Date.now() }, docKey );
            tx.oncomplete = () => prune();
        }, 300 );
    }

    function prune() {
        const store = idb.transaction( "docs", "readwrite" ).objectStore( "docs" );
        const req = store.getAllKeys();
        req.onsuccess = () => {
            const keys = req.result;
            if ( keys.length <= 12 ) return;
            const all = store.getAll();
            all.onsuccess = () => {
                all.result.map( ( d, i ) => [ d.at || 0, keys[ i ] ] ).sort( ( a, b ) => a[ 0 ] - b[ 0 ] )
                    .slice( 0, keys.length - 12 ).forEach( ( [ , k ] ) => store.delete( k ) );
            };
        };
    }

    async function restore() {
        await idbReady;
        if ( !idb ) return false;
        const d = await new Promise( ( resolve ) => {
            const req = idb.transaction( "docs" ).objectStore( "docs" ).get( docKey );
            req.onsuccess = () => resolve( req.result || null );
            req.onerror = () => resolve( null );
        } );
        if ( !d || !d.done || !d.words?.length ) return false;
        words = d.words;
        mark = d.mark ? [ ...d.mark ].map( Number ) : ( d.cut ? [ ...d.cut ].map( ( c ) => c === "1" ? CUT : KEEP ) : words.map( () => KEEP ) );
        seq = d.seq?.length === words.length ? d.seq : words.map( ( _, i ) => i );
        moved = d.moved ? [ ...d.moved ].map( ( c ) => c === "1" ) : words.map( () => false );
        env = d.env || null;
        return true;
    }

    function loadSettings() {
        try { Object.assign( settings, JSON.parse( localStorage.getItem( "redline.settings" ) || "{}" ) ); } catch {}
        $( "setPauses" ).checked = settings.pauses; $( "setPauseMin" ).value = settings.pauseMin; $( "setPauseTo" ).value = settings.pauseTo;
        $( "setCaptions" ).checked = settings.captions; $( "setCapSize" ).value = settings.capSize;
        $( "setPunch" ).checked = settings.punch; $( "setPunchPct" ).value = settings.punchPct;
    }

    function readSettings() {
        settings = {
            pauses: $( "setPauses" ).checked, pauseMin: +$( "setPauseMin" ).value || 1.5, pauseTo: +$( "setPauseTo" ).value || 0,
            captions: $( "setCaptions" ).checked, capSize: $( "setCapSize" ).value,
            punch: $( "setPunch" ).checked, punchPct: Math.min( 15, Math.max( 1, +$( "setPunchPct" ).value || 5 ) )
        };
        try { localStorage.setItem( "redline.settings", JSON.stringify( settings ) ); } catch {}
        $( "btnSettings" ).setAttribute( "aria-pressed", String( settings.pauses || settings.captions || settings.punch ) );
        rebuildAll();
    }

    /* ---------- transcript rendering ---------- */

    function resetDoc() {
        transcript.innerHTML = "";
        spans = []; nowIndex = -1; caret = -1; anchor = -1;
    }

    function renderAll() {
        resetDoc();
        let para = null, lastW = null, paraStart = 0, prevIdx = -2;
        const frag = document.createDocumentFragment();
        for ( const i of seq ) {
            const w = words[ i ];
            const contiguous = i === prevIdx + 1;
            const gap = lastW && contiguous ? w.start - lastW.end : 0;
            const sentenceEnd = lastW && /[.?!]["')\]]?$/.test( lastW.text );
            const blockEdge = !contiguous || ( lastW && moved[ i ] !== moved[ prevIdx ] );
            const breakPara = !para || blockEdge || gap > 1.1 || ( sentenceEnd && gap > 0.45 ) || ( sentenceEnd && w.start - paraStart > 40 );
            if ( breakPara ) {
                para = document.createElement( "p" );
                para.className = "para" + ( moved[ i ] ? " is-moved" : "" );
                const label = document.createElement( "span" );
                label.className = "para-tc";
                label.dataset.t = w.start;
                label.textContent = tc( shown( w.start ), false );
                para.appendChild( label );
                frag.appendChild( para );
                paraStart = w.start;
            } else {
                para.appendChild( document.createTextNode( " " ) );
            }
            const span = document.createElement( "span" );
            span.className = "w";
            span.dataset.i = i;
            span.textContent = w.text;
            para.appendChild( span );
            spans[ i ] = span;
            lastW = w; prevIdx = i;
        }
        transcript.appendChild( frag );
        decorate();
    }

    function appendStreaming( list, startIndex ) {
        for ( let k = 0; k < list.length; k++ ) { seq.push( startIndex + k ); mark.push( KEEP ); moved.push( false ); }
        renderAll();
    }

    function decorate() {
        for ( let i = 0; i < spans.length; i++ ) {
            const sp = spans[ i ];
            if ( !sp ) continue;
            sp.classList.toggle( "is-cut", mark[ i ] === CUT );
            sp.classList.toggle( "is-bleep", mark[ i ] === BLEEP );
            sp.classList.toggle( "is-moved", !!moved[ i ] );
        }
    }

    function relabel() {
        for ( const l of transcript.querySelectorAll( ".para-tc" ) ) l.textContent = tc( shown( +l.dataset.t ), false );
    }

    /* ---------- silence ---------- */

    function energyAt( t ) {
        if ( !env ) return 255;
        const i = Math.floor( t * 100 );
        return i < 0 || i >= env.length ? 255 : env[ i ];
    }

    function snapEdge( t, dir, limit ) {
        if ( !env ) return t;
        const n = Math.round( SNAP * 100 );
        let best = t, bestE = energyAt( t ), floor = 255;
        for ( let k = 0; k <= n; k++ ) floor = Math.min( floor, energyAt( t + dir * k / 100 ) );
        for ( let k = 1; k <= n; k++ ) {
            const x = t + dir * k / 100;
            if ( dir < 0 ? x < limit : x > limit ) break;
            const e = energyAt( x );
            if ( e <= floor + 6 ) { best = x; break; }
            if ( e < bestE ) { best = x; bestE = e; }
        }
        return best;
    }

    function quietPoint( t0, t1 ) {
        if ( t1 - t0 < 0.02 ) return ( t0 + t1 ) / 2;
        let best = ( t0 + t1 ) / 2, bestE = Infinity;
        for ( let t = t0 + 0.01; t < t1; t += 0.01 ) {
            const e = energyAt( t );
            if ( e < bestE ) { bestE = e; best = t; }
        }
        return best;
    }

    function pauseCuts( a, b ) {
        if ( !settings.pauses || !env ) return [];
        const out = [];
        for ( let i = a; i < b; i++ ) {
            const gapStart = words[ i ].end, gapEnd = words[ i + 1 ].start;
            if ( gapEnd - gapStart < settings.pauseMin ) continue;
            let floor = 255;
            for ( let t = gapStart; t < gapEnd; t += 0.01 ) floor = Math.min( floor, energyAt( t ) );
            let s0 = -1, run = [];
            for ( let t = gapStart; t <= gapEnd + 1e-6; t += 0.01 ) {
                const quiet = t < gapEnd && energyAt( t ) <= floor + 9;
                if ( quiet && s0 < 0 ) s0 = t;
                if ( !quiet && s0 >= 0 ) { run.push( [ s0, t ] ); s0 = -1; }
            }
            for ( const [ qs, qe ] of run ) {
                if ( qe - qs < settings.pauseMin ) continue;
                const half = settings.pauseTo / 2;
                out.push( [ qs + half, qe - half ] );
            }
        }
        return out;
    }

    /* ---------- timeline ---------- */

    let pauses = [];

    function rebuildAll() {
        segments = []; pauses = [];
        const n = words.length;
        if ( !n ) { paintStrip(); return; }
        const blocks = [];
        let k = 0;
        while ( k < seq.length ) {
            const i = seq[ k ];
            if ( mark[ i ] === CUT ) { k++; continue; }
            let j = k;
            while ( j + 1 < seq.length && seq[ j + 1 ] === seq[ j ] + 1 && mark[ seq[ j + 1 ] ] !== CUT && moved[ seq[ j + 1 ] ] === moved[ i ] ) j++;
            blocks.push( { a: i, b: seq[ j ], moved: !!moved[ i ] } );
            k = j + 1;
        }
        for ( const bl of blocks ) {
            const prevEnd = bl.a > 0 ? words[ bl.a - 1 ].end : 0;
            const nextStart = bl.b < n - 1 ? words[ bl.b + 1 ].start : duration;
            bl.s = bl.a === 0 && !bl.moved ? 0 : Math.max( prevEnd, Math.min( words[ bl.a ].start, snapEdge( words[ bl.a ].start - PAD, -1, prevEnd ) ) );
            bl.e = bl.b === n - 1 && !bl.moved ? duration : Math.min( nextStart, Math.max( words[ bl.b ].end, snapEdge( words[ bl.b ].end + PAD, 1, nextStart ) ) );
        }
        const bySrc = blocks.slice().sort( ( x, y ) => x.a - y.a );
        for ( let k = 1; k < bySrc.length; k++ ) {
            const prev = bySrc[ k - 1 ], cur = bySrc[ k ];
            if ( cur.a === prev.b + 1 ) {
                const q = quietPoint( words[ prev.b ].end, words[ cur.a ].start );
                prev.e = q; cur.s = q;
            } else if ( cur.s < prev.e ) {
                cur.s = prev.e;
            }
        }
        let out = 0, order = 0;
        for ( const bl of blocks ) {
            const s = bl.s, e = bl.e;
            const pieces = [];
            let cur = s;
            for ( const [ ps, pe ] of pauseCuts( bl.a, bl.b ) ) {
                if ( ps > cur ) pieces.push( [ cur, ps ] );
                pieces.push( [ ps, pe, "pause" ] );
                cur = pe;
            }
            pieces.push( [ cur, e ] );
            for ( const [ ps, pe, kind ] of pieces ) {
                if ( pe - ps <= 0.001 ) continue;
                if ( kind === "pause" ) { pauses.push( [ ps, pe ] ); continue; }
                segments.push( { s: ps, e: pe, out, moved: bl.moved, order: order++, a: bl.a, b: bl.b } );
                out += pe - ps;
            }
        }
        paintStrip();
        $( "tcLen" ).textContent = tc( outputTime ? out : duration, false );
        const removed = duration - out;
        $( "tcCut" ).textContent = removed > 0.05 ? ( outputTime ? `(−${ tc( removed, false ) })` : `−${ tc( removed, false ) } → ${ tc( out, false ) }` ) : "";
        const cuts = countRuns( CUT ), bleeps = countRuns( BLEEP ), moves = blocks.filter( ( b ) => b.moved ).length;
        const bits = [];
        if ( cuts ) bits.push( `${ cuts } cut${ cuts > 1 ? "s" : "" }` );
        if ( pauses.length ) bits.push( `${ pauses.length } pause${ pauses.length > 1 ? "s" : "" }` );
        if ( bleeps ) bits.push( `${ bleeps } bleep${ bleeps > 1 ? "s" : "" }` );
        if ( moves ) bits.push( `${ moves } moved` );
        if ( removed > 0.05 ) bits.push( `${ removed.toFixed( 1 ) }s removed` );
        $( "toolsNote" ).textContent = bits.join( " · " );
        $( "btnUndo" ).disabled = !undo.length;
        $( "btnExport" ).disabled = transcribing || !words.length;
        for ( const id of [ "btnFillers", "btnTranscript", "btnFind" ] ) $( id ).disabled = transcribing || !words.length;
        if ( outputTime ) relabel();
        decorate();
        updateSelButtons();
        save();
    }

    function countRuns( kind ) {
        let n = 0;
        for ( let k = 0; k < seq.length; k++ ) {
            const i = seq[ k ];
            if ( mark[ i ] === kind && ( k === 0 || mark[ seq[ k - 1 ] ] !== kind || seq[ k - 1 ] !== i - 1 ) ) n++;
        }
        return n;
    }

    function paintStrip() {
        if ( !duration ) return;
        const pct = ( t ) => ( t / duration * 100 ).toFixed( 3 ) + "%";
        const w = ( a, b ) => Math.max( 0.15, ( b - a ) / duration * 100 ).toFixed( 3 ) + "%";
        let html = "";
        let cs = -1;
        const flush = ( e ) => { if ( cs >= 0 ) { html += `<div class="strip-cut" style="left:${ pct( cs ) };width:${ w( cs, e ) }"></div>`; cs = -1; } };
        for ( let i = 0; i < words.length; i++ ) {
            if ( mark[ i ] === CUT ) { if ( cs < 0 ) cs = i > 0 ? Math.min( words[ i ].start, segEndBefore( i ) ) : 0; }
            else flush( Math.max( words[ i - 1 ]?.end ?? 0, segStartAfter( i ) ) );
        }
        flush( duration );
        for ( const [ a, b ] of pauses ) html += `<div class="strip-cut is-pause" style="left:${ pct( a ) };width:${ w( a, b ) }"></div>`;
        for ( const g of segments ) if ( g.moved ) html += `<div class="strip-cut is-moved" style="left:${ pct( g.s ) };width:${ w( g.s, g.e ) }"></div>`;
        for ( const [ a, b ] of bleepRanges() ) html += `<div class="strip-cut is-bleep" style="left:${ pct( a ) };width:${ w( a, b ) }"></div>`;
        $( "stripCuts" ).innerHTML = html;
    }

    function segEndBefore( i ) {
        for ( const g of segments ) if ( g.b === i - 1 ) return g.e;
        return words[ i - 1 ].end;
    }

    function segStartAfter( i ) {
        for ( const g of segments ) if ( g.a === i ) return g.s;
        return words[ i ].start;
    }

    function bleepRanges() {
        const out = [];
        for ( let i = 0; i < words.length; i++ ) {
            if ( mark[ i ] !== BLEEP ) continue;
            let j = i;
            while ( j + 1 < words.length && mark[ j + 1 ] === BLEEP ) j++;
            const prevEnd = i > 0 ? words[ i - 1 ].end : 0;
            const nextStart = j < words.length - 1 ? words[ j + 1 ].start : duration;
            const start = Math.max( 0, Math.min( words[ i ].start - BLEEP_INTRUDE, Math.max( prevEnd, words[ i ].start - BLEEP_PAD ) ) );
            const end = Math.min( duration || Infinity, Math.max( words[ j ].end + BLEEP_INTRUDE, Math.min( nextStart, words[ j ].end + BLEEP_PAD ) ) );
            out.push( [ start, end ] );
            i = j;
        }
        return out;
    }

    /* ---------- edits ---------- */

    function pushUndo() {
        undo.push( { mark: mark.slice(), seq: seq.slice(), moved: moved.slice() } );
        if ( undo.length > 100 ) undo.shift();
    }

    function selIndices( s ) {
        const out = [];
        for ( let k = s.from; k <= s.to; k++ ) out.push( seq[ k ] );
        return out;
    }

    function setMark( s, kind ) {
        if ( !s ) return;
        pushUndo();
        for ( const i of selIndices( s ) ) mark[ i ] = kind;
        afterEdit( kind === KEEP ? seq[ s.from ] : seq[ s.to ] );
    }

    function restoreSel( s ) {
        if ( !s ) return;
        pushUndo();
        const ids = selIndices( s );
        const anyMoved = ids.some( ( i ) => moved[ i ] );
        for ( const i of ids ) mark[ i ] = KEEP;
        if ( anyMoved ) {
            const set = new Set( ids.filter( ( i ) => moved[ i ] ) );
            for ( const i of set ) moved[ i ] = false;
            seq = seq.filter( ( i ) => !set.has( i ) );
            for ( const i of [ ...set ].sort( ( a, b ) => a - b ) ) {
                let pos = seq.findIndex( ( x ) => x > i && !moved[ x ] );
                if ( pos < 0 ) pos = seq.length;
                seq.splice( pos, 0, i );
            }
            renderAll();
        }
        afterEdit( ids[ 0 ] );
    }

    function keepOnly( s ) {
        if ( !s ) return;
        pushUndo();
        const keep = new Set( selIndices( s ) );
        for ( let i = 0; i < words.length; i++ ) if ( !keep.has( i ) && mark[ i ] !== BLEEP ) mark[ i ] = CUT;
        afterEdit( seq[ s.from ] );
    }

    function moveWords( ids, beforeIndex ) {
        pushUndo();
        const set = new Set( ids );
        const rest = seq.filter( ( i ) => !set.has( i ) );
        let pos = beforeIndex < 0 ? rest.length : rest.indexOf( beforeIndex );
        if ( pos < 0 ) pos = rest.length;
        const naturalPos = rest.findIndex( ( x ) => x > ids[ 0 ] && !moved[ x ] );
        const backHome = pos === ( naturalPos < 0 ? rest.length : naturalPos );
        for ( const i of ids ) moved[ i ] = !backHome;
        seq = [ ...rest.slice( 0, pos ), ...ids, ...rest.slice( pos ) ];
        renderAll();
        afterEdit( ids[ 0 ] );
        spans[ ids[ 0 ] ]?.scrollIntoView( { block: "nearest", behavior: "smooth" } );
    }

    function afterEdit( focusIndex ) {
        rebuildAll();
        window.getSelection()?.removeAllRanges();
        sel = null;
        hideFloat();
        if ( focusIndex >= 0 ) setCaret( seq.indexOf( focusIndex ), false );
    }

    function doUndo() {
        if ( !undo.length ) return;
        const u = undo.pop();
        const reorder = u.seq.join() !== seq.join();
        mark = u.mark; seq = u.seq; moved = u.moved;
        if ( reorder ) renderAll();
        rebuildAll();
    }

    /* ---------- filler pass ---------- */

    const FILLER = /^(um+|uh+|uhm+|erm*|ah+|hmm+|mm+|mhm)[,.!?]?$/i;
    const FILLER_PHRASES = [ [ "you", "know" ], [ "i", "mean" ], [ "sort", "of" ], [ "kind", "of" ] ];
    const norm = ( s ) => s.toLowerCase().replace( /[^a-z0-9']/g, "" );

    function findFillers() {
        const hits = new Set();
        const n = words.map( ( w ) => norm( w.text ) );
        for ( let i = 0; i < words.length; i++ ) {
            if ( FILLER.test( words[ i ].text ) ) hits.add( i );
            if ( /^like,$/i.test( words[ i ].text ) && i > 0 && !/[.?!]$/.test( words[ i - 1 ].text ) ) hits.add( i );
            for ( const ph of FILLER_PHRASES ) {
                if ( ph.every( ( p, k ) => n[ i + k ] === p ) && /,$/.test( words[ i + ph.length - 1 ].text ) ) {
                    for ( let k = 0; k < ph.length; k++ ) hits.add( i + k );
                }
            }
        }
        for ( let len = 3; len >= 1; len-- ) {
            for ( let i = 0; i + 2 * len <= words.length; i++ ) {
                let same = true;
                for ( let k = 0; k < len && same; k++ ) same = n[ i + k ] && n[ i + k ] === n[ i + len + k ] && !/[.?!]$/.test( words[ i + k ].text );
                if ( same && words[ i + len ].start - words[ i + len - 1 ].end < 0.8 ) {
                    for ( let k = 0; k < len; k++ ) hits.add( i + k );
                }
            }
        }
        return [ ...hits ].sort( ( a, b ) => a - b );
    }

    $( "btnFillers" ).onclick = () => {
        const hits = findFillers().filter( ( i ) => mark[ i ] === KEEP );
        if ( !hits.length ) { flashNote( "No fillers found" ); return; }
        pushUndo();
        for ( const i of hits ) mark[ i ] = CUT;
        rebuildAll();
        flashNote( `${ hits.length } filler word${ hits.length > 1 ? "s" : "" } struck · ⌘Z to undo` );
        spans[ hits[ 0 ] ]?.scrollIntoView( { block: "center", behavior: "smooth" } );
    };

    let noteTimer = 0;
    function flashNote( text ) {
        const el = $( "toolsNote" );
        const prev = el.textContent;
        el.textContent = text;
        clearTimeout( noteTimer );
        noteTimer = setTimeout( () => { if ( el.textContent === text ) el.textContent = prev; }, 3500 );
    }

    /* ---------- find ---------- */

    let matches = [];
    function openFind() {
        $( "find" ).hidden = false;
        $( "btnFind" ).setAttribute( "aria-pressed", "true" );
        $( "findInput" ).focus();
        $( "findInput" ).select();
    }

    function closeFind() {
        $( "find" ).hidden = true;
        $( "btnFind" ).setAttribute( "aria-pressed", "false" );
        for ( const i of matches.flat() ) spans[ i ]?.classList.remove( "is-match" );
        matches = [];
        $( "findCount" ).textContent = "";
        $( "findStrike" ).disabled = $( "findBleep" ).disabled = true;
    }

    function runFind() {
        for ( const i of matches.flat() ) spans[ i ]?.classList.remove( "is-match" );
        matches = [];
        const q = $( "findInput" ).value.trim().split( /\s+/ ).map( norm ).filter( Boolean );
        if ( q.length ) {
            const n = words.map( ( w ) => norm( w.text ) );
            for ( let i = 0; i + q.length <= words.length; i++ ) {
                if ( q.every( ( t, k ) => n[ i + k ] === t ) ) {
                    matches.push( Array.from( { length: q.length }, ( _, k ) => i + k ) );
                    i += q.length - 1;
                }
            }
        }
        for ( const i of matches.flat() ) spans[ i ]?.classList.add( "is-match" );
        $( "findCount" ).textContent = q.length ? `${ matches.length } match${ matches.length === 1 ? "" : "es" }` : "";
        $( "findStrike" ).disabled = $( "findBleep" ).disabled = !matches.length;
        if ( matches.length ) spans[ matches[ 0 ][ 0 ] ]?.scrollIntoView( { block: "center", behavior: "smooth" } );
    }

    function markMatches( kind ) {
        if ( !matches.length ) return;
        pushUndo();
        for ( const i of matches.flat() ) mark[ i ] = kind;
        rebuildAll();
        flashNote( `${ matches.length } match${ matches.length === 1 ? "" : "es" } ${ kind === CUT ? "struck" : "bleeped" } · ⌘Z to undo` );
    }

    $( "btnFind" ).onclick = () => $( "find" ).hidden ? openFind() : closeFind();
    $( "findClose" ).onclick = closeFind;
    $( "findInput" ).addEventListener( "input", runFind );
    $( "findInput" ).addEventListener( "keydown", ( e ) => {
        if ( e.key === "Escape" ) { e.preventDefault(); closeFind(); }
        if ( e.key === "Enter" ) { e.preventDefault(); if ( e.shiftKey ) markMatches( BLEEP ); else if ( e.metaKey || e.ctrlKey ) markMatches( CUT ); else cycleMatch(); }
    } );
    $( "findStrike" ).onclick = () => markMatches( CUT );
    $( "findBleep" ).onclick = () => markMatches( BLEEP );

    let matchCursor = -1;
    function cycleMatch() {
        if ( !matches.length ) return;
        matchCursor = ( matchCursor + 1 ) % matches.length;
        const m = matches[ matchCursor ];
        spans[ m[ 0 ] ]?.scrollIntoView( { block: "center", behavior: "smooth" } );
        seek( words[ m[ 0 ] ].start + 0.001 );
    }

    /* ---------- selection ---------- */

    function wordIndexOf( node ) {
        const el = node?.nodeType === 3 ? node.parentElement : node;
        const w = el?.closest?.( ".w" );
        return w ? +w.dataset.i : -1;
    }

    const posOf = ( i ) => seq.indexOf( i );

    function readSelection() {
        const s = window.getSelection();
        if ( !s || s.rangeCount === 0 || s.isCollapsed ) return null;
        const r = s.getRangeAt( 0 );
        if ( !transcript.contains( r.commonAncestorContainer ) ) return null;
        let a = wordIndexOf( r.startContainer ), b = wordIndexOf( r.endContainer );
        if ( a < 0 ) a = walkWord( r.startContainer, r.startOffset, 1 );
        if ( b < 0 ) b = walkWord( r.endContainer, r.endOffset, -1 );
        if ( a < 0 || b < 0 ) return null;
        let pa = posOf( a ), pb = posOf( b );
        if ( pa > pb ) [ pa, pb ] = [ pb, pa ];
        return { from: pa, to: pb };
    }

    function walkWord( node, offset, dir ) {
        const walker = document.createTreeWalker( transcript, NodeFilter.SHOW_ELEMENT );
        walker.currentNode = node.nodeType === 3 ? node : ( node.childNodes[ dir > 0 ? offset : offset - 1 ] || node );
        let n = walker.currentNode;
        while ( n ) {
            if ( n.classList?.contains( "w" ) ) return +n.dataset.i;
            n = dir > 0 ? walker.nextNode() : walker.previousNode();
        }
        return -1;
    }

    function selectWords( pa, pb ) {
        if ( pa > pb ) [ pa, pb ] = [ pb, pa ];
        const r = document.createRange();
        r.setStartBefore( spans[ seq[ pa ] ] );
        r.setEndAfter( spans[ seq[ pb ] ] );
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange( r );
    }

    function updateSelButtons() {
        let anyCut = false, anyKept = false, anyBleep = false, anyMoved = false;
        if ( sel ) for ( const i of selIndices( sel ) ) {
            if ( mark[ i ] === CUT ) anyCut = true; else if ( mark[ i ] === BLEEP ) anyBleep = true; else anyKept = true;
            if ( moved[ i ] ) anyMoved = true;
        }
        const restorable = anyCut || anyBleep || anyMoved;
        $( "btnRedline" ).disabled = $( "floatRedline" ).disabled = !sel || !( anyKept || anyBleep );
        $( "btnBleep" ).disabled = $( "floatBleep" ).disabled = !sel || !( anyKept || anyCut );
        $( "btnKeep" ).disabled = !sel;
        $( "btnRestore" ).disabled = $( "floatRestore" ).disabled = !sel || !restorable;
        $( "floatMove" ).disabled = !sel;
        $( "floatRedline" ).hidden = !( anyKept || anyBleep );
        $( "floatBleep" ).hidden = !( anyKept || anyCut );
        $( "floatRestore" ).hidden = !restorable;
    }

    function showFloat() {
        const s = window.getSelection();
        if ( !s || s.rangeCount === 0 ) return hideFloat();
        const rect = s.getRangeAt( 0 ).getBoundingClientRect();
        if ( !rect.width && !rect.height ) return hideFloat();
        float.hidden = false;
        const top = rect.top - 10;
        const toolsBottom = $( "tools" ).getBoundingClientRect().bottom;
        const flip = top - 44 < Math.max( 60, toolsBottom + 6 );
        float.style.left = Math.min( Math.max( rect.left + rect.width / 2, 130 ), innerWidth - 130 ) + "px";
        float.style.top = ( flip ? rect.bottom + 10 : top ) + "px";
        float.style.transform = flip ? "translate( -50%, 0 )" : "translate( -50%, -100% )";
    }

    function hideFloat() { float.hidden = true; }

    document.addEventListener( "selectionchange", () => {
        if ( moving ) return;
        const s = readSelection();
        sel = s;
        updateSelButtons();
        if ( s ) showFloat(); else hideFloat();
    } );

    for ( const b of float.querySelectorAll( "button" ) ) b.addEventListener( "pointerdown", ( e ) => e.preventDefault() );
    for ( const id of [ "btnRedline", "btnBleep", "btnKeep", "btnRestore", "btnUndo", "btnFillers" ] ) $( id ).addEventListener( "pointerdown", ( e ) => e.preventDefault() );
    $( "btnRedline" ).onclick = $( "floatRedline" ).onclick = () => setMark( sel, CUT );
    $( "btnBleep" ).onclick = $( "floatBleep" ).onclick = () => setMark( sel, BLEEP );
    $( "btnKeep" ).onclick = () => keepOnly( sel );
    $( "btnRestore" ).onclick = $( "floatRestore" ).onclick = () => restoreSel( sel );
    $( "btnUndo" ).onclick = doUndo;

    /* ---------- move ---------- */

    function startMove( ids ) {
        if ( !ids?.length ) return;
        moving = { ids, before: null };
        document.body.classList.add( "is-moving" );
        $( "moveHint" ).hidden = false;
        hideFloat();
    }

    function endMove() {
        moving = null;
        document.body.classList.remove( "is-moving" );
        $( "moveHint" ).hidden = true;
        insert.hidden = true;
    }

    function nearestWord( x, y ) {
        const el = document.elementFromPoint( x, y );
        const direct = el?.closest?.( ".w" );
        if ( direct ) return direct;
        const para = el?.closest?.( ".para" ) || ( transcript.contains( el ) ? transcript : null );
        if ( !para ) return null;
        let best = null, bestD = Infinity;
        for ( const w of para.querySelectorAll( ".w" ) ) {
            const r = w.getBoundingClientRect();
            if ( y < r.top - 4 || y > r.bottom + 4 ) continue;
            const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
            if ( d < bestD ) { bestD = d; best = w; }
        }
        return best;
    }

    function insertionAt( x, y ) {
        const w = nearestWord( x, y );
        if ( !w ) return null;
        const r = w.getBoundingClientRect();
        const i = +w.dataset.i;
        const after = x > r.left + r.width / 2;
        const pos = posOf( i );
        return { before: after ? ( seq[ pos + 1 ] ?? -1 ) : i, rect: r, side: after ? "right" : "left" };
    }

    function showInsert( ins ) {
        if ( !ins ) { insert.hidden = true; return; }
        insert.hidden = false;
        insert.style.left = ( ins.side === "right" ? ins.rect.right : ins.rect.left ) - 1 + "px";
        insert.style.top = ins.rect.top - 2 + "px";
        insert.style.height = ins.rect.height + 4 + "px";
    }

    $( "floatMove" ).onclick = () => { if ( sel ) startMove( selIndices( sel ) ); };

    transcript.addEventListener( "pointermove", ( e ) => { if ( moving ) showInsert( insertionAt( e.clientX, e.clientY ) ); } );
    transcript.addEventListener( "click", ( e ) => {
        if ( !moving ) return;
        e.preventDefault(); e.stopPropagation();
        const ins = insertionAt( e.clientX, e.clientY );
        const ids = moving.ids;
        endMove();
        if ( ins && !ids.includes( ins.before ) ) moveWords( ids, ins.before );
    }, true );

    transcript.addEventListener( "dragstart", ( e ) => {
        if ( !sel || MOBILE ) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData( "text/plain", selIndices( sel ).map( ( i ) => words[ i ].text ).join( " " ) );
        moving = { ids: selIndices( sel ), drag: true };
        document.body.classList.add( "is-moving" );
    } );
    transcript.addEventListener( "dragover", ( e ) => {
        if ( !moving?.drag ) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        showInsert( insertionAt( e.clientX, e.clientY ) );
    } );
    transcript.addEventListener( "drop", ( e ) => {
        if ( !moving?.drag ) return;
        e.preventDefault();
        const ins = insertionAt( e.clientX, e.clientY );
        const ids = moving.ids;
        endMove();
        if ( ins && !ids.includes( ins.before ) ) moveWords( ids, ins.before );
    } );
    transcript.addEventListener( "dragend", () => { if ( moving?.drag ) endMove(); } );

    /* ---------- keyboard editing ---------- */

    function setCaret( pos, extend ) {
        if ( !seq.length || pos < 0 ) return;
        pos = Math.max( 0, Math.min( seq.length - 1, pos ) );
        if ( caret >= 0 ) spans[ seq[ caret ] ]?.classList.remove( "is-caret" );
        caret = pos;
        if ( !extend || anchor < 0 ) anchor = pos;
        const sp = spans[ seq[ pos ] ];
        sp.classList.add( "is-caret" );
        if ( extend ) selectWords( anchor, caret );
        else { window.getSelection()?.removeAllRanges(); sel = null; updateSelButtons(); hideFloat(); }
        const r = sp.getBoundingClientRect();
        if ( r.top < 80 || r.bottom > innerHeight - 40 ) sp.scrollIntoView( { block: "center", behavior: "smooth" } );
    }

    function caretLine( dir ) {
        const base = spans[ seq[ caret ] ].getBoundingClientRect();
        const cx = base.left + base.width / 2;
        let p = caret, best = -1, bestDx = Infinity, lineTop = null;
        while ( ( p += dir ) >= 0 && p < seq.length ) {
            const r = spans[ seq[ p ] ].getBoundingClientRect();
            if ( Math.abs( r.top - base.top ) < base.height * 0.5 ) continue;
            if ( lineTop === null ) lineTop = r.top;
            if ( Math.abs( r.top - lineTop ) > base.height * 0.5 ) break;
            const dx = Math.abs( r.left + r.width / 2 - cx );
            if ( dx < bestDx ) { bestDx = dx; best = p; }
        }
        return best < 0 ? ( dir > 0 ? seq.length - 1 : 0 ) : best;
    }

    document.addEventListener( "keydown", ( e ) => {
        const tag = e.target.tagName;
        const mod = e.metaKey || e.ctrlKey;
        if ( mod && e.key.toLowerCase() === "f" && words.length ) { e.preventDefault(); openFind(); return; }
        if ( tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target.isContentEditable ) return;
        if ( mod && e.key.toLowerCase() === "z" ) { e.preventDefault(); doUndo(); return; }
        if ( !words.length ) return;
        if ( e.key === "Escape" ) {
            if ( moving ) { endMove(); return; }
            if ( !$( "find" ).hidden ) { closeFind(); return; }
            window.getSelection()?.removeAllRanges();
            if ( caret >= 0 ) spans[ seq[ caret ] ]?.classList.remove( "is-caret" );
            caret = anchor = -1; hideFloat();
            return;
        }
        if ( e.key === "Backspace" || e.key === "Delete" ) {
            e.preventDefault();
            if ( sel ) setMark( sel, CUT );
            else if ( caret >= 0 ) { const i = seq[ caret ]; setMark( { from: caret, to: caret }, mark[ i ] === CUT ? KEEP : CUT ); }
            return;
        }
        if ( e.key.toLowerCase() === "b" && !mod ) {
            if ( sel ) { e.preventDefault(); setMark( sel, BLEEP ); }
            else if ( caret >= 0 ) { e.preventDefault(); const i = seq[ caret ]; setMark( { from: caret, to: caret }, mark[ i ] === BLEEP ? KEEP : BLEEP ); }
            return;
        }
        if ( e.key.toLowerCase() === "m" && !mod && sel ) { e.preventDefault(); startMove( selIndices( sel ) ); return; }
        if ( e.key === "ArrowLeft" || e.key === "ArrowRight" ) {
            if ( tag === "VIDEO" || e.target === $( "strip" ) ) return;
            e.preventDefault();
            const dir = e.key === "ArrowLeft" ? -1 : 1;
            const from = caret >= 0 ? caret : ( nowIndex >= 0 ? posOf( nowIndex ) : 0 );
            let p = from + dir;
            if ( mod ) { while ( p > 0 && p < seq.length - 1 && !/[.?!]$/.test( words[ seq[ p + ( dir < 0 ? -1 : 0 ) ] ].text ) ) p += dir; }
            setCaret( caret < 0 ? from : p, e.shiftKey );
            return;
        }
        if ( e.key === "ArrowUp" || e.key === "ArrowDown" ) {
            if ( tag === "VIDEO" ) return;
            e.preventDefault();
            if ( caret < 0 ) { setCaret( nowIndex >= 0 ? posOf( nowIndex ) : 0, false ); return; }
            setCaret( caretLine( e.key === "ArrowUp" ? -1 : 1 ), e.shiftKey );
            return;
        }
        if ( e.key === "Enter" && caret >= 0 ) { e.preventDefault(); seek( words[ seq[ caret ] ].start + 0.001 ); return; }
        if ( e.key === " " && tag !== "BUTTON" && tag !== "VIDEO" ) {
            e.preventDefault();
            video.paused ? video.play() : video.pause();
        }
    } );

    /* ---------- word click / seek ---------- */

    let downAt = null;
    transcript.addEventListener( "pointerdown", ( e ) => { downAt = { x: e.clientX, y: e.clientY }; } );
    transcript.addEventListener( "click", ( e ) => {
        if ( moving ) return;
        const i = wordIndexOf( e.target );
        if ( i < 0 || !downAt ) return;
        const movedPtr = Math.hypot( e.clientX - downAt.x, e.clientY - downAt.y ) > 6;
        const s = window.getSelection();
        if ( movedPtr || ( s && !s.isCollapsed ) ) return;
        setCaret( posOf( i ), false );
        seek( words[ i ].start + 0.001 );
    } );

    function seek( t ) {
        video.currentTime = Math.min( Math.max( 0, t ), duration );
        paint( true );
    }

    /* ---------- playback loop ---------- */

    let curSeg = null;
    let actx = null, osc = null, oscGain = null, bleeping = false, bleepMuted = false;

    function tone( on ) {
        if ( on === bleeping ) return;
        bleeping = on;
        if ( on ) {
            try {
                actx ||= new ( window.AudioContext || window.webkitAudioContext )();
                if ( actx.state === "suspended" ) actx.resume();
                osc = actx.createOscillator(); oscGain = actx.createGain();
                osc.type = "sine"; osc.frequency.value = 1000;
                oscGain.gain.setValueAtTime( 0.0001, actx.currentTime );
                oscGain.gain.exponentialRampToValueAtTime( 0.18, actx.currentTime + 0.01 );
                osc.connect( oscGain ).connect( actx.destination ); osc.start();
            } catch {}
            bleepMuted = video.muted; video.muted = true;
        } else {
            if ( osc ) { const o = osc, g = oscGain; g.gain.exponentialRampToValueAtTime( 0.0001, actx.currentTime + 0.01 ); o.stop( actx.currentTime + 0.02 ); osc = null; }
            video.muted = bleepMuted;
        }
    }

    function nextSegment( t ) {
        if ( curSeg ) {
            const nx = segments.find( ( g ) => g.order === curSeg.order + 1 );
            if ( nx ) return nx;
            return null;
        }
        let best = null;
        for ( const g of segments ) if ( g.s > t && ( !best || g.s < best.s ) ) best = g;
        return best || segments[ 0 ] || null;
    }

    function paint( force ) {
        const t = video.currentTime;
        if ( !video.paused && !video.seeking && !skipping && segments.length ) {
            const g = segAt( t );
            if ( g ) {
                curSeg = g;
                if ( t >= g.e - 0.12 ) {
                    const nx = nextSegment( t );
                    if ( nx && nx.order === g.order + 1 && Math.abs( nx.s - g.e ) < 0.001 ) { /* contiguous */ }
                    else { skipTo( nx ); return; }
                }
            } else {
                const nx = nextSegment( t );
                skipTo( nx ); return;
            }
        } else if ( video.paused ) {
            curSeg = segAt( t );
        }
        if ( !video.paused ) {
            const inBleep = bleepRanges().some( ( [ a, b ] ) => t >= a && t < b );
            tone( inBleep );
        } else if ( bleeping ) tone( false );
        $( "tcNow" ).textContent = tc( shown( t ) );
        if ( duration ) $( "stripHead" ).style.left = ( t / duration * 100 ) + "%";
        const i = wordAt( t );
        if ( i !== nowIndex || force ) {
            spans[ nowIndex ]?.classList.remove( "is-now" );
            nowIndex = i;
            const span = spans[ i ];
            if ( span ) {
                span.classList.add( "is-now" );
                if ( !video.paused && Date.now() - userScrolledAt > 2500 ) keepVisible( span );
            }
        }
    }

    function skipTo( nx ) {
        skipping = true;
        if ( bleeping ) tone( false );
        const wasMuted = video.muted;
        video.muted = true;
        $( "skip" ).classList.add( "is-on" );
        const land = nx ? nx.s : duration;
        const done = () => {
            video.removeEventListener( "seeked", done );
            video.muted = wasMuted;
            skipping = false;
            curSeg = nx;
            $( "skip" ).classList.remove( "is-on" );
            if ( !nx ) video.pause();
            paint( true );
        };
        video.addEventListener( "seeked", done );
        video.currentTime = land;
    }

    function keepVisible( span ) {
        const r = span.getBoundingClientRect();
        const scroller = getComputedStyle( transcript ).overflowY === "auto" ? transcript.getBoundingClientRect() : { top: 0, bottom: innerHeight };
        const topGuard = MOBILE ? $( "stage" ).querySelector( ".player" ).getBoundingClientRect().bottom : scroller.top;
        if ( r.top < topGuard + 20 || r.bottom > scroller.bottom - 60 ) {
            span.scrollIntoView( { block: "center", behavior: "smooth" } );
        }
    }

    const onUserScroll = () => { userScrolledAt = Date.now(); };
    transcript.addEventListener( "wheel", onUserScroll, { passive: true } );
    transcript.addEventListener( "touchmove", onUserScroll, { passive: true } );
    window.addEventListener( "wheel", onUserScroll, { passive: true } );
    window.addEventListener( "touchmove", onUserScroll, { passive: true } );

    ( function loop() {
        if ( words.length && !video.paused ) paint( false );
        requestAnimationFrame( loop );
    } )();
    video.addEventListener( "seeked", () => { if ( !skipping ) { curSeg = null; paint( true ); } } );
    video.addEventListener( "pause", () => { tone( false ); paint( true ); } );
    video.addEventListener( "play", () => {
        if ( !segments.length ) return;
        const first = segments.find( ( g ) => g.order === 0 );
        const t = video.currentTime;
        const atStart = t < 0.05 || t >= duration - 0.05;
        if ( atStart && first && !( t >= first.s && t < first.e ) ) { curSeg = first; video.currentTime = first.s; }
    } );
    video.addEventListener( "timeupdate", () => { if ( video.paused ) paint( false ); } );

    $( "timeMode" ).onclick = () => {
        outputTime = !outputTime;
        $( "timeMode" ).setAttribute( "aria-pressed", String( outputTime ) );
        relabel();
        rebuildAll();
        paint( true );
    };

    /* ---------- strip scrubbing ---------- */

    const strip = $( "strip" );
    let scrubbing = false, wasPlaying = false;
    const stripTime = ( e ) => {
        const r = strip.getBoundingClientRect();
        return Math.min( 1, Math.max( 0, ( e.clientX - r.left ) / r.width ) ) * duration;
    };
    strip.addEventListener( "pointerdown", ( e ) => {
        scrubbing = true; wasPlaying = !video.paused; video.pause();
        strip.setPointerCapture( e.pointerId );
        seek( stripTime( e ) );
    } );
    strip.addEventListener( "pointermove", ( e ) => { if ( scrubbing ) seek( stripTime( e ) ); } );
    strip.addEventListener( "pointerup", () => { scrubbing = false; if ( wasPlaying ) video.play(); } );
    strip.addEventListener( "keydown", ( e ) => {
        if ( e.key === "ArrowLeft" ) seek( video.currentTime - 2 );
        if ( e.key === "ArrowRight" ) seek( video.currentTime + 2 );
    } );

    /* ---------- loading a file ---------- */

    function openFile( f ) {
        if ( !f ) return;
        if ( !/^video\//.test( f.type ) && !/\.(mp4|mov|m4v|webm)$/i.test( f.name ) ) {
            setStatus( `"${ f.name }" isn't a video file` );
            return;
        }
        worker?.postMessage( { type: "cancel" } );
        if ( url ) URL.revokeObjectURL( url );
        file = f; url = URL.createObjectURL( f );
        docKey = [ f.name, f.size, f.lastModified ].join( "|" );
        words = []; mark = []; seq = []; moved = []; undo = []; segments = []; pauses = []; sel = null; env = null; curSeg = null;
        resetDoc();
        closeFind();
        setStatus( "" );
        tabBusy( "" );
        main.classList.remove( "is-empty" );
        $( "stage" ).hidden = false;
        $( "fileName" ).textContent = f.name;
        $( "fileMeta" ).textContent = fmtBytes( f.size );
        video.src = url;
        video.addEventListener( "loadedmetadata", async () => {
            duration = video.duration;
            $( "fileMeta" ).textContent = `${ fmtBytes( f.size ) } · ${ video.videoWidth }×${ video.videoHeight } · ${ tc( duration, false ) }`;
            if ( await restore() ) {
                renderAll();
                rebuildAll();
                setStatus( "Transcript restored from this device" );
                $( "progress" ).hidden = true;
            } else {
                transcribe();
            }
        }, { once: true } );
        video.addEventListener( "error", () => {
            setStatus( "This browser can't play that file" );
            transcript.innerHTML = `<p class="transcript-empty">The browser couldn't decode this video for playback. Try an MP4 (H.264) or, for HEVC .mov files, Safari or recent Chrome.</p>`;
        }, { once: true } );
    }

    $( "file" ).addEventListener( "change", ( e ) => openFile( e.target.files[ 0 ] ) );
    for ( const ev of [ "dragenter", "dragover" ] ) main.addEventListener( ev, ( e ) => { if ( moving ) return; e.preventDefault(); main.classList.add( "is-drag" ); } );
    for ( const ev of [ "dragleave", "drop" ] ) main.addEventListener( ev, ( e ) => { if ( moving ) return; e.preventDefault(); main.classList.remove( "is-drag" ); } );
    main.addEventListener( "drop", ( e ) => { if ( !moving ) openFile( e.dataTransfer.files[ 0 ] ); } );

    /* ---------- tab title + typing favicon ---------- */

    const iconLink = document.querySelector( "link[rel~='icon']" );
    const iconHome = iconLink?.href;
    const baseTitle = document.title;
    let iconTimer = 0, iconFrame = 0;
    const iconCanvas = document.createElement( "canvas" );
    iconCanvas.width = iconCanvas.height = 32;

    function drawIcon( frame ) {
        const ctx = iconCanvas.getContext( "2d" );
        ctx.clearRect( 0, 0, 32, 32 );
        ctx.lineCap = "round";
        ctx.lineWidth = 3;
        const dark = matchMedia( "(prefers-color-scheme: dark)" ).matches;
        const lens = [ 24, 18, 22, 14 ];
        const total = lens.reduce( ( a, b ) => a + b, 0 );
        let budget = ( frame % 40 ) / 32 * total;
        ctx.strokeStyle = dark ? "#ebe3d6" : "#1f1a16";
        lens.forEach( ( len, k ) => {
            const w = Math.max( 0, Math.min( len, budget ) );
            budget -= len;
            if ( w <= 0 ) return;
            const y = 6 + k * 7;
            ctx.beginPath(); ctx.moveTo( 4, y ); ctx.lineTo( 4 + w, y ); ctx.stroke();
            if ( w < len && Math.floor( frame / 2 ) % 2 === 0 ) {
                ctx.fillStyle = ctx.strokeStyle;
                ctx.fillRect( 4 + w + 2, y - 4, 2, 8 );
            }
        } );
        if ( frame % 40 >= 34 ) {
            ctx.strokeStyle = dark ? "#ff6b55" : "#c7301c";
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo( 3, 20 ); ctx.quadraticCurveTo( 16, 15, 29, 19 ); ctx.stroke();
        }
        return iconCanvas.toDataURL( "image/png" );
    }

    function tabBusy( text ) {
        document.title = text ? `${ text } · ${ baseTitle }` : baseTitle;
        if ( text && !iconTimer && iconLink ) {
            iconTimer = setInterval( () => { iconLink.href = drawIcon( iconFrame++ ); }, 160 );
        }
        if ( !text && iconTimer ) {
            clearInterval( iconTimer ); iconTimer = 0; iconFrame = 0;
            if ( iconLink && iconHome ) iconLink.href = iconHome;
        }
    }

    document.addEventListener( "visibilitychange", () => { if ( !document.hidden && transcribing && iconTimer ) iconLink.href = drawIcon( iconFrame ); } );

    /* ---------- transcription ---------- */

    function chosenModel() {
        const v = $( "model" ).value;
        if ( v !== "auto" ) return v;
        return ( navigator.gpu && !MOBILE ) ? MODELS.small : MODELS.base;
    }

    function transcribe() {
        transcribing = true;
        skippedSec = 0;
        const startedAt = performance.now();
        let etaFrom = 0, etaSmooth = 0;
        const fmtEta = ( r, rough ) => {
            r = Math.max( 1, r );
            if ( r < 60 ) return `${ rough ? "~" : "" }${ Math.ceil( r / 5 ) * 5 }s`;
            if ( r < 3600 ) return `~${ Math.ceil( r / 60 ) }m`;
            return `~${ Math.floor( r / 3600 ) }h ${ Math.ceil( ( r % 3600 ) / 60 ) }m`;
        };
        const estimate = ( f, rough = false ) => {
            if ( !etaFrom ) { etaFrom = performance.now(); return ""; }
            const elapsed = ( performance.now() - etaFrom ) / 1000;
            if ( f >= 0.99 ) return "finishing";
            if ( elapsed < 8 || f < 0.05 ) {
                return rough && f > 0 && elapsed > 1.5 ? fmtEta( elapsed * ( 1 - f ) / f, true ) : "";
            }
            const raw = elapsed * ( 1 - f ) / f;
            etaSmooth = etaSmooth ? etaSmooth * 0.7 + raw * 0.3 : raw;
            return fmtEta( etaSmooth );
        };
        env = new Uint8Array( Math.ceil( duration * 100 ) + 100 ).fill( 255 );
        $( "progress" ).hidden = false;
        $( "progressFill" ).style.width = "0%";
        $( "progressText" ).textContent = "Starting…";
        $( "btnExport" ).disabled = true;
        transcript.innerHTML = `<p class="transcript-empty">Words will appear here as they're recognized. You can play the video meanwhile.</p>`;
        worker ||= new Worker( "transcribe-worker.js", { type: "module" } );
        const model = chosenModel();
        const run = ++runCounter;
        worker.postMessage( { type: "run", run, file, model, device: "auto", duration } );
        worker.onmessage = async ( ev ) => {
            const m = ev.data;
            if ( m.run !== run ) return;
            if ( m.type === "status" ) { setStatus( m.text ); $( "progressText" ).textContent = m.text; tabBusy( /Loading/.test( m.text ) ? "Loading model" : "Reading audio" ); }
            if ( m.type === "model" ) {
                if ( m.phase === "download" && m.total ) {
                    $( "progressFill" ).style.width = ( m.loaded / m.total * 100 ).toFixed( 1 ) + "%";
                    $( "progressText" ).textContent = `Fetching model · ${ fmtBytes( m.loaded ) } of ${ fmtBytes( m.total ) } (cached after the first time)`;
                }
                if ( m.phase === "ready" ) { $( "progressFill" ).style.width = "0%"; }
            }
            if ( m.type === "progress" ) {
                $( "progressFill" ).style.width = ( m.fraction * 100 ).toFixed( 1 ) + "%";
                const eta = estimate( m.fraction );
                const rough = eta || estimate( m.fraction, true );
                tabBusy( rough === "finishing" ? "Finishing" : rough ? `${ rough } left` : "Starting" );
                setStatus( `Transcribing · ${ Math.round( m.fraction * 100 ) }%${ eta === "finishing" ? " · finishing" : eta ? ` · ${ eta } remaining` : "" } · ${ m.model.split( "/" ).pop().replace( "_timestamped", "" ) } on ${ m.device }` );
            }
            if ( m.type === "live" ) $( "progressText" ).textContent = "… " + m.text.trim();
            if ( m.type === "envelope" ) {
                const at = Math.round( m.offset * 100 );
                if ( at + m.env.length > env.length ) {
                    const grown = new Uint8Array( at + m.env.length + 100 ).fill( 255 );
                    grown.set( env ); env = grown;
                }
                env.set( m.env, at );
            }
            if ( m.type === "words" && m.words.length ) {
                const start = words.length;
                words.push( ...m.words );
                appendStreaming( m.words, start );
                rebuildAll();
            }
            if ( m.type === "needAudio" ) {
                if ( duration > FALLBACK_MAX_SEC ) {
                    fail( `This browser can't decode the audio track directly, and the fallback decoder needs the whole file in memory, which is too much for a ${ tc( duration, false ) } video. Re-encode to MP4 with AAC audio or use Chrome.` );
                    return;
                }
                try {
                    $( "progressText" ).textContent = "Decoding audio with Web Audio…";
                    const audio = await decodeWholeFile( file );
                    worker.postMessage( { type: "run", run, audio, model, device: "auto", duration }, [ audio.buffer ] );
                } catch ( e ) { fail( "Couldn't read this file's audio: " + e.message ); }
            }
            if ( m.type === "stats" ) skippedSec = m.skipped || 0;
            if ( m.type === "done" ) {
                transcribing = false;
                tabBusy( "" );
                $( "progress" ).hidden = true;
                const secs = ( ( performance.now() - startedAt ) / 1000 ).toFixed( 0 );
                const skip = skippedSec > 1 ? ` · ${ tc( skippedSec, false ) } of silence skipped` : "";
                setStatus( `${ words.length } words in ${ secs }s · ${ m.model.split( "/" ).pop().replace( "_timestamped", "" ) } on ${ m.device }${ skip } · nothing left your device` );
                if ( !words.length ) transcript.innerHTML = `<p class="transcript-empty">No speech was recognized in this video.</p>`;
                rebuildAll();
            }
            if ( m.type === "error" ) fail( m.message );
        };
        worker.onerror = ( e ) => fail( e.message || "Worker failed to start" );
    }

    function fail( msg ) {
        transcribing = false;
        tabBusy( "" );
        $( "progress" ).hidden = true;
        setStatus( "Transcription failed" );
        transcript.innerHTML = `<p class="transcript-empty">${ msg.replace( /</g, "&lt;" ) }</p>`;
        console.error( msg );
    }

    async function decodeWholeFile( f ) {
        let buf = await f.arrayBuffer();
        const ctx = new OfflineAudioContext( 1, 1, 16000 );
        const ab = await ctx.decodeAudioData( buf );
        buf = null;
        const out = new Float32Array( ab.length );
        for ( let c = 0; c < ab.numberOfChannels; c++ ) {
            const d = ab.getChannelData( c );
            for ( let i = 0; i < d.length; i++ ) out[ i ] += d[ i ] / ab.numberOfChannels;
        }
        return out;
    }

    /* ---------- menus ---------- */

    function menu( btnId, popId ) {
        const btn = $( btnId ), pop = $( popId );
        btn.onclick = () => { const open = pop.hidden; closeMenus(); pop.hidden = !open; btn.setAttribute( "aria-expanded", String( open ) ); };
    }
    function closeMenus() {
        for ( const [ b, p ] of [ [ "btnTranscript", "tmenuPop" ], [ "btnExport", "xmenuPop" ] ] ) { $( p ).hidden = true; $( b ).setAttribute( "aria-expanded", "false" ); }
    }
    menu( "btnTranscript", "tmenuPop" );
    menu( "btnExport", "xmenuPop" );
    document.addEventListener( "pointerdown", ( e ) => { if ( !e.target.closest( ".menu" ) ) closeMenus(); } );

    /* ---------- transcript export ---------- */

    for ( const b of $( "tmenuPop" ).querySelectorAll( "button" ) ) {
        b.onclick = () => {
            const fmt = b.dataset.fmt;
            const keepCut = $( "tmenuKeep" ).checked;
            const text = fmt === "txt" ? plainText( keepCut ) : captions( fmt, keepCut );
            download( new Blob( [ text ], { type: fmt === "vtt" ? "text/vtt" : "text/plain" } ), `${ file.name.replace( /\.[^.]+$/, "" ) }${ keepCut ? "" : " (redlined)" }.${ fmt }` );
            closeMenus();
        };
    }

    function exportWords( keepCut ) {
        const order = keepCut ? words.map( ( _, i ) => i ) : seq;
        const out = [];
        for ( const i of order ) {
            if ( !keepCut && mark[ i ] === CUT ) continue;
            const w = words[ i ];
            out.push( {
                text: mark[ i ] === BLEEP && !keepCut ? "[bleep]" : w.text,
                start: keepCut ? w.start : outTime( w.start ),
                end: keepCut ? w.end : outTime( Math.min( w.end, segAt( w.start )?.e ?? w.end ) ),
                i
            } );
        }
        return out;
    }

    function plainText( keepCut ) {
        const ws = exportWords( keepCut );
        let out = "", para = [];
        let lastEnd = -Infinity;
        const flush = () => { if ( para.length ) out += para.join( " " ) + "\n\n"; para = []; };
        for ( const w of ws ) {
            const gap = w.start - lastEnd;
            const prev = para[ para.length - 1 ];
            if ( para.length && ( gap > 1.1 || gap < -0.01 || ( prev && /[.?!]["')\]]?$/.test( prev ) && gap > 0.45 ) ) ) flush();
            para.push( w.text );
            lastEnd = w.end;
        }
        flush();
        return out.trim() + "\n";
    }

    function buildCues( ws, maxChars = 84, maxSec = 6 ) {
        const cues = [];
        let cue = null;
        for ( const w of ws ) {
            const text = cue ? cue.text + " " + w.text : w.text;
            const tooLong = text.length > maxChars || ( cue && w.end - cue.start > maxSec );
            const bigGap = cue && ( w.start - cue.end > 0.7 || w.start < cue.end - 0.01 );
            const afterSentence = cue && /[.?!]["')\]]?$/.test( cue.last ) && text.length > maxChars / 2;
            if ( !cue || tooLong || bigGap || afterSentence ) {
                if ( cue ) cues.push( cue );
                cue = { start: w.start, end: w.end, text: w.text, last: w.text, words: [ w ] };
            } else {
                cue.text = text; cue.end = w.end; cue.last = w.text; cue.words.push( w );
            }
        }
        if ( cue ) cues.push( cue );
        for ( let k = 0; k < cues.length; k++ ) {
            const limit = k + 1 < cues.length ? cues[ k + 1 ].start - 0.05 : Infinity;
            cues[ k ].end = Math.min( Math.max( cues[ k ].end, cues[ k ].start + 0.8 ), Math.max( limit, cues[ k ].end ) );
        }
        return cues;
    }

    function wrapCue( t, width = 42 ) {
        if ( t.length <= width ) return t;
        const mid = t.lastIndexOf( " ", Math.ceil( t.length / 2 ) + 8 );
        return mid > 0 ? t.slice( 0, mid ) + "\n" + t.slice( mid + 1 ) : t;
    }

    function wrapWords( ws, width ) {
        const items = ws.map( ( w ) => ( { text: w.text, start: w.start, end: w.end } ) );
        const total = items.reduce( ( n, w ) => n + w.text.length + 1, -1 );
        if ( total <= width ) return [ items ];
        let best = 1, bestDiff = Infinity, run = 0;
        for ( let k = 0; k < items.length - 1; k++ ) {
            run += items[ k ].text.length + 1;
            const diff = Math.abs( run - total / 2 );
            if ( diff < bestDiff ) { bestDiff = diff; best = k + 1; }
        }
        return [ items.slice( 0, best ), items.slice( best ) ];
    }

    function captions( fmt, keepCut ) {
        const cues = buildCues( exportWords( keepCut ) );
        const stamp = ( t ) => {
            const h = Math.floor( t / 3600 ), m = Math.floor( t / 60 ) % 60, s = Math.floor( t % 60 ), ms = Math.round( ( t % 1 ) * 1000 );
            return `${ pad( h ) }:${ pad( m ) }:${ pad( s ) }${ fmt === "vtt" ? "." : "," }${ pad( ms, 3 ) }`;
        };
        let out = fmt === "vtt" ? "WEBVTT\n\n" : "";
        cues.forEach( ( c, k ) => {
            out += ( fmt === "srt" ? `${ k + 1 }\n` : "" ) + `${ stamp( c.start ) } --> ${ stamp( c.end ) }\n${ wrapCue( c.text ) }\n\n`;
        } );
        return out;
    }

    function download( blob, name ) {
        const a = document.createElement( "a" );
        a.href = URL.createObjectURL( blob );
        a.download = name;
        a.click();
        setTimeout( () => URL.revokeObjectURL( a.href ), 2000 );
    }

    /* ---------- settings ---------- */

    $( "btnSettings" ).onclick = () => $( "settings" ).showModal();
    $( "settingsDone" ).onclick = () => $( "settings" ).close();
    $( "settings" ).addEventListener( "close", readSettings );
    for ( const el of $( "settings" ).querySelectorAll( "input, select" ) ) el.addEventListener( "change", readSettings );
    loadSettings();

    /* ---------- video / audio export ---------- */

    const sheet = $( "exportSheet" );

    function showExportError( title, msg ) {
        $( "exportTitle" ).textContent = title;
        $( "exportSub" ).textContent = "";
        $( "exportFill" ).style.width = "0%";
        $( "exportText" ).textContent = msg;
        $( "exportCancel" ).hidden = true;
        $( "exportDownload" ).hidden = true;
        $( "exportDone" ).hidden = false;
        if ( !sheet.open ) sheet.showModal();
    }

    for ( const b of $( "xmenuPop" ).querySelectorAll( "button" ) ) b.onclick = () => { closeMenus(); runExport( b.dataset.kind ); };

    async function runExport( kind ) {
        const segs = segments.slice().sort( ( a, b ) => a.order - b.order ).map( ( g ) => ( { s: g.s, e: g.e, moved: g.moved } ) );
        if ( !segs.length ) return;
        video.pause();
        const audioOnly = kind === "audio";
        const ext = audioOnly ? "m4a" : "mp4";
        const base = file.name.replace( /\.[^.]+$/, "" );
        const kept = outLength();
        let handle = null;
        if ( window.showSaveFilePicker ) {
            try {
                handle = await showSaveFilePicker( {
                    suggestedName: `${ base } (redlined).${ ext }`,
                    types: [ audioOnly ? { description: "M4A audio", accept: { "audio/mp4": [ ".m4a" ] } } : { description: "MP4 video", accept: { "video/mp4": [ ".mp4" ] } } ]
                } );
            } catch ( e ) { if ( e.name === "AbortError" ) return; }
        }
        if ( !handle && !audioOnly ) {
            const estimate = file.size * ( kept / duration ) * 1.3;
            if ( estimate > MEM_EXPORT_MAX ) {
                showExportError( "Too large to export here", `This browser has to build the whole ${ fmtBytes( estimate ) } file in memory before saving it${ IOS ? ", and iOS will kill the page first" : "" }. Export on desktop Chrome or Edge, which stream straight to disk, or redline more of the video.` );
                return;
            }
        }
        const cues = settings.captions && !audioOnly ? buildCues( exportWords( false ), 64, 5 ).map( ( c ) => ( { start: c.start, end: c.end, lines: wrapWords( c.words, 32 ) } ) ) : null;
        $( "exportTitle" ).textContent = audioOnly ? "Exporting audio" : "Exporting";
        $( "exportSub" ).textContent = `${ segs.length } segment${ segs.length > 1 ? "s" : "" } · ${ tc( kept, false ) } kept of ${ tc( duration, false ) }`;
        $( "exportFill" ).style.width = "0%";
        $( "exportText" ).textContent = "Opening file…";
        $( "exportCancel" ).hidden = false;
        $( "exportDownload" ).hidden = true;
        $( "exportDone" ).hidden = true;
        sheet.showModal();

        exporter = new Worker( "export-worker.js", { type: "module" } );
        exporter.postMessage( {
            type: "run", file, handle, audioOnly,
            segments: segs.map( ( g ) => [ g.s, g.e ] ),
            bleeps: bleepRanges(),
            captions: cues,
            capSize: settings.capSize,
            punch: settings.punch && !audioOnly ? settings.punchPct / 100 : 0
        } );
        exporter.onmessage = ( ev ) => {
            const m = ev.data;
            if ( m.type === "info" ) {
                const a = m.audio === "encode" ? `audio ${ m.audioCodec }, 8 ms fades${ m.bleeps ? `, ${ m.bleeps } bleep${ m.bleeps > 1 ? "s" : "" }` : "" }` : m.audio === "copy" ? `${ m.audioCodec } copied` : "no audio";
                $( "exportText" ).textContent = audioOnly ? a : `${ m.width }×${ m.height } · ${ m.codec } @ ${ ( m.bitrate / 1e6 ).toFixed( 1 ) } Mb/s${ m.composite ? " · canvas" : "" } · ${ a }`;
            }
            if ( m.type === "progress" ) $( "exportFill" ).style.width = ( m.fraction * 100 ).toFixed( 1 ) + "%";
            if ( m.type === "done" ) {
                $( "exportFill" ).style.width = "100%";
                $( "exportTitle" ).textContent = "Exported";
                $( "exportCancel" ).hidden = true;
                if ( m.buffer ) {
                    const blob = new Blob( [ m.buffer ], { type: audioOnly ? "audio/mp4" : "video/mp4" } );
                    const dl = $( "exportDownload" );
                    if ( dl.href ) URL.revokeObjectURL( dl.href );
                    dl.href = URL.createObjectURL( blob );
                    dl.download = `${ base } (redlined).${ ext }`;
                    dl.hidden = false;
                    $( "exportText" ).textContent = fmtBytes( blob.size ) + " ready";
                } else {
                    $( "exportText" ).textContent = "Saved to disk";
                    $( "exportDone" ).hidden = false;
                }
                exporter.terminate(); exporter = null;
            }
            if ( m.type === "error" ) {
                showExportError( "Export failed", m.message );
                exporter.terminate(); exporter = null;
            }
            if ( m.type === "cancelled" ) { sheet.close(); exporter.terminate(); exporter = null; }
        };
        exporter.onerror = ( e ) => showExportError( "Export failed", e.message || "Worker error" );
    }

    $( "exportCancel" ).onclick = () => { exporter?.postMessage( { type: "cancel" } ); $( "exportText" ).textContent = "Cancelling…"; };
    $( "exportDone" ).onclick = () => sheet.close();
    $( "exportDownload" ).onclick = () => setTimeout( () => sheet.close(), 300 );
    sheet.addEventListener( "cancel", ( e ) => { if ( exporter ) e.preventDefault(); } );

    /* ---------- capabilities ---------- */

    ( function caps() {
        const bits = [];
        bits.push( navigator.gpu ? "webgpu" : "wasm" );
        bits.push( "VideoEncoder" in window ? "webcodecs" : "no webcodecs export" );
        if ( MOBILE ) bits.push( "mobile" );
        $( "caps" ).textContent = bits.join( " · " );
        try {
            const saved = localStorage.getItem( "redline.model" );
            if ( saved ) $( "model" ).value = saved;
        } catch {}
        $( "model" ).onchange = () => { try { localStorage.setItem( "redline.model", $( "model" ).value ); } catch {} };
    } )();

    window.__redline = {
        load( demoWords, demoMark, dur, demoSeq, demoMoved ) {
            worker?.terminate(); worker = null;
            duration = dur; words = demoWords; transcribing = false; env = null;
            mark = demoMark.map( ( c ) => c === true ? CUT : +c || KEEP );
            seq = demoSeq || words.map( ( _, i ) => i );
            moved = demoMoved || words.map( () => false );
            main.classList.remove( "is-empty" ); $( "stage" ).hidden = false; $( "progress" ).hidden = true;
            renderAll(); rebuildAll();
        },
        paint: ( t ) => { spans[ nowIndex ]?.classList.remove( "is-now" ); nowIndex = wordAt( t ); spans[ nowIndex ]?.classList.add( "is-now" ); $( "tcNow" ).textContent = tc( t ); $( "stripHead" ).style.left = ( t / duration * 100 ) + "%"; },
        state: () => ( { words, mark, seq, moved, segments, pauses, env } ),
        move: moveWords, setMark, sel: () => sel
    };
} )();
