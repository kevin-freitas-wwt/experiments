export class Pool {
    constructor() {
        this.queue = [];
        const n = Math.max( 1, Math.min( 4, ( navigator.hardwareConcurrency || 4 ) - 1 ) );
        this.workers = Array.from( { length: n }, () => {
            const w = new Worker( new URL( './worker.js', import.meta.url ), { type: 'module' } );
            w.job = null;
            w.onmessage = ( { data } ) => {
                const job = w.job;
                w.job = null;
                job.resolve( data );
                this.pump();
            };
            return w;
        } );
    }

    submit( payload, { priority = 0, tag = '' } = {} ) {
        return new Promise( ( resolve ) => {
            this.queue.push( { payload, priority, tag, resolve } );
            this.pump();
        } );
    }

    cancel( tag, keep = () => false ) {
        this.queue = this.queue.filter( ( j ) => j.tag !== tag || keep( j.payload ) );
    }

    pump() {
        for ( const w of this.workers ) {
            if ( w.job || ! this.queue.length ) continue;
            let best = 0;
            for ( let i = 1; i < this.queue.length; i++ ) if ( this.queue[ i ].priority < this.queue[ best ].priority ) best = i;
            const job = this.queue.splice( best, 1 )[ 0 ];
            w.job = job;
            w.postMessage( job.payload );
        }
    }

    get pending() {
        return this.queue.length + this.workers.filter( ( w ) => w.job ).length;
    }
}
