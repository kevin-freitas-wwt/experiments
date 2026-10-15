import { pipeline, env, WhisperTextStreamer } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";

const RATE = 16000;
const SLAB = 300;
const LOOK = 4;
const CHUNK = 30;
const STRIDE = 4;
const VOICE_DB = 14;
const VOICE_PAD = 0.3;
const VOICE_GAP = 0.6;
const VOICE_MIN = 0.25;

let runId = 0;

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;
let loaded = { model: null, device: null };
let cancelled = false;

const post = ( type, data, id = runId ) => self.postMessage( { type, run: id, ...data } );

async function pickDevice( want ) {
    if ( want === "wasm" ) return "wasm";
    if ( !navigator.gpu ) return "wasm";
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter ? "webgpu" : "wasm";
    } catch { return "wasm"; }
}

let loading = null;

async function load( model, device ) {
    if ( loading ) await loading.catch( () => {} );
    if ( asr && loaded.model === model && loaded.device === device ) return;
    loading = loadFresh( model, device );
    try { await loading; } finally { loading = null; }
}

async function loadFresh( model, device ) {
    if ( asr ) { await asr.dispose(); asr = null; }
    const dtype = device === "webgpu"
        ? { encoder_model: "fp32", decoder_model_merged: /tiny/.test( model ) ? "fp32" : "q4" }
        : "q8";
    const files = new Map();
    asr = await pipeline( "automatic-speech-recognition", model, {
        device, dtype,
        progress_callback: ( p ) => {
            if ( p.status === "progress" ) {
                files.set( p.file, [ p.loaded, p.total ] );
                let loadedB = 0, totalB = 0;
                for ( const [ l, t ] of files.values() ) { loadedB += l; totalB += t; }
                post( "model", { phase: "download", loaded: loadedB, total: totalB } );
            } else if ( p.status === "ready" ) {
                post( "model", { phase: "ready" } );
            }
        }
    } );
    loaded = { model, device };
}

/* ---------- audio extraction via mediabunny + WebCodecs ---------- */

async function* audioChunks( file ) {
    const mb = await import( "https://cdn.jsdelivr.net/npm/mediabunny@1.61.4/dist/bundles/mediabunny.min.mjs" );
    const input = new mb.Input( { source: new mb.BlobSource( file ), formats: mb.ALL_FORMATS } );
    const track = await input.getPrimaryAudioTrack();
    if ( !track ) throw new Error( "This video has no audio track." );
    if ( !( await track.canDecode() ) ) throw new Error( "undecodable" );
    const sink = new mb.AudioSampleSink( track );
    const src = track.sampleRate;
    const ch = track.numberOfChannels;
    const ratio = src / RATE;
    let carry = new Float32Array( 0 );
    let phase = 0;
    for await ( const s of sink.samples() ) {
        if ( cancelled ) { s.close(); return; }
        const n = s.numberOfFrames;
        const mono = new Float32Array( n );
        const plane = new Float32Array( n );
        for ( let c = 0; c < ch; c++ ) {
            s.copyTo( plane, { format: "f32-planar", planeIndex: c } );
            for ( let i = 0; i < n; i++ ) mono[ i ] += plane[ i ] / ch;
        }
        s.close();
        const buf = new Float32Array( carry.length + n );
        buf.set( carry ); buf.set( mono, carry.length );
        const outN = Math.max( 0, Math.floor( ( buf.length - 1 - phase ) / ratio ) );
        const out = new Float32Array( outN );
        let pos = phase;
        for ( let i = 0; i < outN; i++ ) {
            const k = Math.floor( pos );
            const f = pos - k;
            out[ i ] = buf[ k ] * ( 1 - f ) + buf[ k + 1 ] * f;
            pos += ratio;
        }
        const keepFrom = Math.floor( pos );
        carry = buf.slice( keepFrom );
        phase = pos - keepFrom;
        yield out;
    }
    if ( carry.length ) yield carry.length > 1 ? resampleTail( carry, ratio, phase ) : new Float32Array( 0 );
}

function resampleTail( buf, ratio, phase ) {
    const outN = Math.max( 0, Math.floor( ( buf.length - 1 - phase ) / ratio ) );
    const out = new Float32Array( outN );
    let pos = phase;
    for ( let i = 0; i < outN; i++ ) {
        const k = Math.floor( pos ), f = pos - k;
        out[ i ] = buf[ k ] * ( 1 - f ) + buf[ k + 1 ] * f;
        pos += ratio;
    }
    return out;
}

