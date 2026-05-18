// decodeImage(file) → HTMLCanvasElement (Y-flipped, EXIF-corrected)
//
// We can't rely on gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true) for ImageBitmap
// sources — Firefox in particular has historically not applied that flag for
// ImageBitmap uploads, which causes WebGL textures to come out upside-down.
// Instead we decode via createImageBitmap (to honor EXIF orientation), then
// draw to a 2D canvas with Y flipped. The resulting canvas's row 0 holds the
// IMAGE's bottom row. Uploaded to a texture without any flip, texture V=1
// (the GL "top" convention) lines up with the image's top. The Stacker /
// Compositor quads sample with V=1 at NDC y=+1 (display top), so display top
// shows image top — right-side up.
//
// Note: the returned canvas is intentionally Y-flipped data. Anything drawing
// it for *display* (e.g. UI thumbnails) needs to flip Y when drawing.
export async function decodeImage( file ) {
    const bitmap = await createImageBitmap( file, { imageOrientation: 'from-image' } )
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    ctx.translate( 0, bitmap.height )
    ctx.scale( 1, -1 )
    ctx.drawImage( bitmap, 0, 0 )
    bitmap.close()
    return canvas
}
