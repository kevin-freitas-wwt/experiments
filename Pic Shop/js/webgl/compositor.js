import { getBlendGlsl } from './blend-modes.js'

const VERT_SRC = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
    gl_Position = vec4( a_position, 0.0, 1.0 );
    v_texCoord = a_texCoord;
}
`

// Per-layer blend with an opacity uniform. u_opacity = 1 reproduces the
// Vid Stacker Stacker shader exactly. The src texture's alpha gates the
// effect at the layer's edges (where the fit-and-center quad doesn't
// cover the full canvas).
function buildFragSrc( blendGlsl ) {
    return `
precision highp float;
uniform sampler2D u_base;
uniform sampler2D u_src;
uniform float u_opacity;
varying vec2 v_texCoord;

${blendGlsl}

void main() {
    vec4 baseColor = texture2D( u_base, v_texCoord );
    vec4 srcColor  = texture2D( u_src,  v_texCoord );
    vec3 blended   = blend( baseColor.rgb, srcColor.rgb );
    float effect   = u_opacity * srcColor.a;
    vec3 result    = mix( baseColor.rgb, blended, effect );
    float outA     = baseColor.a + srcColor.a * u_opacity * (1.0 - baseColor.a);
    gl_FragColor   = vec4( result, outA );
}
`
}

function compileShader( gl, type, src ) {
    const s = gl.createShader( type )
    gl.shaderSource( s, src )
    gl.compileShader( s )
    if (!gl.getShaderParameter( s, gl.COMPILE_STATUS )) {
        throw new Error( `Shader compile error: ${gl.getShaderInfoLog( s )}` )
    }
    return s
}

function createProgram( gl, fragSrc ) {
    const v = compileShader( gl, gl.VERTEX_SHADER, VERT_SRC )
    const f = compileShader( gl, gl.FRAGMENT_SHADER, fragSrc )
    const p = gl.createProgram()
    gl.attachShader( p, v )
    gl.attachShader( p, f )
    gl.linkProgram( p )
    if (!gl.getProgramParameter( p, gl.LINK_STATUS )) {
        throw new Error( `Program link error: ${gl.getProgramInfoLog( p )}` )
    }
    gl.deleteShader( v )
    gl.deleteShader( f )
    return p
}

// Compute the [-1,1] NDC vertices of a quad that fits-and-centers an image of
// (imgW × imgH) inside a canvas of (canvasW × canvasH), preserving aspect
// ratio. Returns 16 floats: 4 vertices of (x, y, u, v).
//
// CSS Y goes top-down (y=0 is top); NDC Y goes bottom-up (y=+1 is top). The
// `ny` mapping inverts so the layer lands at the same vertical position the
// user would see in CSS terms. Per-vertex texCoord V is then assigned so the
// CSS-top vertex samples bitmap top (V=1 with UNPACK_FLIP_Y_WEBGL=true) — get
// either piece wrong individually and the layer renders upside-down.
export function fitNDC( canvasW, canvasH, imgW, imgH ) {
    const s   = Math.min( canvasW / imgW, canvasH / imgH )
    const w   = imgW * s
    const h   = imgH * s
    const px0 = (canvasW - w) / 2
    const py0 = (canvasH - h) / 2
    const nx  = ( x ) => (x / canvasW) * 2 - 1
    const ny  = ( y ) => 1 - (y / canvasH) * 2
    return new Float32Array([
        nx(px0),     ny(py0),     0, 1,   // CSS top-left    → NDC top-left,    tex (0,1) = bitmap top
        nx(px0 + w), ny(py0),     1, 1,   // CSS top-right   → NDC top-right,   tex (1,1)
        nx(px0),     ny(py0 + h), 0, 0,   // CSS bottom-left → NDC bottom-left, tex (0,0) = bitmap bottom
        nx(px0 + w), ny(py0 + h), 1, 0    // CSS bottom-right → NDC bottom-right, tex (1,0)
    ])
}

// A full-canvas quad in [-1, 1] NDC with [0,1] texCoords. Used by the
// screen-blit pass that copies the accumulator to the canvas backbuffer.
const FULL_QUAD = new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
     1,  1, 1, 1
])

export class Compositor {
    constructor( canvas, width, height ) {
        const gl = canvas.getContext('webgl', {
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true,
            antialias: false
        })
        if (!gl) throw new Error('WebGL not available')

        this.gl = gl
        this.width = width
        this.height = height
        this.programs = new Map()
        this.readFromA = true
        this.layerCount = 0

        canvas.width = width
        canvas.height = height
        gl.viewport( 0, 0, width, height )

        // Layer geometry is uploaded fresh per layer; the screen-blit reuses
        // a static full-canvas quad.
        this.layerBuf = gl.createBuffer()
        this.fullBuf  = gl.createBuffer()
        gl.bindBuffer( gl.ARRAY_BUFFER, this.fullBuf )
        gl.bufferData( gl.ARRAY_BUFFER, FULL_QUAD, gl.STATIC_DRAW )

        this.accumA = this.createTexture( width, height )
        this.accumB = this.createTexture( width, height )
        this.srcTex = this.createTexture( width, height )
        this.fb     = gl.createFramebuffer()

        this.clearAccumulator( this.accumA )
        this.clearAccumulator( this.accumB )
    }

    createTexture( w, h ) {
        const gl = this.gl
        const tex = gl.createTexture()
        gl.bindTexture( gl.TEXTURE_2D, tex )
        gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null )
        gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR )
        gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR )
        gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE )
        gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE )
        return tex
    }

    getProgram( mode ) {
        if (!this.programs.has( mode )) {
            const glsl = getBlendGlsl( mode )
            const prog = createProgram( this.gl, buildFragSrc( glsl ) )
            this.programs.set( mode, prog )
        }
        return this.programs.get( mode )
    }

    clearAccumulator( tex ) {
        const gl = this.gl
        gl.bindFramebuffer( gl.FRAMEBUFFER, this.fb )
        gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0 )
        gl.clearColor( 0, 0, 0, 0 )
        gl.clear( gl.COLOR_BUFFER_BIT )
        gl.bindFramebuffer( gl.FRAMEBUFFER, null )
    }

    bindBuffer( buf, prog ) {
        const gl = this.gl
        gl.bindBuffer( gl.ARRAY_BUFFER, buf )
        const aPos = gl.getAttribLocation( prog, 'a_position' )
        const aTex = gl.getAttribLocation( prog, 'a_texCoord' )
        gl.enableVertexAttribArray( aPos )
        gl.enableVertexAttribArray( aTex )
        gl.vertexAttribPointer( aPos, 2, gl.FLOAT, false, 16, 0 )
        gl.vertexAttribPointer( aTex, 2, gl.FLOAT, false, 16, 8 )
    }

    render( layers ) {
        const gl = this.gl

        // Fresh composite each call: clear both ping-pong accumulators.
        this.clearAccumulator( this.accumA )
        this.clearAccumulator( this.accumB )
        this.readFromA = true
        this.layerCount = 0

        // Render layers bottom-up. layers[layers.length - 1] is the bottom of
        // the composite (Photoshop convention: top-of-list = top-of-render).
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i]
            if (!layer.visible) continue
            this._composeLayer( layer )
        }

        // Always blit the latest accumulator to the canvas, even if no layers
        // were composited (so toggling all-invisible gives a clear canvas).
        const liveTex = this.readFromA ? this.accumA : this.accumB
        this._blitToCanvas( liveTex )
    }

    _composeLayer( layer ) {
        const gl = this.gl
        const mode = this.layerCount === 0 ? 'normal' : layer.blendMode

        // Upload the layer's image into srcTex. The source canvas is already
        // pre-flipped Y in lib/decode.js, so canvas row 0 = image bottom and
        // canvas row N-1 = image top. With UNPACK_FLIP_Y_WEBGL=false, this
        // means texture V=1 = image top, which lines up with the quad's V=1
        // at NDC y=+1 (display top).
        gl.bindTexture( gl.TEXTURE_2D, this.srcTex )
        gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false )
        gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.image )

        // Upload this layer's fit-and-centered quad geometry.
        const verts = fitNDC( this.width, this.height, layer.width, layer.height )
        gl.bindBuffer( gl.ARRAY_BUFFER, this.layerBuf )
        gl.bufferData( gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW )

        const readTex  = this.readFromA ? this.accumA : this.accumB
        const writeTex = this.readFromA ? this.accumB : this.accumA

        // Step 1: pass-through readTex → writeTex (full canvas) so pixels
        // OUTSIDE the layer's fit-and-centered quad retain the accumulator's
        // previous content. The blend draw in step 2 only writes inside the
        // quad, so without this the surrounding pixels would be whatever was
        // already in writeTex (stale from earlier renders).
        this._passthrough( readTex, writeTex )

        // Step 2: blend src into writeTex within the layer's quad.
        gl.bindFramebuffer( gl.FRAMEBUFFER, this.fb )
        gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, writeTex, 0 )
        gl.viewport( 0, 0, this.width, this.height )

        const prog = this.getProgram( mode )
        gl.useProgram( prog )
        gl.activeTexture( gl.TEXTURE0 )
        gl.bindTexture( gl.TEXTURE_2D, readTex )
        gl.uniform1i( gl.getUniformLocation( prog, 'u_base' ), 0 )
        gl.activeTexture( gl.TEXTURE1 )
        gl.bindTexture( gl.TEXTURE_2D, this.srcTex )
        gl.uniform1i( gl.getUniformLocation( prog, 'u_src' ), 1 )
        gl.uniform1f( gl.getUniformLocation( prog, 'u_opacity' ), layer.opacity )
        this.bindBuffer( this.layerBuf, prog )
        gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 )

        this.readFromA = !this.readFromA
        this.layerCount++
    }

    _passthrough( srcTex, dstTex ) {
        const gl = this.gl
        gl.bindFramebuffer( gl.FRAMEBUFFER, this.fb )
        gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dstTex, 0 )
        gl.viewport( 0, 0, this.width, this.height )

        const prog = this.getProgram('normal')
        gl.useProgram( prog )
        gl.activeTexture( gl.TEXTURE0 )
        gl.bindTexture( gl.TEXTURE_2D, srcTex )
        gl.uniform1i( gl.getUniformLocation( prog, 'u_base' ), 0 )
        gl.activeTexture( gl.TEXTURE1 )
        gl.bindTexture( gl.TEXTURE_2D, srcTex )
        gl.uniform1i( gl.getUniformLocation( prog, 'u_src' ), 1 )
        gl.uniform1f( gl.getUniformLocation( prog, 'u_opacity' ), 1.0 )
        this.bindBuffer( this.fullBuf, prog )
        gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 )
    }

    _blitToCanvas( tex ) {
        const gl = this.gl
        gl.bindFramebuffer( gl.FRAMEBUFFER, null )
        gl.viewport( 0, 0, this.width, this.height )
        gl.clearColor( 0, 0, 0, 0 )
        gl.clear( gl.COLOR_BUFFER_BIT )

        const prog = this.getProgram('normal')
        gl.useProgram( prog )
        gl.activeTexture( gl.TEXTURE0 )
        gl.bindTexture( gl.TEXTURE_2D, tex )
        gl.uniform1i( gl.getUniformLocation( prog, 'u_base' ), 0 )
        gl.activeTexture( gl.TEXTURE1 )
        gl.bindTexture( gl.TEXTURE_2D, tex )
        gl.uniform1i( gl.getUniformLocation( prog, 'u_src' ), 1 )
        gl.uniform1f( gl.getUniformLocation( prog, 'u_opacity' ), 1.0 )
        this.bindBuffer( this.fullBuf, prog )
        gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 )
    }

    dispose() {
        const gl = this.gl
        this.programs.forEach(( p ) => gl.deleteProgram( p ))
        gl.deleteTexture( this.accumA )
        gl.deleteTexture( this.accumB )
        gl.deleteTexture( this.srcTex )
        gl.deleteFramebuffer( this.fb )
        gl.deleteBuffer( this.layerBuf )
        gl.deleteBuffer( this.fullBuf )
    }
}
