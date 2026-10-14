( function() {
    "use strict";

    const $ = ( id ) => document.getElementById( id );
    const main = $( "main" ), video = $( "video" ), transcript = $( "transcript" );
    const float = $( "float" );
    const MOBILE = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test( navigator.userAgent );
    const MODELS = {
        small: "onnx-community/whisper-small.en_timestamped",
        base: "onnx-community/whisper-base.en_timestamped"
    };

    /* ---------- state ---------- */

    let file = null, url = null, duration = 0, docKey = null;
    let words = [];
    let cut = [];
    let undo = [];
    let ranges = [];
    let spans = [];
    let sel = null;
    let nowIndex = -1;
    let lastPara = null, lastWord = null, paraStart = 0;
    let worker = null, exporter = null;
    let userScrolledAt = 0;
    let transcribing = false;

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

    /* ---------- persistence ---------- */

    function save() {
        if ( !docKey ) return;
        try {
            localStorage.setItem( "redline.doc." + docKey, JSON.stringify( { words, cut: cut.map( Number ).join( "" ), done: !transcribing } ) );
            const idx = JSON.parse( localStorage.getItem( "redline.index" ) || "[]" ).filter( ( k ) => k !== docKey );
            idx.unshift( docKey );
            for ( const k of idx.splice( 6 ) ) localStorage.removeItem( "redline.doc." + k );
            localStorage.setItem( "redline.index", JSON.stringify( idx ) );
        } catch {}
    }

    function restore() {
        try {
            const d = JSON.parse( localStorage.getItem( "redline.doc." + docKey ) );
            if ( !d || !d.done || !d.words?.length ) return false;
            words = d.words;
            cut = [ ...d.cut ].map( ( c ) => c === "1" );
            return true;
        } catch { return false; }
    }

    /* ---------- transcript rendering ---------- */

    function resetDoc() {
        transcript.innerHTML = "";
        spans = []; lastPara = null; lastWord = null; paraStart = 0; nowIndex = -1;
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
                label.textContent = tc( w.start, false );
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

    /* ---------- cuts ---------- */

    function refreshCuts() {
        ranges = [];
        let a = -1;
        for ( let i = 0; i <= words.length; i++ ) {
            const on = i < words.length && cut[ i ];
            if ( on && a < 0 ) a = i;
            if ( !on && a >= 0 ) {
                ranges.push( { from: a, to: i - 1, start: words[ a ].start, end: words[ i - 1 ].end } );
                a = -1;
            }
        }
        for ( let i = 0; i < spans.length; i++ ) spans[ i ]?.classList.toggle( "is-cut", !!cut[ i ] );
        const cutSec = ranges.reduce( ( s, r ) => s + ( r.end - r.start ), 0 );
        $( "stripCuts" ).innerHTML = ranges.map( ( r ) =>
            `<div class="strip-cut" style="left:${ ( r.start / duration * 100 ).toFixed( 3 ) }%;width:${ Math.max( 0.15, ( r.end - r.start ) / duration * 100 ).toFixed( 3 ) }%"></div>` ).join( "" );
        $( "tcLen" ).textContent = tc( duration, false );
        $( "tcCut" ).textContent = cutSec ? `−${ tc( cutSec, false ) } → ${ tc( duration - cutSec, false ) }` : "";
        $( "toolsNote" ).textContent = ranges.length ? `${ ranges.length } cut${ ranges.length > 1 ? "s" : "" } · ${ cutSec.toFixed( 1 ) }s removed` : "";
        $( "btnUndo" ).disabled = !undo.length;
        $( "btnExport" ).disabled = transcribing || !words.length || !ranges.length;
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
        if ( a < 0 ) a = nextWordFrom( r.startContainer, r.startOffset );
        if ( b < 0 ) b = prevWordFrom( r.endContainer, r.endOffset );
        if ( a < 0 || b < 0 ) return null;
        if ( a > b ) [ a, b ] = [ b, a ];
        return { from: a, to: b };
    }

    function nextWordFrom( node, offset ) {
        const walker = document.createTreeWalker( transcript, NodeFilter.SHOW_ELEMENT );
        walker.currentNode = node.nodeType === 3 ? node : ( node.childNodes[ offset ] || node );
        let n = walker.currentNode;
        while ( n ) {
            if ( n.classList?.contains( "w" ) ) return +n.dataset.i;
            n = walker.nextNode();
        }
        return -1;
    }

    function prevWordFrom( node, offset ) {
        const walker = document.createTreeWalker( transcript, NodeFilter.SHOW_ELEMENT );
        walker.currentNode = node.nodeType === 3 ? node : ( node.childNodes[ offset - 1 ] || node );
        let n = walker.currentNode;
        while ( n ) {
            if ( n.classList?.contains( "w" ) ) return +n.dataset.i;
            n = walker.previousNode();
        }
        return -1;
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

    for ( const b of [ $( "btnRedline" ), $( "btnRestore" ), $( "btnUndo" ), $( "floatRedline" ), $( "floatRestore" ) ] ) {
        b.addEventListener( "pointerdown", ( e ) => e.preventDefault() );
    }
    $( "btnRedline" ).onclick = $( "floatRedline" ).onclick = () => sel && applyCut( sel.from, sel.to, true );
    $( "btnRestore" ).onclick = $( "floatRestore" ).onclick = () => sel && applyCut( sel.from, sel.to, false );
    $( "btnUndo" ).onclick = doUndo;

    document.addEventListener( "keydown", ( e ) => {
        const tag = e.target.tagName;
        if ( tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target.isContentEditable ) return;
        if ( ( e.metaKey || e.ctrlKey ) && e.key.toLowerCase() === "z" ) { e.preventDefault(); doUndo(); return; }
        if ( ( e.key === "Backspace" || e.key === "Delete" ) && sel ) { e.preventDefault(); applyCut( sel.from, sel.to, true ); return; }
        if ( e.key === " " && words.length && tag !== "BUTTON" && tag !== "VIDEO" ) {
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
        seek( words[ i ].start + 0.001 );
    } );

    function seek( t ) {
        video.currentTime = Math.min( Math.max( 0, t ), duration );
        paint( true );
    }

    /* ---------- playback loop ---------- */

    function paint( force ) {
        const t = video.currentTime;
        if ( !video.paused && !video.seeking ) {
            for ( const r of ranges ) {
                if ( t >= r.start - 0.02 && t < r.end ) {
                    if ( r.end >= duration - 0.05 ) { video.pause(); video.currentTime = duration; }
                    else video.currentTime = r.end;
                    return;
                }
            }
        }
        $( "tcNow" ).textContent = tc( t );
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
    video.addEventListener( "seeked", () => paint( true ) );
    video.addEventListener( "pause", () => paint( true ) );
    video.addEventListener( "timeupdate", () => { if ( video.paused ) paint( false ); } );

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
        words = []; cut = []; undo = []; ranges = []; sel = null;
        resetDoc();
        main.classList.remove( "is-empty" );
        $( "stage" ).hidden = false;
        $( "fileName" ).textContent = f.name;
        $( "fileMeta" ).textContent = fmtBytes( f.size );
        video.src = url;
        video.addEventListener( "loadedmetadata", () => {
            duration = video.duration;
            $( "fileMeta" ).textContent = `${ fmtBytes( f.size ) } · ${ video.videoWidth }×${ video.videoHeight } · ${ tc( duration, false ) }`;
            if ( restore() ) {
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
            if ( m.type === "words" && m.words.length ) {
                if ( placeholder ) { transcript.innerHTML = ""; placeholder = false; }
                const start = words.length;
                words.push( ...m.words );
                for ( let i = start; i < words.length; i++ ) cut[ i ] = false;
                appendWords( m.words, start );
                refreshCuts();
            }
            if ( m.type === "needAudio" ) {
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
        const buf = await f.arrayBuffer();
        const ctx = new OfflineAudioContext( 1, 1, 16000 );
        const ab = await ctx.decodeAudioData( buf );
        const out = new Float32Array( ab.length );
        for ( let c = 0; c < ab.numberOfChannels; c++ ) {
            const d = ab.getChannelData( c );
            for ( let i = 0; i < d.length; i++ ) out[ i ] += d[ i ] / ab.numberOfChannels;
        }
        return out;
    }

    /* ---------- export ---------- */

    const sheet = $( "exportSheet" );

    $( "btnExport" ).onclick = async () => {
        const segments = keepSegments();
        if ( !segments.length ) return;
        video.pause();
        const base = file.name.replace( /\.[^.]+$/, "" );
        let handle = null;
        if ( window.showSaveFilePicker ) {
            try {
                handle = await showSaveFilePicker( {
                    suggestedName: `${ base } (redlined).mp4`,
                    types: [ { description: "MP4 video", accept: { "video/mp4": [ ".mp4" ] } } ]
                } );
            } catch ( e ) { if ( e.name === "AbortError" ) return; }
        }
        const kept = segments.reduce( ( s, [ a, b ] ) => s + ( b - a ), 0 );
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
                const a = m.audio === "copy" ? `${ m.audioCodec } copied` : m.audio === "encode" ? "audio → aac" : "no audio";
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
                $( "exportTitle" ).textContent = "Export failed";
                $( "exportText" ).textContent = m.message;
                $( "exportCancel" ).hidden = true;
                $( "exportDone" ).hidden = false;
                exporter.terminate(); exporter = null;
            }
            if ( m.type === "cancelled" ) { sheet.close(); exporter.terminate(); exporter = null; }
        };
        exporter.onerror = ( e ) => {
            $( "exportTitle" ).textContent = "Export failed";
            $( "exportText" ).textContent = e.message || "Worker error";
            $( "exportCancel" ).hidden = true;
            $( "exportDone" ).hidden = false;
        };
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
            duration = dur; words = demoWords; cut = demoCut; transcribing = false;
            main.classList.remove( "is-empty" ); $( "stage" ).hidden = false; $( "progress" ).hidden = true;
            renderAll();
        },
        paint: ( t ) => { spans[ nowIndex ]?.classList.remove( "is-now" ); nowIndex = wordAt( t ); const i = nowIndex; spans[ i ]?.classList.add( "is-now" ); $( "tcNow" ).textContent = tc( t ); $( "stripHead" ).style.left = ( t / duration * 100 ) + "%"; }
    };
} )();
