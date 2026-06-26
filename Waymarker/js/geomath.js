const EARTH_RADIUS_M = 6371000;
const REFRACTION = 0.87;

export function toRad( deg ) {
    return deg * Math.PI / 180;
}

export function toDeg( rad ) {
    return rad * 180 / Math.PI;
}

export function distance( from, to ) {
    const lat1 = toRad( from.lat );
    const lat2 = toRad( to.lat );
    const dLat = toRad( to.lat - from.lat );
    const dLon = toRad( to.lon - from.lon );
    const a = Math.sin( dLat / 2 ) ** 2 + Math.cos( lat1 ) * Math.cos( lat2 ) * Math.sin( dLon / 2 ) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin( Math.min( 1, Math.sqrt( a ) ) );
}

export function bearing( from, to ) {
    const lat1 = toRad( from.lat );
    const lat2 = toRad( to.lat );
    const dLon = toRad( to.lon - from.lon );
    const y = Math.sin( dLon ) * Math.cos( lat2 );
    const x = Math.cos( lat1 ) * Math.sin( lat2 ) - Math.sin( lat1 ) * Math.cos( lat2 ) * Math.cos( dLon );
    return ( toDeg( Math.atan2( y, x ) ) + 360 ) % 360;
}

// Vertical angle from viewer to a target, correcting for Earth curvature and
// atmospheric refraction so distant peaks still sit at the right height.
export function elevationAngle( groundDist, deltaH ) {
    const drop = REFRACTION * groundDist * groundDist / ( 2 * EARTH_RADIUS_M );
    return toDeg( Math.atan2( deltaH - drop, groundDist ) );
}

// Signed shortest difference target - current, wrapped to [-180, 180].
export function angleDiff( target, current ) {
    return ( target - current + 540 ) % 360 - 180;
}
