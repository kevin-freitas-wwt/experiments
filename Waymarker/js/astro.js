// Sun and moon position, phase, and sunrise/sunset bearing. Algorithms adapted
// from SunCalc (Vladimir Agafonkin, BSD). Azimuths are returned as compass
// bearings (degrees from north); altitudes in degrees.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

function toDays( date ) {
    return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
}

function rightAscension( l, b ) {
    return Math.atan2( Math.sin( l ) * Math.cos( OBLIQUITY ) - Math.tan( b ) * Math.sin( OBLIQUITY ), Math.cos( l ) );
}

function declination( l, b ) {
    return Math.asin( Math.sin( b ) * Math.cos( OBLIQUITY ) + Math.cos( b ) * Math.sin( OBLIQUITY ) * Math.sin( l ) );
}

function azimuth( h, phi, dec ) {
    return Math.atan2( Math.sin( h ), Math.cos( h ) * Math.sin( phi ) - Math.tan( dec ) * Math.cos( phi ) );
}

function altitude( h, phi, dec ) {
    return Math.asin( Math.sin( phi ) * Math.sin( dec ) + Math.cos( phi ) * Math.cos( dec ) * Math.cos( h ) );
}

function siderealTime( d, lw ) {
    return RAD * ( 280.16 + 360.9856235 * d ) - lw;
}

function solarMeanAnomaly( d ) {
    return RAD * ( 357.5291 + 0.98560028 * d );
}

function eclipticLongitude( m ) {
    const c = RAD * ( 1.9148 * Math.sin( m ) + 0.02 * Math.sin( 2 * m ) + 0.0003 * Math.sin( 3 * m ) );
    return m + c + RAD * 102.9372 + Math.PI;
}

function sunCoords( d ) {
    const m = solarMeanAnomaly( d );
    const l = eclipticLongitude( m );
    return { dec: declination( l, 0 ), ra: rightAscension( l, 0 ) };
}

function moonCoords( d ) {
    const l = RAD * ( 218.316 + 13.176396 * d );
    const m = RAD * ( 134.963 + 13.064993 * d );
    const f = RAD * ( 93.272 + 13.229350 * d );
    const lng = l + RAD * 6.289 * Math.sin( m );
    const lat = RAD * 5.128 * Math.sin( f );
    return { dec: declination( lng, lat ), dist: 385001 - 20905 * Math.cos( m ), ra: rightAscension( lng, lat ) };
}

function compass( az ) {
    return ( az / RAD + 180 + 360 ) % 360;
}

export function sunPosition( date, lat, lon ) {
    const lw = RAD * -lon;
    const phi = RAD * lat;
    const d = toDays( date );
    const c = sunCoords( d );
    const h = siderealTime( d, lw ) - c.ra;
    return { altitude: altitude( h, phi, c.dec ) / RAD, azimuth: compass( azimuth( h, phi, c.dec ) ) };
}

export function moonPosition( date, lat, lon ) {
    const lw = RAD * -lon;
    const phi = RAD * lat;
    const d = toDays( date );
    const c = moonCoords( d );
    const h = siderealTime( d, lw ) - c.ra;
    return { altitude: altitude( h, phi, c.dec ) / RAD, azimuth: compass( azimuth( h, phi, c.dec ) ) };
}

// Illuminated fraction (0-1) and phase (0/1 new, 0.5 full).
export function moonIllumination( date ) {
    const d = toDays( date );
    const s = sunCoords( d );
    const m = moonCoords( d );
    const sdist = 149598000;
    const phi = Math.acos( Math.sin( s.dec ) * Math.sin( m.dec ) + Math.cos( s.dec ) * Math.cos( m.dec ) * Math.cos( s.ra - m.ra ) );
    const inc = Math.atan2( sdist * Math.sin( phi ), m.dist - sdist * Math.cos( phi ) );
    const angle = Math.atan2(
        Math.cos( s.dec ) * Math.sin( s.ra - m.ra ),
        Math.sin( s.dec ) * Math.cos( m.dec ) - Math.cos( s.dec ) * Math.sin( m.dec ) * Math.cos( s.ra - m.ra )
    );
    return { fraction: ( 1 + Math.cos( inc ) ) / 2, phase: 0.5 + 0.5 * inc * ( angle < 0 ? -1 : 1 ) / Math.PI };
}

