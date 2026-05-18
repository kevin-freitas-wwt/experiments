// Tiny DOM builder. Replaces JSX in the vanilla port.
//
//   h('div', { className: 'foo', onClick: fn }, 'text', h('span', {}, 'child'))
//
// - className → element.className
// - on* attrs (onClick, onChange, onMouseDown, ...) → addEventListener('click', ...)
// - other attrs → setAttribute
// - children: strings become text nodes; arrays are flattened; null/false/undefined are skipped.
export function h( tag, attrs, ...children ) {
    const el = document.createElement( tag )
    if (attrs) {
        for (const key in attrs) {
            const value = attrs[key]
            if (value == null || value === false) continue
            if (key === 'className') {
                el.className = value
            } else if (key.startsWith('on') && typeof value === 'function') {
                el.addEventListener( key.slice(2).toLowerCase(), value )
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign( el.style, value )
            } else if (value === true) {
                el.setAttribute( key, '' )
            } else {
                el.setAttribute( key, value )
            }
        }
    }
    appendChildren( el, children )
    return el
}

function appendChildren( el, children ) {
    for (const child of children) {
        if (child == null || child === false || child === true) continue
        if (Array.isArray( child )) {
            appendChildren( el, child )
        } else if (child instanceof Node) {
            el.appendChild( child )
        } else {
            el.appendChild( document.createTextNode( String( child ) ) )
        }
    }
}

// Build an inline SVG element. Same shape as h() but uses the SVG namespace
// so that <svg>, <rect>, <polygon>, <polyline> etc. actually render.
export function svg( tag, attrs, ...children ) {
    const el = document.createElementNS( 'http://www.w3.org/2000/svg', tag )
    if (attrs) {
        for (const key in attrs) {
            const value = attrs[key]
            if (value == null || value === false) continue
            el.setAttribute( key, value )
        }
    }
    appendChildren( el, children )
    return el
}
