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

function buildFragSrc( blendGlsl ) {
    return `
precision highp float;
uniform sampler2D u_base;
uniform sampler2D u_src;
varying vec2 v_texCoord;

${blendGlsl}

void main() {
    vec4 baseColor = texture2D( u_base, v_texCoord );
    vec4 srcColor  = texture2D( u_src,  v_texCoord );
    vec3 blended   = blend( baseColor.rgb, srcColor.rgb );
    gl_FragColor   = vec4( blended, 1.0 );
}
`
}

function compileShader( gl, type, src ) {
    const shader = gl.createShader( type )
    gl.shaderSource( shader, src )
    gl.compileShader( shader )
    if (!gl.getShaderParameter( shader, gl.COMPILE_STATUS )) {
        throw new Error( `Shader compile error: ${gl.getShaderInfoLog( shader )}` )
    }
    return shader
}

function createProgram( gl, fragSrc ) {
    const vert = compileShader( gl, gl.VERTEX_SHADER, VERT_SRC )
    const frag = compileShader( gl, gl.FRAGMENT_SHADER, fragSrc )
    const prog = gl.createProgram()
    gl.attachShader( prog, vert )
    gl.attachShader( prog, frag )
    gl.linkProgram( prog )
    if (!gl.getProgramParameter( prog, gl.LINK_STATUS )) {
        throw new Error( `Program link error: ${gl.getProgramInfoLog( prog )}` )
    }
    gl.deleteShader( vert )
    gl.deleteShader( frag )
    return prog
}

// texCoords are NOT flipped here. We rely on UNPACK_FLIP_Y_WEBGL when uploading
// HTMLImageElement / VideoFrame so every texture (uploaded frame + ping-pong
// FBO targets) ends up sharing the same Y orientation. Flipping in the
// texCoords instead would double-flip on FBO→FBO sampling and produce mirrored
// frames in the stack.
const QUAD_VERTS = new Float32Array([
    -1, -1,  0, 0,
     1, -1,  1, 0,
    -1,  1,  0, 1,
     1,  1,  1, 1
])

export class Stacker {
    constructor( canvas, width, height ) {
        const gl = canvas.getContext('webgl', {
            alpha: false,
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
        this.frameCount = 0
        this.currentBlendMode = 'lighten'

        canvas.width = width
        canvas.height = height
        gl.viewport( 0, 0, width, height )

        this.quadBuf = gl.createBuffer()
        gl.bindBuffer( gl.ARRAY_BUFFER, this.quadBuf )
        gl.bufferData( gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW )

        this.accumA = this.createTexture( width, height )
        this.accumB = this.createTexture( width, height )
        this.srcTex = this.createTexture( width, height )
        this.snapshotTex = this.createTexture( width, height )
        this.snapshotFrameCount = -1
        this.fb     = gl.createFramebuffer()

        this.clearAccumulator( this.accumA )
        this.clearAccumulator( this.accumB )
    }

    setBlendMode( mode ) {
        this.currentBlendMode = mode
    }

    getProgram( mode ) {
        if (!this.programs.has( mode )) {
            const glsl = getBlendGlsl( mode )
            const prog = createProgram( this.gl, buildFragSrc( glsl ) )
            this.programs.set( mode, prog )
        }
        return this.programs.get( mode )
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

    uploadImageToTexture( tex, img ) {
        const gl = this.gl
        gl.bindTexture( gl.TEXTURE_2D, tex )
        // VideoFrame is delivered top-down in browser memory; flip on upload so
        // GL's Y=0=bottom convention sees the image right-side up.
        gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, true )
        gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img )
    }

    clearAccumulator( tex ) {
        const gl = this.gl
        gl.bindFramebuffer( gl.FRAMEBUFFER, this.fb )
        gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0 )
        gl.clearColor( 0, 0, 0, 1 )
        gl.clear( gl.COLOR_BUFFER_BIT )
        gl.bindFramebuffer( gl.FRAMEBUFFER, null )
    }

    bindQuad( prog ) {
        const gl = this.gl
        gl.bindBuffer( gl.ARRAY_BUFFER, this.quadBuf )
        const aPos = gl.getAttribLocation( prog, 'a_position' )
        const aTex = gl.getAttribLocation( prog, 'a_texCoord' )
        gl.enableVertexAttribArray( aPos )
        gl.enableVertexAttribArray( aTex )
        gl.vertexAttribPointer( aPos, 2, gl.FLOAT, false, 16, 0 )
        gl.vertexAttribPointer( aTex, 2, gl.FLOAT, false, 16, 8 )
    }

