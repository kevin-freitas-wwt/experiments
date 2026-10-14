import * as mb from "https://cdn.jsdelivr.net/npm/mediabunny@1.61.4/dist/bundles/mediabunny.min.mjs";

const post = ( type, data, transfer ) => self.postMessage( { type, ...data }, transfer || [] );
let cancelled = false;
const FADE = 0.008;
const BLEEP_HZ = 1000;
const BLEEP_GAIN = 0.25;

async function pickVideoCodec( track ) {
    const w = track.codedWidth, h = track.codedHeight;
    const prefer = [ track.codec, "hevc", "avc", "av1", "vp9" ].filter( ( c, i, a ) => c && a.indexOf( c ) === i );
    for ( const c of prefer ) {
        if ( await mb.canEncodeVideo( c, { width: w, height: h } ) ) return c;
    }
    return null;
}

async function run( { file, segments, handle, audioOnly, bleeps = [], captions = null, capSize = "m", punch = 0 } ) {
    cancelled = false;
    let output = null;
    try {
        const input = new mb.Input( { source: new mb.BlobSource( file ), formats: mb.ALL_FORMATS } );
        const vTrack = audioOnly ? null : await input.getPrimaryVideoTrack();
        const aTrack = await input.getPrimaryAudioTrack();
        if ( !audioOnly && !vTrack ) throw new Error( "No video track found." );
        if ( audioOnly && !aTrack ) throw new Error( "No audio track found." );
        if ( vTrack && !( await vTrack.canDecode() ) ) throw new Error( `This browser can't decode ${ vTrack.codec } video.` );

        const format = new mb.Mp4OutputFormat( { fastStart: handle ? false : "in-memory" } );
        let target, writable = null;
        if ( handle ) {
            writable = await handle.createWritable();
            target = new mb.StreamTarget( writable, { chunked: true } );
        } else {
            target = new mb.BufferTarget();
        }
        output = new mb.Output( { format, target } );

        let codec = null, bitrate = 0, vSource = null, composite = false, canvas = null, ctx = null, W = 0, H = 0;
        if ( vTrack ) {
            codec = await pickVideoCodec( vTrack );
            if ( !codec ) throw new Error( "This browser can't encode video with WebCodecs. Try Chrome, Edge or Safari 17+." );
            const srcBitrate = ( await vTrack.getAverageBitrate() ) || ( await vTrack.getBitrate() ) || 8e6;
            bitrate = Math.round( Math.min( srcBitrate * 1.25, 120e6 ) );
            composite = !!( captions?.length || punch );
            W = vTrack.displayWidth; H = vTrack.displayHeight;
            vSource = new mb.VideoSampleSource( { codec, bitrate, keyFrameInterval: 2 } );
            output.addVideoTrack( vSource, composite ? {} : { rotation: vTrack.rotation } );
            if ( composite ) {
                canvas = new OffscreenCanvas( W, H );
                ctx = canvas.getContext( "2d", { alpha: false } );
            }
        }

        let aMode = "none", aSource = null, aCodec = null, outCodec = null;
        if ( aTrack && await aTrack.canDecode() ) {
            aCodec = aTrack.codec;
            const rate = aTrack.sampleRate, ch = aTrack.numberOfChannels;
            for ( const c of [ "aac", "opus" ] ) {
                if ( await mb.canEncodeAudio( c, { numberOfChannels: ch, sampleRate: rate } ) ) { outCodec = c; break; }
            }
            if ( outCodec ) {
                aMode = "encode";
                aSource = new mb.AudioSampleSource( { codec: outCodec, bitrate: Math.min( 256e3, Math.max( 128e3, ( await aTrack.getAverageBitrate() ) || 160e3 ) ) } );
            } else if ( format.getSupportedAudioCodecs().includes( aCodec ) ) {
                aMode = "copy";
                aSource = new mb.EncodedAudioPacketSource( aCodec );
            }
            if ( aSource ) output.addAudioTrack( aSource );
        }
        if ( audioOnly && aMode === "none" ) throw new Error( "This browser can't decode or re-encode the audio track." );
        output.setMetadataTags( await input.getMetadataTags().catch( () => ( {} ) ) );
        await output.start();

        const total = segments.reduce( ( s, [ a, b ] ) => s + ( b - a ), 0 );
        const srcDuration = await input.computeDuration();
        post( "info", { codec, audio: aMode, audioCodec: aMode === "encode" ? outCodec : aCodec, bitrate, width: W, height: H, composite, bleeps: bleeps.length } );

        const vSink = vTrack ? new mb.VideoSampleSink( vTrack ) : null;
        const aPackets = aMode === "copy" ? new mb.EncodedPacketSink( aTrack ) : null;
        const aSink = aMode === "encode" ? new mb.AudioSampleSink( aTrack ) : null;
        const aMeta = aMode === "copy" ? { decoderConfig: await aTrack.getDecoderConfig() } : null;
        const capFont = Math.round( H * ( capSize === "s" ? 0.036 : capSize === "l" ? 0.06 : 0.046 ) );

        let outT = 0;
        let lastA = -Infinity;
        for ( let si = 0; si < segments.length; si++ ) {
            const [ s, e ] = segments[ si ];
            const shift = outT - s;
            const zoom = punch && si % 2 === 1 ? 1 + punch : 1;
            if ( vSink ) {
                let first = true;
                for await ( const sample of vSink.samples( s, e ) ) {
                    if ( cancelled ) { sample.close(); throw new Error( "cancelled" ); }
                    const t = Math.max( sample.timestamp, s ) + shift;
                    const end = Math.min( sample.timestamp + sample.duration, e ) + shift;
                    if ( end <= t ) { sample.close(); continue; }
                    let outSample = sample;
                    if ( composite ) {
                        const dw = W * zoom, dh = H * zoom;
                        sample.draw( ctx, ( W - dw ) / 2, ( H - dh ) / 2, dw, dh );
                        if ( captions ) drawCaption( ctx, captions, t + ( end - t ) / 2, W, H, capFont );
                        outSample = new mb.VideoSample( canvas, { timestamp: t, duration: end - t } );
                        sample.close();
                    } else {
                        sample.setTimestamp( t );
                        sample.setDuration( end - t );
                    }
                    await vSource.add( outSample, first ? { keyFrame: true } : undefined );
                    outSample.close();
                    first = false;
                    post( "progress", { fraction: Math.min( ( outT + ( t - shift - s ) ) / total, 0.999 ) } );
                }
            }
            if ( aPackets ) {
                const startP = await aPackets.getPacket( s );
                const endP = await aPackets.getPacket( e );
                for await ( const p of aPackets.packets( startP || undefined, endP || undefined ) ) {
                    if ( cancelled ) throw new Error( "cancelled" );
                    if ( p.timestamp < s - 1e-4 || p.timestamp + p.duration > e + 1e-4 ) continue;
                    const t = p.timestamp + shift;
                    if ( t < lastA - 1e-6 ) continue;
                    await aSource.add( p.clone( { timestamp: t } ), aMeta );
                    lastA = t + p.duration;
                }
            } else if ( aSink ) {
                const fadeIn = si > 0 || s > 0.001;
                const fadeOut = si < segments.length - 1 || e < srcDuration - 0.001;
                for await ( const a of aSink.samples( s, e ) ) {
                    if ( cancelled ) { a.close(); throw new Error( "cancelled" ); }
                    const trimmed = trimAudio( a, s, e, shift, fadeIn, fadeOut, bleeps );
                    const at = a.timestamp;
                    a.close();
                    if ( trimmed ) { await aSource.add( trimmed ); trimmed.close(); }
                    if ( !vSink ) post( "progress", { fraction: Math.min( ( outT + ( at - s ) ) / total, 0.999 ) } );
                }
            }
            outT += e - s;
        }
        await output.finalize();
        if ( writable ) await writable.close();
        post( "done", { buffer: target.buffer || null }, target.buffer ? [ target.buffer ] : [] );
    } catch ( e ) {
        if ( output ) await output.cancel().catch( () => {} );
        post( e.message === "cancelled" ? "cancelled" : "error", { message: e.message || String( e ) } );
    }
}

