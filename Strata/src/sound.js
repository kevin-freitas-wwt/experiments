// Procedural ambience, no files: a light breeze wherever there is air, surf near water, a hull hum and
// ticks aboard a vessel, a low pad in the deep, and nothing at all on an airless world.
export class Sound {
    constructor() {
        this.ctx = null; this.muted = false; this.level = { wind: 0, surf: 0, hull: 0, pad: 0 };
        try { this.muted = localStorage.getItem( 'strata-mute' ) === '1'; } catch {}
    }

    start() {
        if ( this.ctx ) { if ( this.ctx.state === 'suspended' ) this.ctx.resume(); return; }
        const ctx = this.ctx = new ( window.AudioContext || window.webkitAudioContext )();
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect( ctx.destination );
        const noise = ctx.createBufferSource(), len = ctx.sampleRate * 4, buf = ctx.createBuffer( 1, len, ctx.sampleRate ), d = buf.getChannelData( 0 );
        let b0 = 0, b1 = 0, b2 = 0;
        for ( let i = 0; i < len; i++ ) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[ i ] = ( b0 + b1 + b2 + w * 0.1848 ) * 0.11; }
        noise.buffer = buf; noise.loop = true; noise.start();
        // wind: pink noise through a wandering band-pass
        this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.7;
        this.windG = ctx.createGain(); this.windG.gain.value = 0;
        noise.connect( this.windF ).connect( this.windG ).connect( this.master );
        const gust = ctx.createOscillator(), gustG = ctx.createGain(); gust.frequency.value = 0.07; gustG.gain.value = 180; gust.connect( gustG ).connect( this.windF.frequency ); gust.start();
        // surf: low-passed noise swelling slowly
        this.surfF = ctx.createBiquadFilter(); this.surfF.type = 'lowpass'; this.surfF.frequency.value = 900;
        this.surfG = ctx.createGain(); this.surfG.gain.value = 0;
        const swell = ctx.createGain(); swell.gain.value = 0.5;
        const swellLfo = ctx.createOscillator(), swellD = ctx.createGain(); swellLfo.frequency.value = 0.09; swellD.gain.value = 0.45; swellLfo.connect( swellD ).connect( swell.gain ); swellLfo.start();
        noise.connect( this.surfF ).connect( swell ).connect( this.surfG ).connect( this.master );
        // rain: bright hiss
        this.rainF = ctx.createBiquadFilter(); this.rainF.type = 'highpass'; this.rainF.frequency.value = 1800;
        this.rainG = ctx.createGain(); this.rainG.gain.value = 0;
        noise.connect( this.rainF ).connect( this.rainG ).connect( this.master );
        // hull: a low hum plus ticks
        this.hullG = ctx.createGain(); this.hullG.gain.value = 0;
        const hum = ctx.createOscillator(), humF = ctx.createBiquadFilter(); hum.type = 'sawtooth'; hum.frequency.value = 55; humF.type = 'lowpass'; humF.frequency.value = 160;
        hum.connect( humF ).connect( this.hullG ).connect( this.master ); hum.start();
        this.tickG = ctx.createGain(); this.tickG.gain.value = 0; noise.connect( this.tickG ).connect( this.hullG );
        // pad: two slow detuned sines
        this.padG = ctx.createGain(); this.padG.gain.value = 0;
        for ( const f of [ 41, 41.6, 82.4 ] ) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; g.gain.value = f > 60 ? 0.25 : 0.5; o.connect( g ).connect( this.padG ); o.start(); }
        this.padG.connect( this.master );
        this.nextTick = 0;
    }

    toggleMute() {
        this.muted = ! this.muted;
        try { localStorage.setItem( 'strata-mute', this.muted ? '1' : '0' ); } catch {}
        if ( this.master ) this.master.gain.setTargetAtTime( this.muted ? 0 : 1, this.ctx.currentTime, 0.1 );
        return this.muted;
    }

    // speed m/s, height above ground m, air 0..1 (0 on airless worlds and in vacuum), water 0..1 (nearness),
    // inside (aboard a vessel), space 0..1
    update( dt, { speed, height, air, water, inside, space, rain = 0 } ) {
        if ( ! this.ctx || this.ctx.state !== 'running' ) return;
        const t = this.ctx.currentTime, ease = ( node, v, tc = 0.4 ) => node.gain.setTargetAtTime( v, t, tc );
        // A gentle breeze on any world with air; it does not rise with speed or height, so flight is quiet.
        const wind = air * 0.18 * ( inside ? 0.1 : 1 );
        this.level = { wind, surf: air * water, hull: inside ? 1 : 0, pad: Math.max( space, 1 - air ), rain: rain * air };
        ease( this.windG, wind * 0.9 );
        this.windF.frequency.setTargetAtTime( 300, t, 0.5 );
        ease( this.surfG, air * water * ( inside ? 0 : 1 ) * 0.7, 0.8 );
        ease( this.hullG, inside ? 0.35 : 0, 0.6 );
        ease( this.rainG, rain * air * ( inside ? 0.25 : 1 ) * 0.5, 1 );
        ease( this.padG, ( inside ? 0.3 : 1 ) * Math.max( space, 1 - air ) * 0.22, 1.5 );
        if ( inside && t > this.nextTick ) { this.tickG.gain.setValueAtTime( 1.5, t ); this.tickG.gain.exponentialRampToValueAtTime( 0.001, t + 0.05 ); this.nextTick = t + 2 + Math.random() * 9; }
    }
}
