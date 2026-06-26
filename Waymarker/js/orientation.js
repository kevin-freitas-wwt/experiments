import { angleDiff, toDeg, toRad } from "./geomath.js";

const SMOOTHING = 0.2;

// World frame: east (x), north (y), up (z). The phone's camera points along the
// device -z axis, so we rotate that axis into the world frame to learn where the
// user is aiming. This is independent of screen orientation, so portrait and
// landscape both work without special-casing.
function cameraVector( alpha, beta, gamma ) {
    const a = toRad( alpha );
    const b = toRad( beta );
    const g = toRad( gamma );
    const cA = Math.cos( a );
    const sA = Math.sin( a );
    const cB = Math.cos( b );
    const sB = Math.sin( b );
    const cG = Math.cos( g );
    const sG = Math.sin( g );
    return {
        east: -( cA * sG + cG * sA * sB ),
        north: -( sA * sG - cA * cG * sB ),
        up: -( cB * cG )
    };
}

// World direction of the device's top edge, used to calibrate true north from
// iOS webkitCompassHeading (which reports the heading of that top edge).
function topVector( alpha, beta ) {
    const a = toRad( alpha );
    const b = toRad( beta );
    return {
        east: -Math.cos( b ) * Math.sin( a ),
        north: Math.cos( a ) * Math.cos( b )
    };
}

function smoothAngle( prev, next, factor ) {
    return ( prev + angleDiff( next, prev ) * factor + 360 ) % 360;
}

export async function requestSensors() {
    if ( typeof DeviceOrientationEvent !== "undefined" &&
         typeof DeviceOrientationEvent.requestPermission === "function" ) {
        try {
            const res = await DeviceOrientationEvent.requestPermission();
            return res === "granted";
        } catch ( err ) {
            return false;
        }
    }
    return true;
}

export function createOrientation() {
    const state = { hasData: false, heading: 0, pitch: 0 };
    let northOffset = 0;
    let haveOffset = false;

    function onOrientation( e ) {
        if ( e.alpha === null || e.beta === null || e.gamma === null ) {
            return;
        }
        const cam = cameraVector( e.alpha, e.beta, e.gamma );
        let heading = ( toDeg( Math.atan2( cam.east, cam.north ) ) + 360 ) % 360;
        const pitch = toDeg( Math.asin( Math.max( -1, Math.min( 1, cam.up ) ) ) );

        if ( typeof e.webkitCompassHeading === "number" && !isNaN( e.webkitCompassHeading ) ) {
            const top = topVector( e.alpha, e.beta );
            const topHeading = ( toDeg( Math.atan2( top.east, top.north ) ) + 360 ) % 360;
            const offset = angleDiff( e.webkitCompassHeading, topHeading );
            northOffset = haveOffset ? smoothAngle( northOffset, offset, SMOOTHING ) : offset;
            haveOffset = true;
        }
        heading = ( heading + northOffset + 360 ) % 360;

        state.heading = state.hasData ? smoothAngle( state.heading, heading, SMOOTHING ) : heading;
        state.pitch = state.hasData ? state.pitch + ( pitch - state.pitch ) * SMOOTHING : pitch;
        state.hasData = true;
    }

    function start() {
        window.addEventListener( "deviceorientationabsolute", onOrientation, true );
        window.addEventListener( "deviceorientation", onOrientation, true );
    }

    function stop() {
        window.removeEventListener( "deviceorientationabsolute", onOrientation, true );
        window.removeEventListener( "deviceorientation", onOrientation, true );
    }

    return { start, state, stop };
}
