/* API layer — all data reads and writes go through here.
   Each function shows the real endpoint it will call once a backend exists.
   To go live: delete the stub body and uncomment the fetch() block. */

async function apiGetReadings( filters = {} ) {
    /*
    const params = new URLSearchParams();
    if ( filters.types?.length )        params.set( 'types',      filters.types.join( ',' ) );
    if ( filters.source !== 'all' )     params.set( 'source',     filters.source );
    if ( filters.dateFrom )             params.set( 'dateFrom',   filters.dateFrom );
    if ( filters.dateTo )               params.set( 'dateTo',     filters.dateTo );
    if ( filters.tempMin !== undefined ) params.set( 'tempMin',    filters.tempMin );
    if ( filters.tempMax !== undefined ) params.set( 'tempMax',    filters.tempMax );
    if ( filters.nearLat !== undefined ) params.set( 'nearLat',    filters.nearLat );
    if ( filters.nearLng !== undefined ) params.set( 'nearLng',    filters.nearLng );
    if ( filters.nearRadius )           params.set( 'nearRadius', filters.nearRadius );
    const res = await fetch( `/api/readings?${params}` );
    if ( !res.ok ) throw new Error( `GET /api/readings failed: ${res.status}` );
    return res.json();
    */
    return filterReadings( READINGS, filters );
}

async function apiAddReading( reading ) {
    /*
    const res = await fetch( '/api/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify( reading )
    });
    if ( !res.ok ) throw new Error( `POST /api/readings failed: ${res.status}` );
    return res.json();
    */
    READINGS.unshift( reading );
    return reading;
}