const CAP_HI = "#ffd84d";

function drawCaption( ctx, cues, t, W, H, font ) {
    const cue = cues.find( ( c ) => t >= c.start && t < c.end );
    if ( !cue ) return;
    ctx.font = `600 ${ font }px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const lh = font * 1.25, padX = font * 0.5, padY = font * 0.28, space = ctx.measureText( " " ).width;
    const bottom = H - H * 0.06;
    let active = null;
    for ( const line of cue.lines ) for ( const w of line ) if ( w.start <= t ) active = w;
    for ( let k = cue.lines.length - 1, y = bottom; k >= 0; k--, y -= lh ) {
        const line = cue.lines[ k ];
        const widths = line.map( ( w ) => ctx.measureText( w.text ).width );
        const tw = widths.reduce( ( a, b ) => a + b, 0 ) + space * ( line.length - 1 );
        let x = W / 2 - tw / 2;
        ctx.fillStyle = "rgba( 0, 0, 0, 0.62 )";
        roundRect( ctx, x - padX, y - font - padY * 0.6, tw + padX * 2, lh + padY * 0.2, font * 0.22 );
        ctx.fill();
        line.forEach( ( w, i ) => {
            ctx.fillStyle = w === active ? CAP_HI : "#fff";
            ctx.fillText( w.text, x, y );
            x += widths[ i ] + space;
        } );
    }
}

function roundRect( ctx, x, y, w, h, r ) {
    ctx.beginPath();
    ctx.moveTo( x + r, y ); ctx.lineTo( x + w - r, y ); ctx.quadraticCurveTo( x + w, y, x + w, y + r );
    ctx.lineTo( x + w, y + h - r ); ctx.quadraticCurveTo( x + w, y + h, x + w - r, y + h );
    ctx.lineTo( x + r, y + h ); ctx.quadraticCurveTo( x, y + h, x, y + h - r );
    ctx.lineTo( x, y + r ); ctx.quadraticCurveTo( x, y, x + r, y );
    ctx.closePath();
}

function trimAudio( a, s, e, shift, fadeIn, fadeOut, bleeps ) {
    const rate = a.sampleRate, ch = a.numberOfChannels, n = a.numberOfFrames;
    const t0 = a.timestamp, t1 = t0 + n / rate;
    if ( t1 <= s || t0 >= e ) return null;
    const from = Math.max( 0, Math.round( ( s - t0 ) * rate ) );
    const to = Math.min( n, Math.round( ( e - t0 ) * rate ) );
    if ( to <= from ) return null;
    const len = to - from;
    const data = new Float32Array( len * ch );
    const plane = new Float32Array( n );
    for ( let c = 0; c < ch; c++ ) {
        a.copyTo( plane, { format: "f32-planar", planeIndex: c } );
        data.set( plane.subarray( from, to ), c * len );
    }
    const fadeN = Math.round( FADE * rate );
    const segStart = Math.round( ( t0 - s ) * rate ) + from;
    const segEnd = Math.round( ( e - s ) * rate );
    const local = bleeps.filter( ( [ bs, be ] ) => be > t0 && bs < t1 );
    for ( let i = 0; i < len; i++ ) {
        const pos = segStart + i;
        let g = 1;
        if ( fadeIn && pos < fadeN ) g *= pos / fadeN;
        if ( fadeOut && segEnd - pos <= fadeN ) g *= Math.max( 0, segEnd - pos - 1 ) / fadeN;
        let mix = 0;
        if ( local.length ) {
            const srcT = t0 + ( from + i ) / rate;
            for ( const [ bs, be ] of local ) {
                if ( srcT >= bs && srcT < be ) { mix = Math.min( 1, Math.min( srcT - bs, be - srcT ) / FADE ); break; }
            }
            if ( mix > 0 ) {
                const tone = Math.sin( 2 * Math.PI * BLEEP_HZ * srcT ) * BLEEP_GAIN * mix * g;
                for ( let c = 0; c < ch; c++ ) data[ c * len + i ] = data[ c * len + i ] * ( 1 - mix ) * g + tone;
                continue;
            }
        }
        if ( g !== 1 ) for ( let c = 0; c < ch; c++ ) data[ c * len + i ] *= g;
    }
    return new mb.AudioSample( {
        data, format: "f32-planar", numberOfChannels: ch, numberOfFrames: len, sampleRate: rate,
        timestamp: Math.max( t0, s ) + shift
    } );
}

self.onmessage = ( ev ) => {
    if ( ev.data.type === "run" ) run( ev.data );
    if ( ev.data.type === "cancel" ) cancelled = true;
};