    reset() {
        this.frameCount = 0
        this.readFromA = true
        this.snapshotFrameCount = -1
        this.clearAccumulator( this.accumA )
        this.clearAccumulator( this.accumB )
    }

    // Save the current live accumulator into snapshotTex so restoreSnapshot()
    // can roll back to this exact state later. Uses gl.copyTexSubImage2D so
    // the copy is GPU-local — no readPixels round trip.
    snapshot() {
        const gl = this.gl
        // After the most recent addFrame's ping-pong flip, the live (latest)
        // accumulator is the one readFromA now points to as the next "read".
        const liveTex = this.readFromA ? this.accumA : this.accumB
        gl.bindFramebuffer( gl.FRAMEBUFFER, this.fb )
        gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, liveTex, 0 )
        gl.bindTexture( gl.TEXTURE_2D, this.snapshotTex )
        gl.copyTexSubImage2D( gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height )
        gl.bindFramebuffer( gl.FRAMEBUFFER, null )
        this.snapshotFrameCount = this.frameCount
    }

    hasSnapshot() {
        return this.snapshotFrameCount >= 0
    }

    restoreSnapshot() {
        if (!this.hasSnapshot()) return
        const gl = this.gl
        const liveTex = this.readFromA ? this.accumA : this.accumB
        gl.bindFramebuffer( gl.FRAMEBUFFER, this.fb )
        gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.snapshotTex, 0 )
        gl.bindTexture( gl.TEXTURE_2D, liveTex )
        gl.copyTexSubImage2D( gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height )
        gl.bindFramebuffer( gl.FRAMEBUFFER, null )
        this.frameCount = this.snapshotFrameCount
        this._blitToCanvas( liveTex )
    }

    // Blit a given accumulator texture onto the default framebuffer (canvas
    // backbuffer) using the pass-through 'normal' shader. Reused by both
    // addFrame() and restoreSnapshot().
    _blitToCanvas( tex ) {
        const gl = this.gl
        gl.bindFramebuffer( gl.FRAMEBUFFER, null )
        gl.viewport( 0, 0, this.width, this.height )

        const copyProg = this.getProgram('normal')
        gl.useProgram( copyProg )

        gl.activeTexture( gl.TEXTURE0 )
        gl.bindTexture( gl.TEXTURE_2D, tex )
        gl.uniform1i( gl.getUniformLocation( copyProg, 'u_base' ), 0 )
        gl.activeTexture( gl.TEXTURE1 )
        gl.bindTexture( gl.TEXTURE_2D, tex )
        gl.uniform1i( gl.getUniformLocation( copyProg, 'u_src' ), 1 )

        this.bindQuad( copyProg )
        gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 )
    }

    addFrame( img ) {
        const gl = this.gl
        const mode = this.frameCount === 0 ? 'normal' : this.currentBlendMode

        this.uploadImageToTexture( this.srcTex, img )

        const readTex  = this.readFromA ? this.accumA : this.accumB
        const writeTex = this.readFromA ? this.accumB : this.accumA

        const prog = this.getProgram( mode )
        gl.useProgram( prog )

        gl.activeTexture( gl.TEXTURE0 )
        gl.bindTexture( gl.TEXTURE_2D, readTex )
        gl.uniform1i( gl.getUniformLocation( prog, 'u_base' ), 0 )

        gl.activeTexture( gl.TEXTURE1 )
        gl.bindTexture( gl.TEXTURE_2D, this.srcTex )
        gl.uniform1i( gl.getUniformLocation( prog, 'u_src' ), 1 )

        this.bindQuad( prog )

        // Blend readTex + srcTex → writeTex (writeTex is never sampled here)
        gl.bindFramebuffer( gl.FRAMEBUFFER, this.fb )
        gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, writeTex, 0 )
        gl.viewport( 0, 0, this.width, this.height )
        gl.drawArrays( gl.TRIANGLE_STRIP, 0, 4 )

        // Blit writeTex to the default framebuffer (canvas backbuffer).
        // Default framebuffer is not the same surface as writeTex, so no
        // feedback loop.
        this._blitToCanvas( writeTex )

        this.readFromA = !this.readFromA
        this.frameCount++
    }

    dispose() {
        const gl = this.gl
        this.programs.forEach(( p ) => gl.deleteProgram( p ))
        gl.deleteTexture( this.accumA )
        gl.deleteTexture( this.accumB )
        gl.deleteTexture( this.srcTex )
        gl.deleteTexture( this.snapshotTex )
        gl.deleteFramebuffer( this.fb )
        gl.deleteBuffer( this.quadBuf )
    }
}
