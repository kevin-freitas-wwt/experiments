export function createGeo() {
    const state = { altitude: 0, error: null, hasFix: false, lat: null, lon: null };
    let watchId = null;

    function start() {
        if ( watchId !== null || !( "geolocation" in navigator ) ) {
            return;
        }
        watchId = navigator.geolocation.watchPosition( onPosition, onError, {
            enableHighAccuracy: true,
            maximumAge: 5000,
            timeout: 20000
        } );
    }

    function onPosition( pos ) {
        state.lat = pos.coords.latitude;
        state.lon = pos.coords.longitude;
        if ( pos.coords.altitude !== null ) {
            state.altitude = pos.coords.altitude;
        }
        state.error = null;
        state.hasFix = true;
    }

    function onError( err ) {
        state.error = err.message;
    }

    function stop() {
        if ( watchId !== null ) {
            navigator.geolocation.clearWatch( watchId );
            watchId = null;
        }
    }

    return { start, state, stop };
}
