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

        let aMode = "none", aSource = null, aCodec = null;
        if ( aTrack && await aTrack.canDecode() ) {
            aCodec = aTrack.codec;
            const canCopy = aCodec && format.getSupportedAudioCodecs().includes( aCodec );
            if ( canCopy ) {
                aMode = "copy";
                aSource = new mb.EncodedAudioPacketSource( aCodec );
            } else if ( await mb.canEncodeAudio( "aac" ) ) {
                aMode = "encode";
                aSource = new mb.AudioSampleSource( { codec: "aac", bitrate: 192e3 } );
            }
            if ( aSource ) output.addAudioTrack( aSource );
        }
        output.setMetadataTags( await input.getMetadataTags().catch( () => ( {} ) ) );
        await output.start();

        const total = segments.reduce( ( s, [ a, b ] ) => s + ( b - a ), 0 );
        post( "info", { codec, audio: aMode, audioCodec: aCodec, bitrate, width: vTrack.displayWidth, height: vTrack.displayHeight } );

        const vSink = new mb.VideoSampleSink( vTrack );
        const aPackets = aMode === "copy" ? new mb.EncodedPacketSink( aTrack ) : null;
        const aSink = aMode === "encode" ? new mb.AudioSampleSink( aTrack ) : null;
        const aMeta = aMode === "copy" ? { decoderConfig: await aTrack.getDecoderConfig() } : null;

        let outT = 0;
        let lastA = -Infinity;
        for ( const [ s, e ] of segments ) {
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
                for await ( const a of aSink.samples( s, e ) ) {
                    if ( cancelled ) { a.close(); throw new Error( "cancelled" ); }
                    if ( a.timestamp < s - 1e-4 || a.timestamp + a.duration > e + 1e-4 ) { a.close(); continue; }
                    a.setTimestamp( a.timestamp + shift );
                    await aSource.add( a );
                    a.close();
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

self.onmessage = ( ev ) => {
    if ( ev.data.type === "run" ) run( ev.data );
    if ( ev.data.type === "cancel" ) cancelled = true;
};
