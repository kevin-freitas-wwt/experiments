// World Magnetic Model (WMM2025, valid 2025.0-2030.0). Computes magnetic
// declination so the device's magnetic heading can be corrected to true north.
// Coefficients: NOAA/NCEI WMM2025.COF. Algorithm adapted from the Apache-2.0
// "geomagnetism" package.

const EPOCH = 2025;
const N_MAX = 12;
const G = [ 0, -29351.8, -1410.8, -2556.6, 2951.1, 1649.3, 1361, -2404.1, 1243.8, 453.6, 895, 799.5, 55.7, -281.1, 12.1, -233.2, 368.9, 187.2, -138.7, -142, 20.9, 64.4, 63.8, 76.9, -115.7, -40.9, 14.9, -60.7, 79.5, -77, -8.8, 59.3, 15.8, 2.5, -11.1, 14.2, 23.2, 10.8, -17.5, 2, -21.7, 16.9, 15, -16.8, 0.9, 4.6, 7.8, 3, -0.2, -2.5, -13.1, 2.4, 8.6, -8.7, -12.9, -1.3, -6.4, 0.2, 2, -1, -0.6, -0.9, 1.5, 0.9, -2.7, -3.9, 2.9, -1.5, -2.5, 2.4, -0.6, -0.1, -0.6, -0.1, 1.1, -1, -0.2, 2.6, -2, -0.2, 0.3, 1.2, -1.3, 0.6, 0.6, 0.5, -0.1, -0.4, -0.2, -1.3, -0.7 ];
const H = [ 0, 0, 4545.4, 0, -3133.6, -815.1, 0, -56.6, 237.5, -549.5, 0, 278.6, -133.9, 212, -375.6, 0, 45.4, 220.2, -122.9, 43, 106.1, 0, -18.4, 16.8, 48.8, -59.8, 10.9, 72.7, 0, -48.9, -14.4, -1, 23.4, -7.4, -25.1, -2.3, 0, 7.1, -12.6, 11.4, -9.7, 12.7, 0.7, -5.2, 3.9, 0, -24.8, 12.2, 8.3, -3.3, -5.2, 7.2, -0.6, 0.8, 10, 0, 3.3, 0, 2.4, 5.3, -9.1, 0.4, -4.2, -3.8, 0.9, -9.1, 0, 0, 2.9, -0.6, 0.2, 0.5, -0.3, -1.2, -1.7, -2.9, -1.8, -2.3, 0, -1.3, 0.7, 1, -1.4, 0, 0.6, -0.1, 0.8, 0.1, -1, 0.1, 0.2 ];
const DG = [ 0, 12, 9.7, -11.6, -5.2, -8, -1.3, -4.2, 0.4, -15.6, -1.6, -2.4, -6, 5.6, -7, 0.6, 1.4, 0, 0.6, 2.2, 0.9, -0.2, -0.4, 0.9, 1.2, -0.9, 0.3, 0.9, 0, -0.1, -0.1, 0.5, -0.1, -0.8, -0.8, 0.8, -0.1, 0.2, 0, 0.5, -0.1, 0.3, 0.2, 0, 0.2, 0, -0.1, 0.1, 0.3, -0.3, 0, 0.3, -0.1, 0.1, -0.1, 0.1, 0, 0.1, 0.1, 0, -0.3, 0, -0.1, -0.1, 0, 0, 0, 0, 0, 0, 0, -0.1, 0, 0, -0.1, -0.1, -0.1, -0.1, 0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, -0.1, 0, -0.1 ];
const DH = [ 0, 0, -21.5, 0, -27.7, -12.1, 0, 4, -0.3, -4.1, 0, -1.1, 4.1, 1.6, -4.4, 0, -0.5, 2.2, 0.4, 1.7, 1.9, 0, 0.3, -1.6, -0.4, 0.9, 0.7, 0.9, 0, 0.6, 0.5, -0.8, 0, -1, 0.6, -0.2, 0, -0.2, 0.5, -0.4, 0.4, -0.5, -0.6, 0.3, 0.2, 0, -0.3, 0.3, -0.3, 0.3, 0.2, -0.1, -0.2, 0.4, 0.1, 0, 0, 0, -0.2, 0.1, -0.1, 0.1, 0, -0.1, 0.2, 0, 0, 0, 0.1, 0, 0.1, 0, 0, 0.1, 0, 0, 0, 0, 0, 0, 0, -0.1, 0.1, 0, 0, 0, 0, 0, 0, 0, -0.1 ];