const J0 = 0.0009;

function fromJulian( j ) {
    return new Date( ( j + 0.5 - J1970 ) * DAY_MS );
}

function julianCycle( d, lw ) {
    return Math.round( d - J0 - lw / ( 2 * Math.PI ) );
}

function approxTransit( ht, lw, n ) {
    return J0 + ( ht + lw ) / ( 2 * Math.PI ) + n;
}

function solarTransitJ( ds, m, l ) {
    return J2000 + ds + 0.0053 * Math.sin( m ) - 0.0069 * Math.sin( 2 * l );
}

function hourAngle( h, phi, dec ) {
    return Math.acos( ( Math.sin( h ) - Math.sin( phi ) * Math.sin( dec ) ) / ( Math.cos( phi ) * Math.cos( dec ) ) );
}

function getSetJ( h, lw, phi, dec, n, m, l ) {
    return solarTransitJ( approxTransit( hourAngle( h, phi, dec ), lw, n ), m, l );
}

function hoursLater( date, h ) {
    return new Date( date.valueOf() + h * DAY_MS / 24 );
}

// Sunrise / sunset times (as Date objects, device local).
export function sunTimes( date, lat, lon ) {
    const lw = RAD * -lon;
    const phi = RAD * lat;
    const d = toDays( date );
    const n = julianCycle( d, lw );
    const ds = approxTransit( 0, lw, n );
    const m = solarMeanAnomaly( ds );
    const l = eclipticLongitude( m );
    const dec = declination( l, 0 );
    const jNoon = solarTransitJ( ds, m, l );
    const jSet = getSetJ( -0.833 * RAD, lw, phi, dec, n, m, l );
    return { sunrise: fromJulian( jNoon - ( jSet - jNoon ) ), sunset: fromJulian( jSet ) };
}

// Moonrise / moonset times by scanning the day for altitude horizon crossings.
export function moonTimes( date, lat, lon ) {
    const t = new Date( date );
    t.setHours( 0, 0, 0, 0 );
    const hc = 0.133;
    let h0 = moonPosition( t, lat, lon ).altitude - hc;
    let rise = null;
    let set = null;
    for ( let i = 1; i <= 24; i += 2 ) {
        const h1 = moonPosition( hoursLater( t, i ), lat, lon ).altitude - hc;
        const h2 = moonPosition( hoursLater( t, i + 1 ), lat, lon ).altitude - hc;
        const a = ( h0 + h2 ) / 2 - h1;
        const b = ( h2 - h0 ) / 2;
        const xe = -b / ( 2 * a );
        const ye = ( a * xe + b ) * xe + h1;
        const disc = b * b - 4 * a * h1;
        let roots = 0;
        let x1 = 0;
        let x2 = 0;
        if ( disc >= 0 ) {
            const dx = Math.sqrt( disc ) / ( Math.abs( a ) * 2 );
            x1 = xe - dx;
            x2 = xe + dx;
            if ( Math.abs( x1 ) <= 1 ) {
                roots += 1;
            }
            if ( Math.abs( x2 ) <= 1 ) {
                roots += 1;
            }
            if ( x1 < -1 ) {
                x1 = x2;
            }
        }
        if ( roots === 1 ) {
            if ( h0 < 0 ) {
                rise = i + x1;
            } else {
                set = i + x1;
            }
        } else if ( roots === 2 ) {
            rise = i + ( ye < 0 ? x2 : x1 );
            set = i + ( ye < 0 ? x1 : x2 );
        }
        if ( rise !== null && set !== null ) {
            break;
        }
        h0 = h2;
    }
    return { rise: rise !== null ? hoursLater( t, rise ) : null, set: set !== null ? hoursLater( t, set ) : null };
}
