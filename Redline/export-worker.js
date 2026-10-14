import * as mb from "https://cdn.jsdelivr.net/npm/mediabunny@1.61.4/dist/bundles/mediabunny.min.mjs";

const post = ( type, data ) => self.postMessage( { type, ...data } );
let cancelled = false;

async function pickVideoCodec( track ) {
    const w = track.codedWidth, h = track.codedHeight;
    const prefer = [ track.codec, "hevc", "avc", "av1", "vp9" ].filter( ( c, i, a ) => c && a.indexOf( c ) === i );
    for ( const c of prefer ) {
        if ( await mb.canEncodeVideo( c, { width: w, height: h } ) ) return c;
    }
    return null;
}

async function run( { file, segments, handle } ) {
    cancelled = false;
    let output = null;
    try {
        const input = new mb.Input( { source: new mb.BlobSource( file ), formats: mb.ALL_FORMATS } );
        const vTrack = await input.getPrimaryVideoTrack();
        const aTrack = await input.getPrimaryAudioTrack();
        if ( !vTrack ) throw new Error( "No video track found." );
        if ( !( await vTrack.canDecode() ) ) throw new Error( `This browser can't decode ${ vTrack.codec } video.` );

        const codec = await pickVideoCodec( vTrack );
        if ( !codec ) throw new Error( "This browser can't encode video with WebCodecs. Try Chrome, Edge or Safari 17+." );
        const srcBitrate = ( await vTrack.getAverageBitrate() ) || ( await vTrack.getBitrate() ) || 8e6;
        const bitrate = Math.round( Math.min( srcBitrate * 1.25, 120e6 ) );

        const format = new mb.Mp4OutputFormat( { fastStart: handle ? false : "in-memory" } );
        let target, writable = null;
        if ( handle ) {
            writable = await handle.createWritable();
            target = new mb.StreamTarget( writable, { chunked: true } );
        } else {
            target = new mb.BufferTarget();
        }
        output = new mb.Output( { format, target } );

        const vSource = new mb.VideoSampleSource( { codec, bitrate, keyFrameInterval: 2 } );
        output.addVideoTrack( vSource, { rotation: vTrack.rotation } );

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
        output.setMetadataTags( await input.getMetadataTags().catch( () => ( {} ) ) );
        await output.start();

        const total = segments.reduce( ( s, [ a, b ] ) => s + ( b - a ), 0 );
        const srcDuration = await input.computeDuration();
        post( "info", { codec, audio: aMode, audioCodec: aMode === "encode" ? outCodec : aCodec, bitrate, width: vTrack.displayWidth, height: vTrack.displayHeight } );

        const vSink = new mb.VideoSampleSink( vTrack );
        const aPackets = aMode === "copy" ? new mb.EncodedPacketSink( aTrack ) : null;
        const aSink = aMode === "encode" ? new mb.AudioSampleSink( aTrack ) : null;
        const aMeta = aMode === "copy" ? { decoderConfig: await aTrack.getDecoderConfig() } : null;

        let outT = 0;
        let lastA = -Infinity;
        for ( let si = 0; si < segments.length; si++ ) {
            const [ s, e ] = segments[ si ];
            const shift = outT - s;
            let first = true;
            for await ( const sample of vSink.samples( s, e ) ) {
                if ( cancelled ) { sample.close(); throw new Error( "cancelled" ); }
                const t = Math.max( sample.timestamp, s ) + shift;
                const end = Math.min( sample.timestamp + sample.duration, e ) + shift;
                if ( end <= t ) { sample.close(); continue; }
                sample.setTimestamp( t );
                sample.setDuration( end - t );
                await vSource.add( sample, first ? { keyFrame: true } : undefined );
                sample.close();
                first = false;
                post( "progress", { fraction: Math.min( ( outT + ( sample.timestamp - s ) ) / total, 0.999 ) } );
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
                    const trimmed = trimAudio( a, s, e, shift, fadeIn, fadeOut );
                    a.close();
                    if ( trimmed ) { await aSource.add( trimmed ); trimmed.close(); }
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

const FADE = 0.008;

function trimAudio( a, s, e, shift, fadeIn, fadeOut ) {
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
    for ( let i = 0; i < len; i++ ) {
        const pos = segStart + i;
        let g = 1;
        if ( fadeIn && pos < fadeN ) g *= pos / fadeN;
        if ( fadeOut && segEnd - pos <= fadeN ) g *= Math.max( 0, segEnd - pos - 1 ) / fadeN;
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
