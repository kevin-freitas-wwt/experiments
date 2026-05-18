import { h } from '../lib/dom.js'
import { canvasToBlob, formatBytes } from '../lib/export.js'

export function showExportModal( canvas ) {
    let format = 'png'
    let quality = 90  // percent, JPG only
    let originalBlob = null
    let originalUrl = null
    let compressedBlob = null
    let compressedUrl = null
    let recomputeTimer = null

    // --- DOM ---

    const radioPng = h('input', { type: 'radio', name: 'em-format', value: 'png', checked: true,
        onChange: () => { if (radioPng.checked) { format = 'png'; onFormatChange() } } })
    const radioJpg = h('input', { type: 'radio', name: 'em-format', value: 'jpg',
        onChange: () => { if (radioJpg.checked) { format = 'jpg'; onFormatChange() } } })

    const qualityReadout = h('span', { className: 'em-quality-readout' }, String( quality ))
    const qualitySlider = h('input', {
        type: 'range', className: 'em-quality',
        min: '1', max: '100', step: '1', value: String( quality ),
        onInput: ( e ) => {
            quality = parseInt( e.target.value, 10 )
            qualityReadout.textContent = String( quality )
            scheduleRecompute()
        }
    })
    const qualityRow = h('div', { className: 'em-quality-row em-hidden' },
        h('span', { className: 'em-quality-label' }, 'JPG Quality'),
        qualitySlider,
        qualityReadout
    )

    const formatRow = h('div', { className: 'em-format-row' },
        h('span', { className: 'em-format-label' }, 'Format'),
        h('label', { className: 'em-radio' }, radioPng, 'PNG'),
        h('label', { className: 'em-radio' }, radioJpg, 'JPG')
    )

    const originalSizeEl   = h('span', { className: 'em-pane-size' }, '…')
    const originalImg      = h('img', { className: 'em-preview-img', alt: 'Original' })
    const compressedSizeEl = h('span', { className: 'em-pane-size' }, '…')
    const compressedImg    = h('img', { className: 'em-preview-img', alt: 'Compressed' })
    const compressedLabel  = h('span', { className: 'em-pane-label' }, 'PNG (lossless)')

    const previews = h('div', { className: 'em-previews' },
        h('div', { className: 'em-pane' },
            h('div', { className: 'em-pane-header' },
                h('span', { className: 'em-pane-label' }, 'Original (lossless)'),
                originalSizeEl
            ),
            h('div', { className: 'em-preview-frame' }, originalImg)
        ),
        h('div', { className: 'em-pane' },
            h('div', { className: 'em-pane-header' },
                compressedLabel,
                compressedSizeEl
            ),
            h('div', { className: 'em-preview-frame' }, compressedImg)
        )
    )

    const downloadBtn = h('button', { className: 'em-download-btn', disabled: true, onClick: handleDownload }, 'Download')
    const cancelBtn   = h('button', { className: 'em-cancel-btn', onClick: close }, 'Cancel')
    const closeBtn    = h('button', { className: 'em-close', title: 'Close', onClick: close }, '×')

    const modal = h('div', { className: 'em-modal' },
        h('div', { className: 'em-header' },
            h('span', { className: 'em-title' }, 'Export'),
            closeBtn
        ),
        h('div', { className: 'em-body' },
            formatRow,
            qualityRow,
            previews
        ),
        h('div', { className: 'em-footer' }, cancelBtn, downloadBtn)
    )

    const backdrop = h('div', { className: 'em-backdrop', onClick: ( e ) => {
        if (e.target === backdrop) close()
    } }, modal)

    function onKey( e ) {
        if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)

    document.body.appendChild( backdrop )

    // --- behavior ---

    async function init() {
        try {
            originalBlob = await canvasToBlob( canvas, 'image/png' )
            originalUrl = URL.createObjectURL( originalBlob )
            originalImg.src = originalUrl
            originalSizeEl.textContent = formatBytes( originalBlob.size )
        } catch (e) {
            originalSizeEl.textContent = 'error'
        }
        await recompute()
    }

    function scheduleRecompute() {
        clearTimeout( recomputeTimer )
        recomputeTimer = setTimeout( recompute, 120 )
    }

    async function recompute() {
        downloadBtn.disabled = true
        const mime = format === 'png' ? 'image/png' : 'image/jpeg'
        const q = format === 'jpg' ? quality / 100 : undefined
        try {
            const blob = await canvasToBlob( canvas, mime, q )
            compressedBlob = blob
            if (compressedUrl) URL.revokeObjectURL( compressedUrl )
            compressedUrl = URL.createObjectURL( blob )
            compressedImg.src = compressedUrl
            compressedSizeEl.textContent = formatBytes( blob.size )
            compressedLabel.textContent = format === 'png'
                ? 'PNG (lossless)'
                : `JPG, quality ${quality}`
            downloadBtn.disabled = false
        } catch (e) {
            compressedSizeEl.textContent = 'error'
        }
    }

    function onFormatChange() {
        qualityRow.classList.toggle('em-hidden', format !== 'jpg')
        recompute()
    }

    function handleDownload() {
        if (!compressedBlob) return
        const ext = format === 'png' ? 'png' : 'jpg'
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice( 0, 19 )
        const a = h('a', {
            href: compressedUrl,
            download: `pic-shop_${ts}.${ext}`
        })
        document.body.appendChild( a )
        a.click()
        a.remove()
    }

    function close() {
        document.removeEventListener('keydown', onKey)
        clearTimeout( recomputeTimer )
        if (originalUrl)   URL.revokeObjectURL( originalUrl )
        if (compressedUrl) URL.revokeObjectURL( compressedUrl )
        backdrop.remove()
    }

    init()
}
