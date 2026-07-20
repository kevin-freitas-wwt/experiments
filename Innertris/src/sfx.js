// Old-school arcade-style sound effects, synthesized entirely with the Web
// Audio API - no audio files, just oscillators (and one noise buffer for the
// laser-hit crack) shaped by short exponential-decay envelopes so it reads
// as chiptune blips rather than realistic foley.

const MUTE_KEY = "innertris-sfx-muted";
const VOLUME = 0.35;

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = localStorage.getItem( MUTE_KEY ) === "1";

function getCtx() {
    if ( !ctx ) {
        ctx = new ( window.AudioContext || window.webkitAudioContext )();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : VOLUME;
        master.connect( ctx.destination );
    }
    return ctx;
}

// AudioContext starts suspended until a user gesture resumes it - call this
// from the same click handler that requests pointer lock.
export function resume() {
    getCtx();
    if ( ctx.state === "suspended" ) ctx.resume();
}

export function isMuted() {
    return muted;
}

export function toggleMuted() {
    muted = !muted;
    localStorage.setItem( MUTE_KEY, muted ? "1" : "0" );
    if ( master ) master.gain.setTargetAtTime( muted ? 0 : VOLUME, getCtx().currentTime, 0.01 );
    return muted;
}

// A single oscillator with an exponential-decay envelope, optionally
// sweeping frequency from startFreq down/up to freq over its duration.
function tone( { freq, type = "square", duration = 0.08, startFreq, gain = 1, delay = 0 } ) {
    const c = getCtx();
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime( startFreq ?? freq, t0 );
    if ( startFreq !== undefined ) osc.frequency.exponentialRampToValueAtTime( Math.max( freq, 1 ), t0 + duration );
    g.gain.setValueAtTime( gain, t0 );
    g.gain.exponentialRampToValueAtTime( 0.001, t0 + duration );
    osc.connect( g );
    g.connect( master );
    osc.start( t0 );
    osc.stop( t0 + duration + 0.02 );
}

function getNoiseBuffer( c ) {
    if ( noiseBuffer ) return noiseBuffer;
    noiseBuffer = c.createBuffer( 1, c.sampleRate * 0.3, c.sampleRate );
    const data = noiseBuffer.getChannelData( 0 );
    for ( let i = 0; i < data.length; i++ ) data[ i ] = Math.random() * 2 - 1;
    return noiseBuffer;
}

function noiseBurst( { duration = 0.1, gain = 0.6, delay = 0, filterFreq = 1200 } ) {
    const c = getCtx();
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = getNoiseBuffer( c );
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime( gain, t0 );
    g.gain.exponentialRampToValueAtTime( 0.001, t0 + duration );
    src.connect( filter );
    filter.connect( g );
    g.connect( master );
    src.start( t0 );
    src.stop( t0 + duration + 0.02 );
}

export function playMove() {
    if ( muted ) return;
    tone( { freq: 220, type: "square", duration: 0.045, gain: 0.5 } );
}

// A pushed piece hitting the wall - same tick as playMove but pitched way up
// so a wall-bump reads distinctly from a normal successful shove.
export function playEdgeBump() {
    if ( muted ) return;
    tone( { freq: 440, type: "square", duration: 0.05, gain: 0.5 } );
}

export function playRotate() {
    if ( muted ) return;
    tone( { startFreq: 320, freq: 560, type: "square", duration: 0.07, gain: 0.5 } );
}

export function playLaser() {
    if ( muted ) return;
    tone( { startFreq: 1400, freq: 180, type: "sawtooth", duration: 0.12, gain: 0.35 } );
}

export function playHit() {
    if ( muted ) return;
    noiseBurst( { duration: 0.12, gain: 0.5, filterFreq: 2200 } );
    tone( { freq: 90, type: "square", duration: 0.09, gain: 0.4 } );
}

export function playLock() {
    if ( muted ) return;
    tone( { startFreq: 260, freq: 110, type: "triangle", duration: 0.09, gain: 0.55 } );
}

export function playHardDrop() {
    if ( muted ) return;
    tone( { startFreq: 300, freq: 50, type: "square", duration: 0.08, gain: 0.5 } );
}

const CLEAR_SCALE = [ 523, 659, 784, 988, 1047, 1319 ];

export function playLineClear( count ) {
    if ( muted ) return;
    const n = Math.min( count + 1, CLEAR_SCALE.length );
    const type = count >= 4 ? "square" : "triangle";
    for ( let i = 0; i < n; i++ ) {
        tone( { freq: CLEAR_SCALE[ i ], type, duration: 0.09, gain: 0.5, delay: i * 0.06 } );
    }
}

export function playLevelUp() {
    if ( muted ) return;
    [ 392, 523, 659, 784 ].forEach( ( f, i ) => tone( { freq: f, type: "square", duration: 0.11, gain: 0.5, delay: i * 0.09 } ) );
}

export function playGameOver() {
    if ( muted ) return;
    [ 392, 349, 311, 261 ].forEach( ( f, i ) => tone( { freq: f, type: "triangle", duration: 0.22, gain: 0.55, delay: i * 0.16 } ) );
}

export function playUiBlip() {
    if ( muted ) return;
    tone( { freq: 440, type: "square", duration: 0.05, gain: 0.4 } );
}