const A = 6378.137;
const B = 6356.7523142;
const RE = 6371.2;
const DEG = Math.PI / 180;
const EPSSQ = 1 - ( B * B ) / ( A * A );

function timedCoeffs( year ) {
    const dt = year - EPOCH;
    const g = new Array( G.length );
    const h = new Array( H.length );
    for ( let i = 0; i < G.length; i++ ) {
        g[ i ] = G[ i ] + dt * DG[ i ];
        h[ i ] = H[ i ] + dt * DH[ i ];
    }
    return { g, h };
}

function toSpherical( lat, lon, heightKm ) {
    const coslat = Math.cos( lat * DEG );
    const sinlat = Math.sin( lat * DEG );
    const rc = A / Math.sqrt( 1 - EPSSQ * sinlat * sinlat );
    const xp = ( rc + heightKm ) * coslat;
    const zp = ( rc * ( 1 - EPSSQ ) + heightKm ) * sinlat;
    const r = Math.sqrt( xp * xp + zp * zp );
    return { lambda: lon, phig: Math.asin( zp / r ) / DEG, r };
}

function legendre( phig ) {
    const x = Math.sin( DEG * phig );
    const z = Math.sqrt( ( 1 - x ) * ( 1 + x ) );
    const pcup = [ 1 ];
    const dpcup = [ 0 ];
    const norm = [ 1 ];

    for ( let n = 1; n <= N_MAX; n++ ) {
        for ( let m = 0; m <= n; m++ ) {
            const i = n * ( n + 1 ) / 2 + m;
            if ( n === m ) {
                const i1 = ( n - 1 ) * n / 2 + m - 1;
                pcup[ i ] = z * pcup[ i1 ];
                dpcup[ i ] = z * dpcup[ i1 ] + x * pcup[ i1 ];
            } else if ( n === 1 && m === 0 ) {
                pcup[ i ] = x * pcup[ 0 ];
                dpcup[ i ] = x * dpcup[ 0 ] - z * pcup[ 0 ];
            } else {
                const i1 = ( n - 2 ) * ( n - 1 ) / 2 + m;
                const i2 = ( n - 1 ) * n / 2 + m;
                if ( m > n - 2 ) {
                    pcup[ i ] = x * pcup[ i2 ];
                    dpcup[ i ] = x * dpcup[ i2 ] - z * pcup[ i2 ];
                } else {
                    const k = ( ( n - 1 ) * ( n - 1 ) - m * m ) / ( ( 2 * n - 1 ) * ( 2 * n - 3 ) );
                    pcup[ i ] = x * pcup[ i2 ] - k * pcup[ i1 ];
                    dpcup[ i ] = x * dpcup[ i2 ] - z * pcup[ i2 ] - k * dpcup[ i1 ];
                }
            }
        }
    }

    for ( let n = 1; n <= N_MAX; n++ ) {
        let i = n * ( n + 1 ) / 2;
        norm[ i ] = norm[ ( n - 1 ) * n / 2 ] * ( 2 * n - 1 ) / n;
        for ( let m = 1; m <= n; m++ ) {
            i = n * ( n + 1 ) / 2 + m;
            norm[ i ] = norm[ i - 1 ] * Math.sqrt( ( ( n - m + 1 ) * ( m === 1 ? 2 : 1 ) ) / ( n + m ) );
        }
    }

    for ( let n = 1; n <= N_MAX; n++ ) {
        for ( let m = 0; m <= n; m++ ) {
            const i = n * ( n + 1 ) / 2 + m;
            pcup[ i ] *= norm[ i ];
            dpcup[ i ] *= -norm[ i ];
        }
    }

    return { dpcup, pcup };
}

