const EXP = new Uint8Array( 512 ), LOG = new Uint8Array( 256 );
( () => {
    let x = 1;
    for ( let i = 0; i < 255; i++ ) {
        EXP[ i ] = x; LOG[ x ] = i;
        x <<= 1;
        if ( x & 0x100 ) x ^= 0x11d;
    }
    for ( let i = 255; i < 512; i++ ) EXP[ i ] = EXP[ i - 255 ];
} )();

const mul = ( a, b ) => ( a === 0 || b === 0 ) ? 0 : EXP[ LOG[ a ] + LOG[ b ] ];
const inv = ( a ) => EXP[ 255 - LOG[ a ] ];

function identity( k ) {
    return Array.from( { length: k }, ( _, i ) => Uint8Array.from( { length: k }, ( _, j ) => i === j ? 1 : 0 ) );
}

function invert( m ) {
    const k = m.length, a = m.map( ( r ) => Uint8Array.from( r ) ), out = identity( k );
    for ( let c = 0; c < k; c++ ) {
        let p = c;
        while ( p < k && a[ p ][ c ] === 0 ) p++;
        if ( p === k ) throw new Error( 'singular matrix' );
        [ a[ c ], a[ p ] ] = [ a[ p ], a[ c ] ];
        [ out[ c ], out[ p ] ] = [ out[ p ], out[ c ] ];
        const s = inv( a[ c ][ c ] );
        for ( let j = 0; j < k; j++ ) { a[ c ][ j ] = mul( a[ c ][ j ], s ); out[ c ][ j ] = mul( out[ c ][ j ], s ); }
        for ( let r = 0; r < k; r++ ) {
            if ( r === c || a[ r ][ c ] === 0 ) continue;
            const f = a[ r ][ c ];
            for ( let j = 0; j < k; j++ ) { a[ r ][ j ] ^= mul( f, a[ c ][ j ] ); out[ r ][ j ] ^= mul( f, out[ c ][ j ] ); }
        }
    }
    return out;
}

function multiply( a, b ) {
    const rows = a.length, cols = b[ 0 ].length, inner = b.length;
    return Array.from( { length: rows }, ( _, i ) => {
        const r = new Uint8Array( cols );
        for ( let j = 0; j < cols; j++ ) {
            let s = 0;
            for ( let t = 0; t < inner; t++ ) s ^= mul( a[ i ][ t ], b[ t ][ j ] );
            r[ j ] = s;
        }
        return r;
    } );
}

export function generator( k, n ) {
    const vand = Array.from( { length: n }, ( _, i ) => {
        const r = new Uint8Array( k );
        let x = 1;
        for ( let j = 0; j < k; j++ ) { r[ j ] = x; x = mul( x, i ); }
        return r;
    } );
    return multiply( vand, invert( vand.slice( 0, k ) ) );
}

function apply( rows, inputs, size ) {
    return rows.map( ( row ) => {
        const out = new Uint8Array( size );
        for ( let c = 0; c < inputs.length; c++ ) {
            const f = row[ c ];
            if ( f === 0 ) continue;
            const src = inputs[ c ];
            if ( f === 1 ) { for ( let i = 0; i < size; i++ ) out[ i ] ^= src[ i ]; continue; }
            const lf = LOG[ f ];
            for ( let i = 0; i < size; i++ ) { const v = src[ i ]; if ( v ) out[ i ] ^= EXP[ lf + LOG[ v ] ]; }
        }
        return out;
    } );
}

export function encode( bytes, k, n ) {
    const size = Math.ceil( bytes.length / k ) || 1;
    const data = Array.from( { length: k }, ( _, i ) => {
        const s = new Uint8Array( size );
        s.set( bytes.subarray( i * size, ( i + 1 ) * size ) );
        return s;
    } );
    const g = generator( k, n );
    return data.concat( apply( g.slice( k ), data, size ) );
}

export function decode( shards, k, n, length ) {
    const have = [];
    for ( let i = 0; i < n && have.length < k; i++ ) if ( shards[ i ] ) have.push( i );
    if ( have.length < k ) throw new Error( `need ${k} shards, have ${have.length}` );
    const g = generator( k, n );
    const sub = invert( have.map( ( i ) => g[ i ] ) );
    const size = shards[ have[ 0 ] ].length;
    const data = apply( sub, have.map( ( i ) => shards[ i ] ), size );
    const out = new Uint8Array( length );
    for ( let i = 0; i < k && i * size < length; i++ ) out.set( data[ i ].subarray( 0, Math.min( size, length - i * size ) ), i * size );
    return out;
}

export function rebuild( shards, k, n, index ) {
    const have = [];
    for ( let i = 0; i < n && have.length < k; i++ ) if ( shards[ i ] ) have.push( i );
    if ( have.length < k ) throw new Error( `need ${k} shards, have ${have.length}` );
    const g = generator( k, n );
    const sub = invert( have.map( ( i ) => g[ i ] ) );
    const size = shards[ have[ 0 ] ].length;
    const data = apply( sub, have.map( ( i ) => shards[ i ] ), size );
    return apply( [ g[ index ] ], data, size )[ 0 ];
}
