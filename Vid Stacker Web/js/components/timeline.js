import { h } from '../lib/dom.js'

export function createTimeline( container, initial ) {
    // Props (mutable via update())
    let duration    = initial.duration
    let currentTime = initial.currentTime
    let inPoint    = initial.inPoint
    let outPoint   = initial.outPoint
    const onScrub    = initial.onScrub
    const onInChange  = initial.onInChange
    const onOutChange = initial.onOutChange

    let dragTarget = null // 'playhead' | 'in' | 'out' | null

    const track = h('div', {
        className: 'tl-track',
        onMouseDown: ( e ) => handleMouseDown( e, 'playhead' ),
        onClick: ( e ) => {
            if (dragTarget) return
            onScrub( toTime( e.clientX ) )
        }
    })

    const selection = h('div', { className: 'tl-selection' })
    const handleIn = h('div', {
        className: 'tl-handle tl-handle-in',
        title: 'In point — drag to set',
        onMouseDown: ( e ) => { e.stopPropagation(); handleMouseDown( e, 'in' ) }
    })
    const handleOut = h('div', {
        className: 'tl-handle tl-handle-out',
        title: 'Out point — drag to set',
        onMouseDown: ( e ) => { e.stopPropagation(); handleMouseDown( e, 'out' ) }
    })
    const playhead = h('div', {
        className: 'tl-playhead',
        onMouseDown: ( e ) => { e.stopPropagation(); handleMouseDown( e, 'playhead' ) }
    })

    track.append( selection, handleIn, handleOut, playhead )

    const root = h('div', { className: 'tl-timeline' }, track)
    container.appendChild( root )

    paint()

    function toFraction( clientX ) {
        const rect = track.getBoundingClientRect()
        return Math.max( 0, Math.min( 1, (clientX - rect.left) / rect.width ) )
    }
    function toTime( clientX ) {
        return toFraction( clientX ) * duration
    }

    function handleMouseDown( e, target ) {
        e.preventDefault()
        dragTarget = target
        const onMove = ( ev ) => {
            const t = toTime( ev.clientX )
            if (dragTarget === 'playhead') onScrub( t )
            else if (dragTarget === 'in')  onInChange( Math.min( t, outPoint - 0.1 ) )
            else if (dragTarget === 'out') onOutChange( Math.max( t, inPoint + 0.1 ) )
        }
        const onUp = () => {
            dragTarget = null
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    function paint() {
        const inPct  = (inPoint  / duration) * 100 + '%'
        const outPct = (outPoint / duration) * 100 + '%'
        const nowPct = (currentTime / duration) * 100 + '%'
        selection.style.left  = inPct
        selection.style.width = `calc(${outPct} - ${inPct})`
        handleIn.style.left   = inPct
        handleOut.style.left  = outPct
        playhead.style.left   = nowPct
    }

    return {
        update( next ) {
            if (next.duration    !== undefined) duration    = next.duration
            if (next.currentTime !== undefined) currentTime = next.currentTime
            if (next.inPoint     !== undefined) inPoint     = next.inPoint
            if (next.outPoint    !== undefined) outPoint    = next.outPoint
            paint()
        },
        destroy() {
            root.remove()
        }
    }
}
