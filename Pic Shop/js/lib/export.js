export function canvasToBlob( canvas, mime = 'image/png', quality ) {
    return new Promise(( resolve, reject ) => {
        canvas.toBlob(( blob ) => {
            if (blob) resolve( blob )
            else reject( new Error(`canvas.toBlob returned null for ${mime}`) )
        }, mime, quality)
    })
}

export function formatBytes( bytes ) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed( bytes < 10 * 1024 ? 1 : 0 )} KB`
    return `${(bytes / (1024 * 1024)).toFixed( 1 )} MB`
}
