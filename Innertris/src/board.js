export class Board {
    constructor( cols, rows ) {
        this.cols = cols;
        this.rows = rows;
        this.cells = emptyGrid( cols, rows );
    }

    inBounds( x, y ) {
        return x >= 0 && x < this.cols && y < this.rows;
    }

    canPlace( cellCoords ) {
        return cellCoords.every( ( [ x, y ] ) => {
            if ( !this.inBounds( x, y ) ) return false;
            return y < 0 || this.cells[ y ][ x ] === null;
        } );
    }

    lock( cellCoords, colorKey ) {
        cellCoords.forEach( ( [ x, y ] ) => {
            if ( y >= 0 ) this.cells[ y ][ x ] = colorKey;
        } );
    }

    unlock( cellCoords ) {
        cellCoords.forEach( ( [ x, y ] ) => {
            if ( y >= 0 ) this.cells[ y ][ x ] = null;
        } );
    }

    findFullRows() {
        const full = [];
        for ( let y = 0; y < this.rows; y++ ) {
            if ( this.cells[ y ].every( ( c ) => c !== null ) ) full.push( y );
        }
        return full;
    }

    clearRows( rows ) {
        const sorted = [ ...rows ].sort( ( a, b ) => a - b );
        // Remove all full rows first (the "row - i" offset only accounts for
        // rows already removed). Only once every removal is done do we pad
        // the top back out to full height - interleaving the two per row
        // throws off the offset for every row after the first.
        sorted.forEach( ( row, i ) => this.cells.splice( row - i, 1 ) );
        for ( let i = 0; i < sorted.length; i++ ) this.cells.unshift( new Array( this.cols ).fill( null ) );
        return sorted.length;
    }

    reset() {
        this.cells = emptyGrid( this.cols, this.rows );
    }
}

function emptyGrid( cols, rows ) {
    return Array.from( { length: rows }, () => new Array( cols ).fill( null ) );
}

// Applies the same remove-and-shift used by Board.clearRows to a parallel
// grid (e.g. one holding mesh references instead of color keys), so visuals
// stay in sync with the logical board.
export function shiftGridRows( grid, cols, rows ) {
    const sorted = [ ...rows ].sort( ( a, b ) => a - b );
    sorted.forEach( ( row, i ) => grid.splice( row - i, 1 ) );
    for ( let i = 0; i < sorted.length; i++ ) grid.unshift( new Array( cols ).fill( null ) );
}
