( function() {
    "use strict";

    const $ = ( id ) => document.getElementById( id );
    const main = $( "main" ), video = $( "video" ), transcript = $( "transcript" );
    const float = $( "float" );
    const MOBILE = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test( navigator.userAgent );
    const IOS = /iPhone|iPad|iPod/.test( navigator.userAgent ) || ( navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 );
    const MODELS = {
        small: "onnx-community/whisper-small.en_timestamped",
        base: "onnx-community/whisper-base.en_timestamped"
    };
    const SNAP = 0.35;
    const PAD = 0.04;
    const FALLBACK_MAX_SEC = 2 * 3600;
    const MEM_EXPORT_MAX = 1.5e9;

    /* ---------- state ---------- */

    let file = null, url = null, duration = 0, docKey = null;
    let words = [];
    let cut = [];
    let undo = [];
    let ranges = [];
    let spans = [];
    let sel = null;
    let caret = -1, anchor = -1;
    let nowIndex = -1;
    let lastPara = null, lastWord = null, paraStart = 0;
    let worker = null, exporter = null;
    let userScrolledAt = 0;
    let transcribing = false;
    let env = null;
    let outputTime = false;
    let skipping = false;

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
        if ( best >= 0 && t > words[ best ].end + 0.35 ) return -1;
        return best;
    }

    function outTime( t ) {
        let removed = 0;
        for ( const r of ranges ) {
            if ( r.start >= t ) break;
            removed += Math.min( r.end, t ) - r.start;
        }
        return t - removed;
    }

    const shown = ( t ) => outputTime ? outTime( t ) : t;

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
            tx.objectStore( "docs" ).put( { words, cut: cut.map( Number ).join( "" ), env, done: !transcribing, at: Date.now() }, docKey );
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
        cut = [ ...d.cut ].map( ( c ) => c === "1" );
        env = d.env || null;
        return true;
    }

    /* ---------- transcript rendering ---------- */

    function resetDoc() {
        transcript.innerHTML = "";
        spans = []; lastPara = null; lastWord = null; paraStart = 0; nowIndex = -1; caret = -1; anchor = -1;
    }

    function appendWords( list, startIndex ) {
        const frag = document.createDocumentFragment();
        let para = lastPara;
        list.forEach( ( w, k ) => {
            const i = startIndex + k;
            const gap = lastWord ? w.start - lastWord.end : 0;
            const sentenceEnd = lastWord && /[.?!]["')\]]?$/.test( lastWord.text );
            const breakPara = !para || gap > 1.1 || ( sentenceEnd && gap > 0.45 ) || ( sentenceEnd && w.start - paraStart > 40 );
            if ( breakPara ) {
                para = document.createElement( "p" );
                para.className = "para";
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
            span.className = "w" + ( cut[ i ] ? " is-cut" : "" );
            span.dataset.i = i;
            span.textContent = w.text;
            para.appendChild( span );
            spans[ i ] = span;
            lastWord = w;
        } );
        lastPara = para;
        if ( frag.childNodes.length ) transcript.appendChild( frag );
    }

    function renderAll() {
        resetDoc();
        appendWords( words, 0 );
        refreshCuts();
    }

    function relabel() {
        for ( const l of transcript.querySelectorAll( ".para-tc" ) ) l.textContent = tc( shown( +l.dataset.t ), false );
    }

    /* ---------- silence snapping ---------- */

    function energyAt( t ) {
        if ( !env ) return 255;
        const i = Math.floor( t * 100 );
        return i < 0 || i >= env.length ? 255 : env[ i ];
    }

    function snapEdge( t, dir, limit ) {
        if ( !env ) return t;
        const n = Math.round( SNAP * 100 );
        let best = t, bestE = energyAt( t );
        const floor = Math.min( ...Array.from( { length: n }, ( _, k ) => energyAt( t + dir * k / 100 ) ) );
        for ( let k = 1; k <= n; k++ ) {
            const x = t + dir * k / 100;
            if ( dir < 0 ? x < limit : x > limit ) break;
            const e = energyAt( x );
            if ( e <= floor + 6 ) { best = x; bestE = e; break; }
            if ( e < bestE ) { best = x; bestE = e; }
        }
        return best;
    }

    /* ---------- cuts ---------- */

    function refreshCuts() {
        ranges = [];
        let a = -1;
        for ( let i = 0; i <= words.length; i++ ) {
            const on = i < words.length && cut[ i ];
            if ( on && a < 0 ) a = i;
            if ( !on && a >= 0 ) {
                const prevEnd = a > 0 ? words[ a - 1 ].end : 0;
                const nextStart = i < words.length ? words[ i ].start : duration;
                let start = snapEdge( words[ a ].start - PAD, -1, prevEnd );
                let end = snapEdge( words[ i - 1 ].end + PAD, 1, nextStart );
                start = Math.max( 0, Math.min( start, words[ a ].start ) );
                end = Math.min( duration || Infinity, Math.max( end, words[ i - 1 ].end ) );
                ranges.push( { from: a, to: i - 1, start, end } );
                a = -1;
            }
        }
        for ( let i = 1; i < ranges.length; i++ ) {
            if ( ranges[ i ].start < ranges[ i - 1 ].end ) ranges[ i ].start = ranges[ i - 1 ].end;
        }
        for ( let i = 0; i < spans.length; i++ ) spans[ i ]?.classList.toggle( "is-cut", !!cut[ i ] );
        const cutSec = ranges.reduce( ( s, r ) => s + ( r.end - r.start ), 0 );
        $( "stripCuts" ).innerHTML = ranges.map( ( r ) =>
            `<div class="strip-cut" style="left:${ ( r.start / duration * 100 ).toFixed( 3 ) }%;width:${ Math.max( 0.15, ( r.end - r.start ) / duration * 100 ).toFixed( 3 ) }%"></div>` ).join( "" );
        $( "tcLen" ).textContent = tc( outputTime ? duration - cutSec : duration, false );
        $( "tcCut" ).textContent = cutSec ? ( outputTime ? `(−${ tc( cutSec, false ) })` : `−${ tc( cutSec, false ) } → ${ tc( duration - cutSec, false ) }` ) : "";
        $( "toolsNote" ).textContent = ranges.length ? `${ ranges.length } cut${ ranges.length > 1 ? "s" : "" } · ${ cutSec.toFixed( 1 ) }s removed` : "";
        $( "btnUndo" ).disabled = !undo.length;
        $( "btnExport" ).disabled = transcribing || !words.length || !ranges.length;
        $( "btnFillers" ).disabled = transcribing || !words.length;
        $( "btnTranscript" ).disabled = transcribing || !words.length;
        if ( outputTime ) relabel();
        updateSelButtons();
        save();
    }

    function pushUndo() {
        undo.push( cut.slice() );
        if ( undo.length > 100 ) undo.shift();
    }

    function applyCut( from, to, on ) {
        pushUndo();
        for ( let i = from; i <= to; i++ ) cut[ i ] = on;
        refreshCuts();
        window.getSelection()?.removeAllRanges();
        sel = null;
        hideFloat();
        setCaret( on ? to : from, false );
    }

    function doUndo() {
        if ( !undo.length ) return;
        cut = undo.pop();
        refreshCuts();
    }

    function keepSegments() {
        const segs = [];
        let t = 0;
        for ( const r of ranges ) {
            if ( r.start > t + 0.02 ) segs.push( [ t, r.start ] );
            t = Math.max( t, r.end );
        }
        if ( duration > t + 0.02 ) segs.push( [ t, duration ] );
        return segs;
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
        const hits = findFillers().filter( ( i ) => !cut[ i ] );
        if ( !hits.length ) { flashNote( "No fillers found" ); return; }
        pushUndo();
        for ( const i of hits ) { cut[ i ] = true; spans[ i ]?.classList.add( "is-filler" ); }
        refreshCuts();
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

    /* ---------- selection ---------- */

    function wordIndexOf( node ) {
        const el = node?.nodeType === 3 ? node.parentElement : node;
        const w = el?.closest?.( ".w" );
        return w ? +w.dataset.i : -1;
    }

    function readSelection() {
        const s = window.getSelection();
        if ( !s || s.rangeCount === 0 || s.isCollapsed ) return null;
        const r = s.getRangeAt( 0 );
        if ( !transcript.contains( r.commonAncestorContainer ) ) return null;
        let a = wordIndexOf( r.startContainer ), b = wordIndexOf( r.endContainer );
        if ( a < 0 ) a = walkWord( r.startContainer, r.startOffset, 1 );
        if ( b < 0 ) b = walkWord( r.endContainer, r.endOffset, -1 );
        if ( a < 0 || b < 0 ) return null;
        if ( a > b ) [ a, b ] = [ b, a ];
        return { from: a, to: b };
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

    function selectWords( a, b ) {
        if ( a > b ) [ a, b ] = [ b, a ];
        const r = document.createRange();
        r.setStartBefore( spans[ a ] );
        r.setEndAfter( spans[ b ] );
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange( r );
    }

    function updateSelButtons() {
        let anyCut = false, anyKept = false;
        if ( sel ) for ( let i = sel.from; i <= sel.to; i++ ) { if ( cut[ i ] ) anyCut = true; else anyKept = true; }
        $( "btnRedline" ).disabled = $( "floatRedline" ).disabled = !sel || !anyKept;
        $( "btnRestore" ).disabled = $( "floatRestore" ).disabled = !sel || !anyCut;
        $( "floatRedline" ).hidden = !anyKept;
        $( "floatRestore" ).hidden = !anyCut;
    }

    function showFloat() {
        const s = window.getSelection();
        if ( !s || s.rangeCount === 0 ) return hideFloat();
        const rect = s.getRangeAt( 0 ).getBoundingClientRect();
        if ( !rect.width && !rect.height ) return hideFloat();
        float.hidden = false;
        const top = rect.top - 10;
        const flip = top < 60;
        float.style.left = Math.min( Math.max( rect.left + rect.width / 2, 90 ), innerWidth - 90 ) + "px";
        float.style.top = ( flip ? rect.bottom + 10 : top ) + "px";
        float.style.transform = flip ? "translate( -50%, 0 )" : "translate( -50%, -100% )";
    }

    function hideFloat() { float.hidden = true; }

    document.addEventListener( "selectionchange", () => {
        const s = readSelection();
        sel = s;
        updateSelButtons();
        if ( s ) showFloat(); else hideFloat();
    } );

    for ( const b of [ $( "btnRedline" ), $( "btnRestore" ), $( "btnUndo" ), $( "btnFillers" ), $( "floatRedline" ), $( "floatRestore" ) ] ) {
        b.addEventListener( "pointerdown", ( e ) => e.preventDefault() );
    }
    $( "btnRedline" ).onclick = $( "floatRedline" ).onclick = () => sel && applyCut( sel.from, sel.to, true );
    $( "btnRestore" ).onclick = $( "floatRestore" ).onclick = () => sel && applyCut( sel.from, sel.to, false );
    $( "btnUndo" ).onclick = doUndo;

    /* ---------- keyboard editing ---------- */

    function setCaret( i, extend ) {
        if ( !words.length ) return;
        i = Math.max( 0, Math.min( words.length - 1, i ) );
        spans[ caret ]?.classList.remove( "is-caret" );
        caret = i;
        if ( !extend || anchor < 0 ) anchor = i;
        spans[ i ].classList.add( "is-caret" );
        if ( extend ) selectWords( anchor, caret );
        else { window.getSelection()?.removeAllRanges(); sel = null; updateSelButtons(); hideFloat(); }
        const r = spans[ i ].getBoundingClientRect();
        if ( r.top < 80 || r.bottom > innerHeight - 40 ) spans[ i ].scrollIntoView( { block: "center", behavior: "smooth" } );
    }

    function caretLine( dir ) {
        if ( caret < 0 ) return;
        const base = spans[ caret ].getBoundingClientRect();
        const cx = base.left + base.width / 2;
        let i = caret, best = -1, bestDx = Infinity;
        while ( ( i += dir ) >= 0 && i < words.length ) {
            const r = spans[ i ].getBoundingClientRect();
            const sameLine = Math.abs( r.top - base.top ) < base.height * 0.5;
            if ( sameLine ) continue;
            if ( best >= 0 && Math.abs( r.top - spans[ best ].getBoundingClientRect().top ) > base.height * 0.5 ) break;
            const dx = Math.abs( r.left + r.width / 2 - cx );
            if ( dx < bestDx ) { bestDx = dx; best = i; }
        }
        return best < 0 ? ( dir > 0 ? words.length - 1 : 0 ) : best;
    }

    document.addEventListener( "keydown", ( e ) => {
        const tag = e.target.tagName;
        if ( tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target.isContentEditable ) return;
        const mod = e.metaKey || e.ctrlKey;
        if ( mod && e.key.toLowerCase() === "z" ) { e.preventDefault(); doUndo(); return; }
        if ( !words.length ) return;
        if ( e.key === "Backspace" || e.key === "Delete" ) {
            e.preventDefault();
            if ( sel ) applyCut( sel.from, sel.to, true );
            else if ( caret >= 0 ) applyCut( caret, caret, !cut[ caret ] );
            return;
        }
        if ( e.key === "ArrowLeft" || e.key === "ArrowRight" ) {
            if ( tag === "VIDEO" || e.target === $( "strip" ) ) return;
            e.preventDefault();
            const dir = e.key === "ArrowLeft" ? -1 : 1;
            const from = caret >= 0 ? caret : ( nowIndex >= 0 ? nowIndex : 0 );
            let i = from + dir;
            if ( mod ) { while ( i > 0 && i < words.length - 1 && !/[.?!]$/.test( words[ i + ( dir < 0 ? -1 : 0 ) ].text ) ) i += dir; }
            setCaret( caret < 0 ? from : i, e.shiftKey );
            return;
        }
        if ( e.key === "ArrowUp" || e.key === "ArrowDown" ) {
            if ( tag === "VIDEO" ) return;
            if ( caret < 0 ) { setCaret( nowIndex >= 0 ? nowIndex : 0, false ); e.preventDefault(); return; }
            e.preventDefault();
            setCaret( caretLine( e.key === "ArrowUp" ? -1 : 1 ), e.shiftKey );
            return;
        }
        if ( e.key === "Enter" && caret >= 0 ) { e.preventDefault(); seek( words[ caret ].start + 0.001 ); return; }
        if ( e.key === "Escape" ) { window.getSelection()?.removeAllRanges(); spans[ caret ]?.classList.remove( "is-caret" ); caret = anchor = -1; hideFloat(); return; }
        if ( e.key === " " && tag !== "BUTTON" && tag !== "VIDEO" ) {
            e.preventDefault();
            video.paused ? video.play() : video.pause();
        }
    } );

    /* ---------- word click / seek ---------- */

    let downAt = null;
    transcript.addEventListener( "pointerdown", ( e ) => { downAt = { x: e.clientX, y: e.clientY, t: Date.now() }; } );
    transcript.addEventListener( "click", ( e ) => {
        const i = wordIndexOf( e.target );
        if ( i < 0 || !downAt ) return;
        const moved = Math.hypot( e.clientX - downAt.x, e.clientY - downAt.y ) > 6;
        const s = window.getSelection();
        if ( moved || ( s && !s.isCollapsed ) ) return;
        setCaret( i, false );
        seek( words[ i ].start + 0.001 );
    } );

    function seek( t ) {
        video.currentTime = Math.min( Math.max( 0, t ), duration );
        paint( true );
    }

    /* ---------- playback loop ---------- */

    function paint( force ) {
        const t = video.currentTime;
        if ( !video.paused && !video.seeking && !skipping ) {
            for ( const r of ranges ) {
                if ( t >= r.start - 0.12 && t < r.end ) { skipTo( r ); return; }
            }
        }
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

    function skipTo( r ) {
        skipping = true;
        const wasMuted = video.muted;
        video.muted = true;
        $( "skip" ).classList.add( "is-on" );
        const land = r.end >= duration - 0.05 ? duration : r.end;
        const done = () => {
            video.removeEventListener( "seeked", done );
            video.muted = wasMuted;
            skipping = false;
            $( "skip" ).classList.remove( "is-on" );
            if ( land >= duration ) video.pause();
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
    video.addEventListener( "seeked", () => { if ( !skipping ) paint( true ); } );
    video.addEventListener( "pause", () => paint( true ) );
    video.addEventListener( "timeupdate", () => { if ( video.paused ) paint( false ); } );

    $( "timeMode" ).onclick = () => {
        outputTime = !outputTime;
        $( "timeMode" ).setAttribute( "aria-pressed", String( outputTime ) );
        relabel();
        refreshCuts();
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
        if ( !f || !/^video\//.test( f.type ) && !/\.(mp4|mov|m4v|webm)$/i.test( f.name ) ) return;
        if ( worker ) { worker.postMessage( { type: "cancel" } ); worker.terminate(); worker = null; }
        if ( url ) URL.revokeObjectURL( url );
        file = f; url = URL.createObjectURL( f );
        docKey = [ f.name, f.size, f.lastModified ].join( "|" );
        words = []; cut = []; undo = []; ranges = []; sel = null; env = null;
        resetDoc();
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
    for ( const ev of [ "dragenter", "dragover" ] ) main.addEventListener( ev, ( e ) => { e.preventDefault(); main.classList.add( "is-drag" ); } );
    for ( const ev of [ "dragleave", "drop" ] ) main.addEventListener( ev, ( e ) => { e.preventDefault(); main.classList.remove( "is-drag" ); } );
    main.addEventListener( "drop", ( e ) => openFile( e.dataTransfer.files[ 0 ] ) );

    /* ---------- transcription ---------- */

    function chosenModel() {
        const v = $( "model" ).value;
        if ( v !== "auto" ) return v;
        return ( navigator.gpu && !MOBILE ) ? MODELS.small : MODELS.base;
    }

    function transcribe() {
        transcribing = true;
        cut = [];
        env = new Uint8Array( Math.ceil( duration * 100 ) + 100 ).fill( 255 );
        $( "progress" ).hidden = false;
        $( "progressFill" ).style.width = "0%";
        $( "progressText" ).textContent = "Starting…";
        $( "btnExport" ).disabled = true;
        transcript.innerHTML = `<p class="transcript-empty">Words will appear here as they're recognized. You can play the video meanwhile.</p>`;
        let placeholder = true;
        worker = new Worker( "transcribe-worker.js", { type: "module" } );
        const model = chosenModel();
        worker.postMessage( { type: "run", file, model, device: "auto", duration } );
        worker.onmessage = async ( ev ) => {
            const m = ev.data;
            if ( m.type === "status" ) { setStatus( m.text ); $( "progressText" ).textContent = m.text; }
            if ( m.type === "model" ) {
                if ( m.phase === "download" && m.total ) {
                    $( "progressFill" ).style.width = ( m.loaded / m.total * 100 ).toFixed( 1 ) + "%";
                    $( "progressText" ).textContent = `Fetching model · ${ fmtBytes( m.loaded ) } of ${ fmtBytes( m.total ) } (cached after the first time)`;
                }
                if ( m.phase === "ready" ) { $( "progressFill" ).style.width = "0%"; }
            }
            if ( m.type === "progress" ) {
                $( "progressFill" ).style.width = ( m.fraction * 100 ).toFixed( 1 ) + "%";
                setStatus( `Transcribing · ${ Math.round( m.fraction * 100 ) }% · ${ m.model.split( "/" ).pop().replace( "_timestamped", "" ) } on ${ m.device }` );
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
                if ( placeholder ) { transcript.innerHTML = ""; placeholder = false; }
                const start = words.length;
                words.push( ...m.words );
                for ( let i = start; i < words.length; i++ ) cut[ i ] = false;
                appendWords( m.words, start );
                refreshCuts();
            }
            if ( m.type === "needAudio" ) {
                if ( duration > FALLBACK_MAX_SEC ) {
                    fail( `This browser can't decode the audio track directly, and the fallback decoder needs the whole file in memory, which is too much for a ${ tc( duration, false ) } video. Re-encode to MP4 with AAC audio or use Chrome.` );
                    return;
                }
                try {
                    $( "progressText" ).textContent = "Decoding audio with Web Audio…";
                    const audio = await decodeWholeFile( file );
                    worker.postMessage( { type: "run", audio, model, device: "auto", duration }, [ audio.buffer ] );
                } catch ( e ) { fail( "Couldn't read this file's audio: " + e.message ); }
            }
            if ( m.type === "done" ) {
                transcribing = false;
                $( "progress" ).hidden = true;
                setStatus( `${ words.length } words · ${ m.model.split( "/" ).pop().replace( "_timestamped", "" ) } on ${ m.device } · nothing left your device` );
                if ( !words.length ) transcript.innerHTML = `<p class="transcript-empty">No speech was recognized in this video.</p>`;
                refreshCuts();
                worker.terminate(); worker = null;
            }
            if ( m.type === "error" ) fail( m.message );
        };
        worker.onerror = ( e ) => fail( e.message || "Worker failed to start" );
    }

    function fail( msg ) {
        transcribing = false;
        $( "progressText" ).textContent = "Failed: " + msg;
        setStatus( "Transcription failed" );
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

    /* ---------- transcript export ---------- */

    const tmenu = $( "tmenu" ), tmenuPop = $( "tmenuPop" );
    $( "btnTranscript" ).onclick = () => {
        const open = tmenuPop.hidden;
        tmenuPop.hidden = !open;
        $( "btnTranscript" ).setAttribute( "aria-expanded", String( open ) );
    };
    document.addEventListener( "pointerdown", ( e ) => {
        if ( !tmenu.contains( e.target ) ) { tmenuPop.hidden = true; $( "btnTranscript" ).setAttribute( "aria-expanded", "false" ); }
    } );
    for ( const b of tmenuPop.querySelectorAll( "button" ) ) {
        b.onclick = () => {
            const fmt = b.dataset.fmt;
            const keepCut = $( "tmenuKeep" ).checked;
            const text = fmt === "txt" ? plainText( keepCut ) : captions( fmt, keepCut );
            download( new Blob( [ text ], { type: fmt === "vtt" ? "text/vtt" : "text/plain" } ), `${ file.name.replace( /\.[^.]+$/, "" ) }${ keepCut ? "" : " (redlined)" }.${ fmt }` );
            tmenuPop.hidden = true;
        };
    }

    function exportWords( keepCut ) {
        return words.map( ( w, i ) => ( { ...w, i } ) ).filter( ( w ) => keepCut || !cut[ w.i ] ).map( ( w ) => ( {
            text: w.text,
            start: keepCut ? w.start : outTime( w.start ),
            end: keepCut ? w.end : outTime( w.end ),
            i: w.i
        } ) );
    }

    function plainText( keepCut ) {
        const ws = exportWords( keepCut );
        let out = "", para = [];
        let lastEnd = -Infinity;
        const flush = () => { if ( para.length ) out += para.join( " " ) + "\n\n"; para = []; };
        for ( const w of ws ) {
            const gap = w.start - lastEnd;
            const prev = para[ para.length - 1 ];
            if ( para.length && ( gap > 1.1 || ( prev && /[.?!]["')\]]?$/.test( prev ) && gap > 0.45 ) ) ) flush();
            para.push( w.text );
            lastEnd = w.end;
        }
        flush();
        return out.trim() + "\n";
    }

    function captions( fmt, keepCut ) {
        const ws = exportWords( keepCut );
        const cues = [];
        let cue = null;
        for ( const w of ws ) {
            const text = cue ? cue.text + " " + w.text : w.text;
            const tooLong = text.length > 84 || ( cue && w.end - cue.start > 6 );
            const bigGap = cue && w.start - cue.end > 0.7;
            const afterSentence = cue && /[.?!]["')\]]?$/.test( cue.last ) && text.length > 40;
            if ( !cue || tooLong || bigGap || afterSentence ) {
                if ( cue ) cues.push( cue );
                cue = { start: w.start, end: w.end, text: w.text, last: w.text };
            } else {
                cue.text = text; cue.end = w.end; cue.last = w.text;
            }
        }
        if ( cue ) cues.push( cue );
        const stamp = ( t ) => {
            const h = Math.floor( t / 3600 ), m = Math.floor( t / 60 ) % 60, s = Math.floor( t % 60 ), ms = Math.round( ( t % 1 ) * 1000 );
            return `${ pad( h ) }:${ pad( m ) }:${ pad( s ) }${ fmt === "vtt" ? "." : "," }${ pad( ms, 3 ) }`;
        };
        const wrap = ( t ) => {
            if ( t.length <= 42 ) return t;
            const mid = t.lastIndexOf( " ", Math.ceil( t.length / 2 ) + 8 );
            return mid > 0 ? t.slice( 0, mid ) + "\n" + t.slice( mid + 1 ) : t;
        };
        let out = fmt === "vtt" ? "WEBVTT\n\n" : "";
        cues.forEach( ( c, k ) => {
            const end = Math.max( c.end, c.start + 0.8 );
            out += ( fmt === "srt" ? `${ k + 1 }\n` : "" ) + `${ stamp( c.start ) } --> ${ stamp( end ) }\n${ wrap( c.text ) }\n\n`;
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

    /* ---------- export ---------- */

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

    $( "btnExport" ).onclick = async () => {
        const segments = keepSegments();
        if ( !segments.length ) return;
        video.pause();
        const base = file.name.replace( /\.[^.]+$/, "" );
        const kept = segments.reduce( ( s, [ a, b ] ) => s + ( b - a ), 0 );
        let handle = null;
        if ( window.showSaveFilePicker ) {
            try {
                handle = await showSaveFilePicker( {
                    suggestedName: `${ base } (redlined).mp4`,
                    types: [ { description: "MP4 video", accept: { "video/mp4": [ ".mp4" ] } } ]
                } );
            } catch ( e ) { if ( e.name === "AbortError" ) return; }
        }
        if ( !handle ) {
            const estimate = file.size * ( kept / duration ) * 1.3;
            if ( estimate > MEM_EXPORT_MAX ) {
                showExportError( "Too large to export here", `This browser has to build the whole ${ fmtBytes( estimate ) } file in memory before saving it${ IOS ? ", and iOS will kill the page first" : "" }. Export on desktop Chrome or Edge, which stream straight to disk, or redline more of the video.` );
                return;
            }
        }
        $( "exportTitle" ).textContent = "Exporting";
        $( "exportSub" ).textContent = `${ segments.length } segment${ segments.length > 1 ? "s" : "" } · ${ tc( kept, false ) } kept of ${ tc( duration, false ) }`;
        $( "exportFill" ).style.width = "0%";
        $( "exportText" ).textContent = "Opening file…";
        $( "exportCancel" ).hidden = false;
        $( "exportDownload" ).hidden = true;
        $( "exportDone" ).hidden = true;
        sheet.showModal();

        exporter = new Worker( "export-worker.js", { type: "module" } );
        exporter.postMessage( { type: "run", file, segments, handle } );
        exporter.onmessage = ( ev ) => {
            const m = ev.data;
            if ( m.type === "info" ) {
                const a = m.audio === "encode" ? `audio ${ m.audioCodec }, 8 ms fades` : m.audio === "copy" ? `${ m.audioCodec } copied` : "no audio";
                $( "exportText" ).textContent = `${ m.width }×${ m.height } · ${ m.codec } @ ${ ( m.bitrate / 1e6 ).toFixed( 1 ) } Mb/s · ${ a }`;
            }
            if ( m.type === "progress" ) $( "exportFill" ).style.width = ( m.fraction * 100 ).toFixed( 1 ) + "%";
            if ( m.type === "done" ) {
                $( "exportFill" ).style.width = "100%";
                $( "exportTitle" ).textContent = "Exported";
                $( "exportCancel" ).hidden = true;
                if ( m.buffer ) {
                    const blob = new Blob( [ m.buffer ], { type: "video/mp4" } );
                    const dl = $( "exportDownload" );
                    if ( dl.href ) URL.revokeObjectURL( dl.href );
                    dl.href = URL.createObjectURL( blob );
                    dl.download = `${ base } (redlined).mp4`;
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
    };

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
        load( demoWords, demoCut, dur ) {
            worker?.terminate(); worker = null;
            duration = dur; words = demoWords; cut = demoCut; transcribing = false; env = null;
            main.classList.remove( "is-empty" ); $( "stage" ).hidden = false; $( "progress" ).hidden = true;
            renderAll();
        },
        paint: ( t ) => { spans[ nowIndex ]?.classList.remove( "is-now" ); nowIndex = wordAt( t ); spans[ nowIndex ]?.classList.add( "is-now" ); $( "tcNow" ).textContent = tc( t ); $( "stripHead" ).style.left = ( t / duration * 100 ) + "%"; },
        state: () => ( { words, cut, ranges, env } )
    };
} )();
