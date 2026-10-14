import { pipeline, env, WhisperTextStreamer } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";

const RATE = 16000;
const SLAB = 300;
const LOOK = 4;
const CHUNK = 30;
const STRIDE = 5;

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;
let loaded = { model: null, device: null };
let cancelled = false;

const post = ( type, data ) => self.postMessage( { type, ...data } );

async function pickDevice( want ) {
    if ( want === "wasm" ) return "wasm";
    if ( !navigator.gpu ) return "wasm";
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter ? "webgpu" : "wasm";
    } catch { return "wasm"; }
}

async function load( model, device ) {
    if ( asr && loaded.model === model && loaded.device === device ) return;
    if ( asr ) { await asr.dispose(); asr = null; }
    const dtype = device === "webgpu"
        ? { encoder_model: "fp32", decoder_model_merged: /small|medium/.test( model ) ? "q4" : "fp32" }
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
    let pending = [];
    let pendingLen = 0;
    let offset = 0;
    const flush = ( upTo ) => {
        const all = new Float32Array( pendingLen );
        let p = 0;
        for ( const c of pending ) { all.set( c, p ); p += c.length; }
        const slab = all.subarray( 0, upTo );
        const rest = all.slice( upTo );
        pending = rest.length ? [ rest ] : [];
        pendingLen = rest.length;
        const r = { audio: slab, offset };
        offset += upTo / RATE;
        return r;
    };
    for await ( const c of source ) {
        pending.push( c ); pendingLen += c.length;
        while ( pendingLen >= ( SLAB + LOOK ) * RATE ) {
            const all = new Float32Array( pendingLen );
            let p = 0;
            for ( const x of pending ) { all.set( x, p ); p += x.length; }
            pending = [ all ]; pendingLen = all.length;
            const cut = quietest( all, ( SLAB - LOOK ) * RATE, ( SLAB + LOOK ) * RATE );
            yield flush( cut );
        }
    }
    if ( pendingLen > RATE * 0.5 ) yield flush( pendingLen );
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

/* ---------- transcription ---------- */

async function transcribeSlab( audio, offset, onProgress ) {
    const seconds = audio.length / RATE;
    const windowN = CHUNK * RATE, strideN = STRIDE * RATE;
    const total = seconds <= CHUNK ? 1 : Math.ceil( ( audio.length - windowN ) / ( windowN - 2 * strideN ) ) + 1;
    let done = 0;
    let live = "", lastLive = 0;
    const streamer = new WhisperTextStreamer( asr.tokenizer, {
        skip_prompt: true,
        callback_function: ( text ) => {
            live = ( live + text ).slice( -80 );
            if ( performance.now() - lastLive > 250 ) { lastLive = performance.now(); post( "live", { text: live } ); }
        },
        on_finalize: () => { done++; onProgress( Math.min( done / total, 1 ) ); }
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
        const start = ( c.timestamp[ 0 ] ?? 0 ) + offset;
        const end = ( c.timestamp[ 1 ] ?? c.timestamp[ 0 ] + 0.3 ) + offset;
        words.push( { text, start, end: Math.max( end, start + 0.05 ) } );
    }
    return words;
}

async function run( { file, audio, model, device: wantDevice, duration } ) {
    cancelled = false;
    try {
        const device = await pickDevice( wantDevice );
        post( "status", { text: `Loading ${ model.split( "/" ).pop() } on ${ device }` } );
        try {
            await load( model, device );
        } catch ( e ) {
            if ( device !== "wasm" ) {
                post( "status", { text: "WebGPU failed, falling back to WASM" } );
                await load( model, "wasm" );
            } else throw e;
        }
        if ( cancelled ) return;
        post( "status", { text: "Reading audio" } );
        let source;
        if ( audio ) {
            source = ( async function* () { yield audio; } )();
        } else {
            try {
                source = audioChunks( file );
                const probe = await source.next();
                if ( probe.done ) throw new Error( "undecodable" );
                const first = probe.value;
                const rest = source;
                source = ( async function* () { yield first; yield* rest; } )();
            } catch ( e ) {
                if ( /undecodable|no audio|decod/i.test( e.message ) ) { post( "needAudio", {} ); return; }
                throw e;
            }
        }
        let doneSec = 0;
        for await ( const { audio: slab, offset } of slabs( source ) ) {
            if ( cancelled ) return;
            const slabSec = slab.length / RATE;
            const words = await transcribeSlab( slab, offset, ( f ) => {
                post( "progress", { fraction: Math.min( ( doneSec + f * slabSec ) / duration, 0.995 ), device: loaded.device, model: loaded.model } );
            } );
            doneSec += slabSec;
            post( "words", { words } );
        }
        post( "done", { device: loaded.device, model: loaded.model } );
    } catch ( e ) {
        post( "error", { message: e.message || String( e ) } );
    }
}

self.onmessage = ( ev ) => {
    const m = ev.data;
    if ( m.type === "run" ) run( m );
    if ( m.type === "cancel" ) cancelled = true;
};