function harmonics( sph ) {
    const cosL = Math.cos( DEG * sph.lambda );
    const sinL = Math.sin( DEG * sph.lambda );
    const cosm = [ 1, cosL ];
    const sinm = [ 0, sinL ];
    const rrp = [ ( RE / sph.r ) * ( RE / sph.r ) ];

    for ( let n = 1; n <= N_MAX; n++ ) {
        rrp[ n ] = rrp[ n - 1 ] * ( RE / sph.r );
    }
    for ( let m = 2; m <= N_MAX; m++ ) {
        cosm[ m ] = cosm[ m - 1 ] * cosL - sinm[ m - 1 ] * sinL;
        sinm[ m ] = cosm[ m - 1 ] * sinL + sinm[ m - 1 ] * cosL;
    }
    return { cosm, rrp, sinm };
}

function poleBy( coeffs, harm, sph ) {
    const { g, h } = coeffs;
    const sinPhi = Math.sin( DEG * sph.phig );
    const ps = [ 1 ];
    let qn1 = 1;
    let by = 0;
    for ( let n = 1; n <= N_MAX; n++ ) {
        const i = n * ( n + 1 ) / 2 + 1;
        const qn2 = qn1 * ( 2 * n - 1 ) / n;
        const qn3 = qn2 * Math.sqrt( 2 * n / ( n + 1 ) );
        qn1 = qn2;
        if ( n === 1 ) {
            ps[ n ] = ps[ n - 1 ];
        } else {
            const k = ( ( n - 1 ) * ( n - 1 ) - 1 ) / ( ( 2 * n - 1 ) * ( 2 * n - 3 ) );
            ps[ n ] = sinPhi * ps[ n - 1 ] - k * ps[ n - 2 ];
        }
        by += harm.rrp[ n ] * ( g[ i ] * harm.sinm[ 1 ] - h[ i ] * harm.cosm[ 1 ] ) * ps[ n ] * qn3;
    }
    return by;
}

function summation( coeffs, leg, harm, sph ) {
    const { g, h } = coeffs;
    let bx = 0;
    let by = 0;
    let bz = 0;
    for ( let n = 1; n <= N_MAX; n++ ) {
        for ( let m = 0; m <= n; m++ ) {
            const i = n * ( n + 1 ) / 2 + m;
            const gh = g[ i ] * harm.cosm[ m ] + h[ i ] * harm.sinm[ m ];
            bz -= harm.rrp[ n ] * gh * ( n + 1 ) * leg.pcup[ i ];
            by += harm.rrp[ n ] * ( g[ i ] * harm.sinm[ m ] - h[ i ] * harm.cosm[ m ] ) * m * leg.pcup[ i ];
            bx -= harm.rrp[ n ] * gh * leg.dpcup[ i ];
        }
    }
    const cosPhi = Math.cos( DEG * sph.phig );
    by = Math.abs( cosPhi ) > 1e-10 ? by / cosPhi : poleBy( coeffs, harm, sph );
    return { bx, by, bz };
}

// Magnetic declination in degrees (east positive) at the given position and
// decimal year. true_heading = magnetic_heading + declination.
export function declination( lat, lon, heightKm, year ) {
    const sph = toSpherical( lat, lon, heightKm || 0 );
    const field = summation( timedCoeffs( year ), legendre( sph.phig ), harmonics( sph ), sph );
    const psi = DEG * ( sph.phig - lat );
    const bx = field.bx * Math.cos( psi ) - field.bz * Math.sin( psi );
    return Math.atan2( field.by, bx ) / DEG;
}

export function decimalYear( date ) {
    const year = date.getUTCFullYear();
    return year + ( date.valueOf() - Date.UTC( year ) ) / ( 1000 * 3600 * 24 * 365 );
}
