// Key bindings: defaults, a saved override per browser, and the Controls list that edits them.
const STORE = 'strata-keys';

export const ACTIONS = [
    { id: 'fwd', keys: [ 'KeyE', 'ArrowUp' ], text: 'walk forward' },
    { id: 'left', keys: [ 'KeyS', 'ArrowLeft' ], text: 'strafe left' },
    { id: 'back', keys: [ 'KeyD', 'ArrowDown' ], text: 'walk back' },
    { id: 'right', keys: [ 'KeyF', 'ArrowRight' ], text: 'strafe right' },
    { id: 'sprint', keys: [ 'ShiftLeft', 'ShiftRight' ], text: 'sprint' },
    { id: 'up', keys: [ 'KeyA' ], text: 'jump; rise when swimming or flying' },
    { id: 'down', keys: [ 'KeyZ' ], text: 'descend when flying; flight speed grows with clearance, so space is a minute away' },
    { id: 'fly', keys: [ 'KeyV' ], text: 'toggle flight' },
    { id: 'crumbs', keys: [ 'KeyB' ], text: 'breadcrumbs on/off' },
    { id: 'clear', keys: [ 'KeyX' ], text: 'clear the breadcrumb trail' },
    { id: 'airlock', keys: [ 'Enter' ], text: 'use an airlock: board a ship or station at its beacon, or step back out at the door' },
    { id: 'snapshot', keys: [ 'KeyP' ], text: 'save a PNG of the view, no overlays; the address bar always holds a link to where you are' },
    { id: 'stats', keys: [ 'KeyK' ], text: 'survey card with frame time, draw calls, triangles and worker queue (<code>?stats=1</code> starts with it on)' },
];

export const bind = {};
for ( const a of ACTIONS ) bind[ a.id ] = a.keys.slice();
try {
    const saved = JSON.parse( localStorage.getItem( STORE ) || '{}' );
    for ( const a of ACTIONS ) if ( typeof saved[ a.id ] === 'string' ) bind[ a.id ][ 0 ] = saved[ a.id ];
} catch {}

export const is = ( code, action ) => bind[ action ].includes( code );

export function label( code ) {
    const names = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', CapsLock: 'Caps', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`' };
    return names[ code ] || code.replace( /^Key|^Digit|^Numpad/, ( m ) => m === 'Numpad' ? 'num ' : '' );
}

function save() {
    const out = {};
    for ( const a of ACTIONS ) if ( bind[ a.id ][ 0 ] !== a.keys[ 0 ] ) out[ a.id ] = bind[ a.id ][ 0 ];
    try { Object.keys( out ).length ? localStorage.setItem( STORE, JSON.stringify( out ) ) : localStorage.removeItem( STORE ); } catch {}
}

// Builds the Controls list into `dl`; clicking a key waits for the next press. The number keys, the mouse and
// Esc are fixed, so they are listed as plain text after the editable rows.
export function buildControls( dl, fixed = [] ) {
    let waiting = null;
    const render = () => {
        dl.innerHTML = '';
        for ( const a of ACTIONS ) {
            const dt = document.createElement( 'dt' ), dd = document.createElement( 'dd' );
            const btn = document.createElement( 'button' );
            btn.type = 'button'; btn.className = 'key'; btn.textContent = label( bind[ a.id ][ 0 ] ); btn.title = 'click, then press a key';
            btn.addEventListener( 'click', ( e ) => { e.preventDefault(); waiting = a.id; btn.textContent = '…'; btn.classList.add( 'waiting' ); btn.focus(); } );
            dt.appendChild( btn );
            for ( const k of bind[ a.id ].slice( 1 ) ) { const kbd = document.createElement( 'kbd' ); kbd.textContent = label( k ); dt.appendChild( kbd ); }
            dd.innerHTML = a.text;
            dl.append( dt, dd );
        }
        for ( const [ keys, text ] of fixed ) {
            const dt = document.createElement( 'dt' ), dd = document.createElement( 'dd' );
            dt.innerHTML = keys; dd.innerHTML = text;
            dl.append( dt, dd );
        }
        const dt = document.createElement( 'dt' ), dd = document.createElement( 'dd' ), reset = document.createElement( 'button' );
        reset.type = 'button'; reset.className = 'key reset'; reset.textContent = 'reset';
        reset.addEventListener( 'click', () => { for ( const a of ACTIONS ) bind[ a.id ][ 0 ] = a.keys[ 0 ]; save(); render(); } );
        dt.appendChild( reset ); dd.textContent = 'back to the defaults; bindings are kept in this browser';
        dl.append( dt, dd );
    };
    document.addEventListener( 'keydown', ( e ) => {
        if ( ! waiting ) return;
        e.preventDefault(); e.stopPropagation();
        if ( e.code !== 'Escape' ) {
            for ( const a of ACTIONS ) if ( a.id !== waiting && bind[ a.id ][ 0 ] === e.code ) bind[ a.id ][ 0 ] = a.keys[ 0 ] === e.code ? bind[ waiting ][ 0 ] : a.keys[ 0 ];
            bind[ waiting ][ 0 ] = e.code;
            save();
        }
        waiting = null;
        render();
    }, true );
    render();
}