async function* slabs( source ) {
    const cap = ( SLAB + LOOK ) * RATE;
    let buf = new Float32Array( cap );
    let len = 0;
    let offset = 0;
    for await ( const c of source ) {
        let pos = 0;
        while ( pos < c.length ) {
            const take = Math.min( c.length - pos, cap - len );
            buf.set( c.subarray( pos, pos + take ), len );
            len += take; pos += take;
            if ( len === cap ) {
                const cut = quietest( buf, ( SLAB - LOOK ) * RATE, cap );
                yield { audio: buf.slice( 0, cut ), offset };
                offset += cut / RATE;
                buf.copyWithin( 0, cut, len );
                len -= cut;
            }
        }
    }
    if ( len > RATE * 0.5 ) yield { audio: buf.slice( 0, len ), offset };
    buf = null;
}

function envelope( a ) {
    const hop = RATE / 100;
    const n = Math.floor( a.length / hop );
    const out = new Uint8Array( n );
    for ( let i = 0; i < n; i++ ) {
        let e = 0;
        const base = i * hop;
        for ( let k = 0; k < hop; k++ ) e += a[ base + k ] * a[ base + k ];
        const db = 10 * Math.log10( e / hop + 1e-10 );
        out[ i ] = Math.max( 0, Math.min( 255, Math.round( ( db + 80 ) * 3 ) ) );
    }
    return out;
}

function quietest( a, from, to ) {
    const win = Math.floor( RATE * 0.1 );
    let best = from, bestE = Infinity;
    for ( let s = from; s + win < to; s += win >> 1 ) {
        let e = 0;
        for ( let i = s; i < s + win; i++ ) e += a[ i ] * a[ i ];
        if ( e < bestE ) { bestE = e; best = s + ( win >> 1 ); }
    }
    return best;
}

/* ---------- silence skipping ---------- */

function voicedRegions( env, seconds ) {
    const sorted = Float64Array.from( env ).sort();
    const floor = sorted[ Math.floor( sorted.length * 0.1 ) ] ?? 0;
    const thresh = floor + VOICE_DB * 3;
    const raw = [];
    let s0 = -1;
    for ( let i = 0; i <= env.length; i++ ) {
        const on = i < env.length && env[ i ] > thresh;
        if ( on && s0 < 0 ) s0 = i;
        if ( !on && s0 >= 0 ) { raw.push( [ s0 / 100, i / 100 ] ); s0 = -1; }
    }
    const merged = [];
    for ( const [ a, b ] of raw ) {
        const pa = Math.max( 0, a - VOICE_PAD ), pb = Math.min( seconds, b + VOICE_PAD );
        const last = merged[ merged.length - 1 ];
        if ( last && pa - last[ 1 ] < VOICE_GAP ) last[ 1 ] = pb;
        else merged.push( [ pa, pb ] );
    }
    return merged.filter( ( [ a, b ] ) => b - a >= VOICE_MIN );
}

function compact( audio, regions ) {
    const total = regions.reduce( ( n, [ a, b ] ) => n + Math.round( ( b - a ) * RATE ), 0 );
    const out = new Float32Array( total );
    const map = [];
    let pos = 0;
    for ( const [ a, b ] of regions ) {
        const i0 = Math.round( a * RATE ), i1 = Math.min( audio.length, Math.round( b * RATE ) );
        out.set( audio.subarray( i0, i1 ), pos );
        map.push( { at: pos / RATE, src: a, len: ( i1 - i0 ) / RATE } );
        pos += i1 - i0;
    }
    return { audio: out.subarray( 0, pos ), map };
}

function unmap( t, map ) {
    let r = map[ 0 ];
    for ( const m of map ) { if ( m.at <= t ) r = m; else break; }
    return r ? r.src + Math.min( t - r.at, r.len ) : t;
}

/* ---------- transcription ---------- */

