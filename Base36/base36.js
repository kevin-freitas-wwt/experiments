/*
 * base36.js — encode and decode numbers using 0-9 and A-Z (base 36).
 * Works on Number, BigInt and numeric strings. No dependencies.
 *
 *   <script src="base36.js"></script>
 *   Base36.encode( 1295 )        // "ZZ"
 *   Base36.decode( "HELLO" )     // 29234652
 *   Base36.encode( 3.75 )        // "3.R"
 *   Base36.decodeBig( "ZZZZZZZZZZZZZZ" )  // 6140942214464815497215n
 */
( function( root, factory ) {
    if ( typeof module === "object" && module.exports ) {
        module.exports = factory();
    } else {
        root.Base36 = factory();
    }
}( typeof self !== "undefined" ? self : this, function() {
    const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const BASE = 36;
    const BIG_BASE = 36n;
    const VALID = /^[+-]?[0-9a-z]+(\.[0-9a-z]+)?$/i;
    const VALUES = {};

    for ( let i = 0; i < ALPHABET.length; i++ ) {
        VALUES[ ALPHABET[ i ] ] = i;
        VALUES[ ALPHABET[ i ].toLowerCase() ] = i;
    }

    function glyphOf( value ) {
        if ( !Number.isInteger( value ) || value < 0 || value >= BASE ) {
            throw new RangeError( "Digit value must be an integer 0-35" );
        }
        return ALPHABET[ value ];
    }

    function valueOf( glyph ) {
        const v = VALUES[ glyph ];
        if ( v === undefined ) throw new RangeError( "Not a base 36 glyph: " + glyph );
        return v;
    }

    function isValid( text ) {
        return typeof text === "string" && VALID.test( text.trim() );
    }

    function split( text ) {
        const t = String( text ).trim();
        if ( !VALID.test( t ) ) throw new SyntaxError( "Not a base 36 number: " + text );
        const negative = t[ 0 ] === "-";
        const body = t.replace( /^[+-]/, "" ).toUpperCase();
        const [ whole, fraction = "" ] = body.split( "." );
        return { negative, whole, fraction };
    }

    function encodeBig( big ) {
        const negative = big < 0n;
        let n = negative ? -big : big;
        let out = "";
        do {
            out = ALPHABET[ Number( n % BIG_BASE ) ] + out;
            n /= BIG_BASE;
        } while ( n > 0n );
        return ( negative ? "-" : "" ) + out;
    }

    function encodeFraction( frac, places ) {
        let out = "";
        for ( let i = 0; i < places && frac > 0; i++ ) {
            frac *= BASE;
            const d = Math.floor( frac + 1e-9 );
            out += ALPHABET[ d ];
            frac -= d;
        }
        return out.replace( /0+$/, "" );
    }

    function encode( value, places = 8 ) {
        if ( typeof value === "bigint" ) return encodeBig( value );
        if ( typeof value === "string" ) {
            const s = value.trim();
            if ( /^[+-]?\d+$/.test( s ) ) return encodeBig( BigInt( s ) );
            value = Number( s );
        }
        if ( typeof value !== "number" || !Number.isFinite( value ) ) {
            throw new TypeError( "Cannot encode " + value );
        }
        const negative = value < 0;
        const abs = Math.abs( value );
        const whole = Math.trunc( abs );
        const text = encodeBig( BigInt( whole ) );
        const frac = encodeFraction( abs - whole, places );
        return ( negative ? "-" : "" ) + text + ( frac ? "." + frac : "" );
    }

    function decodeBig( text ) {
        const { negative, whole, fraction } = split( text );
        if ( fraction ) throw new RangeError( "decodeBig only accepts whole numbers" );
        let n = 0n;
        for ( const g of whole ) n = n * BIG_BASE + BigInt( VALUES[ g ] );
        return negative ? -n : n;
    }

    function decode( text ) {
        const { negative, whole, fraction } = split( text );
        let n = 0;
        for ( const g of whole ) n = n * BASE + VALUES[ g ];
        let weight = 1;
        for ( const g of fraction ) {
            weight /= BASE;
            n += VALUES[ g ] * weight;
        }
        return negative ? -n : n;
    }

    function places( text ) {
        const { whole, fraction } = split( text );
        const out = [];
        for ( let i = 0; i < whole.length; i++ ) {
            const exponent = whole.length - 1 - i;
            const weight = BIG_BASE ** BigInt( exponent );
            const value = VALUES[ whole[ i ] ];
            out.push( { glyph: whole[ i ], value, exponent, weight, product: weight * BigInt( value ) } );
        }
        for ( let i = 0; i < fraction.length; i++ ) {
            const exponent = -( i + 1 );
            const weight = BASE ** exponent;
            const value = VALUES[ fraction[ i ] ];
            out.push( { glyph: fraction[ i ], value, exponent, weight, product: weight * value } );
        }
        return out;
    }

    function normalize( text ) {
        const { negative, whole, fraction } = split( text );
        const w = whole.replace( /^0+(?=.)/, "" );
        const f = fraction.replace( /0+$/, "" );
        return ( negative && ( w !== "0" || f ) ? "-" : "" ) + w + ( f ? "." + f : "" );
    }

    return { ALPHABET, BASE, encode, decode, decodeBig, places, normalize, isValid, glyphOf, valueOf };
} ) );
