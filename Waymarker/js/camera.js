// Live rear-camera passthrough. Streams the environment-facing camera into a
// full-screen <video> behind the canvas; the canvas goes transparent so the
// markers overlay the real view.

let stream = null;

export async function startCamera( video ) {
    stream = await navigator.mediaDevices.getUserMedia( {
        audio: false,
        video: { facingMode: { ideal: "environment" } }
    } );
    video.srcObject = stream;
    await video.play();
}

export function stopCamera( video ) {
    if ( stream ) {
        for ( const track of stream.getTracks() ) {
            track.stop();
        }
        stream = null;
    }
    video.srcObject = null;
}