async function transcribeSlab( audio, offset, onProgress, map, say = post ) {
    const seconds = audio.length / RATE;
    const windowN = CHUNK * RATE, strideN = STRIDE * RATE;
    const total = seconds <= CHUNK ? 1 : Math.ceil( ( audio.length - windowN ) / ( windowN - 2 * strideN ) ) + 1;
    let done = 0, tokens = 0;
    let live = "", lastLive = 0;
    const expect = Math.min( seconds, CHUNK ) * 3.6;
    const streamer = new WhisperTextStreamer( asr.tokenizer, {
        skip_prompt: true,
        token_callback_function: () => {
            tokens++;
            if ( tokens % 8 === 0 ) onProgress( Math.min( ( done + Math.min( 0.95, tokens / expect ) ) / total, 1 ) );
        },
        callback_function: ( text ) => {
            live = ( live + text ).slice( -80 );
            if ( performance.now() - lastLive > 250 ) { lastLive = performance.now(); say( "live", { text: live } ); }
        },
        on_finalize: () => { done++; tokens = 0; onProgress( Math.min( done / total, 1 ) ); }
    } );
    const out = await asr( audio, {
        return_timestamps: "word",
        chunk_length_s: seconds <= CHUNK ? 0 : CHUNK,
        stride_length_s: STRIDE,
        streamer
    } );
    const words = [];
    for ( const c of out.chunks || [] ) {
        const text = c.text.trim();
        if ( !text ) continue;
        let start = c.timestamp[ 0 ] ?? 0;
        let end = c.timestamp[ 1 ] ?? start + 0.3;
        if ( map ) { start = unmap( start, map ); end = unmap( end, map ); }
        start += offset; end += offset;
        words.push( { text, start, end: Math.max( end, start + 0.05 ) } );
    }
    return words;
}

async function run( { file, audio, model, device: wantDevice, duration } ) {
    cancelled = false;
    const me = runId;
    const dead = () => cancelled || me !== runId;
    const say = ( type, data ) => { if ( !dead() ) post( type, data, me ); };
    try {
        const device = await pickDevice( wantDevice );
        say( "status", { text: `Loading ${ model.split( "/" ).pop() } on ${ device }` } );
        try {
            await load( model, device );
        } catch ( e ) {
            if ( device !== "wasm" ) {
                say( "status", { text: "WebGPU failed, falling back to WASM" } );
                await load( model, "wasm" );
            } else throw e;
        }
        if ( dead() ) return;
        say( "status", { text: "Reading audio" } );
        let source;
        if ( audio ) {
            source = ( async function* () {
                const step = RATE * 60;
                for ( let i = 0; i < audio.length; i += step ) yield audio.subarray( i, i + step );
                audio = null;
            } )();
        } else {
            try {
                source = audioChunks( file );
                const probe = await source.next();
                if ( probe.done ) throw new Error( "undecodable" );
                const first = probe.value;
                const rest = source;
                source = ( async function* () { yield first; yield* rest; } )();
            } catch ( e ) {
                if ( /no audio track/i.test( e.message ) ) throw e;
                if ( /undecodable|decod/i.test( e.message ) ) { say( "needAudio", {} ); return; }
                throw e;
            }
        }
        let doneSec = 0, skipped = 0;
        say( "progress", { fraction: 0, device: loaded.device, model: loaded.model } );
        const queue = [];
        let producerDone = false, wake = null;
        const notify = () => { if ( wake ) { wake(); wake = null; } };
        ( async () => {
            try {
                for await ( const slab of slabs( source ) ) {
                    if ( dead() ) break;
                    queue.push( slab );
                    notify();
                    while ( queue.length >= 2 && !dead() ) await new Promise( ( r ) => { wake = r; } );
                }
            } catch ( e ) { queue.push( { error: e } ); }
            producerDone = true;
            notify();
        } )();
        while ( true ) {
            if ( dead() ) return;
            if ( !queue.length ) {
                if ( producerDone ) break;
                await new Promise( ( r ) => { wake = r; } );
                continue;
            }
            const item = queue.shift();
            notify();
            if ( item.error ) throw item.error;
            const { audio: slab, offset } = item;
            const slabSec = slab.length / RATE;
            const env = envelope( slab );
            say( "envelope", { offset, env } );
            const regions = voicedRegions( env, slabSec );
            let input = slab, map = null;
            const voiced = regions.reduce( ( n, [ a, b ] ) => n + ( b - a ), 0 );
            if ( regions.length && slabSec - voiced >= 1 ) {
                ( { audio: input, map } = compact( slab, regions ) );
                skipped += slabSec - voiced;
            }
            const words = regions.length ? await transcribeSlab( input, offset, ( f ) => {
                say( "progress", { fraction: Math.min( ( doneSec + f * slabSec ) / duration, 0.995 ), device: loaded.device, model: loaded.model } );
            }, map, say ) : [];
            if ( dead() ) return;
            doneSec += slabSec;
            say( "words", { words } );
        }
        say( "stats", { skipped } );
        say( "done", { device: loaded.device, model: loaded.model } );
    } catch ( e ) {
        if ( !dead() ) say( "error", { message: e.message || String( e ) } );
    }
}

self.onmessage = ( ev ) => {
    const m = ev.data;
    if ( m.type === "run" ) { runId = m.run ?? runId + 1; run( m ); }
    if ( m.type === "cancel" ) cancelled = true;
};
