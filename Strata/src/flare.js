import * as THREE from 'three';

// Screen-space lens flare, ported from the Cosmos experiment: a glow core at the star, a horizontal
// streak, and discs and rings strung along the line through the screen centre.
const MAXF = 4, ELEMS = 8, SAMPLES = [ [ 0, 0 ], [ 1, 0 ], [ -1, 0 ], [ 0, 1 ], [ 0, -1 ] ];
const PARAMS = [
    [ 0.0, 0.55, 0.55, 0 ], [ 0.0, 1.9, 0.05, 1 ], [ 0.45, 0.05, 0.05, 2 ], [ 0.75, 0.11, 0.11, 2 ],
    [ 1.05, 0.045, 0.045, 0 ], [ 1.35, 0.17, 0.17, 3 ], [ 1.65, 0.08, 0.08, 2 ], [ 1.95, 0.28, 0.28, 3 ],
];
const COLORS = [
    [ 1.0, 1.0, 1.0, 1.1 ], [ 0.5, 0.65, 1.0, 0.9 ], [ 0.55, 0.75, 1.0, 0.3 ], [ 1.0, 0.62, 0.4, 0.22 ],
    [ 1.0, 1.0, 1.0, 0.25 ], [ 0.6, 0.85, 1.0, 0.28 ], [ 0.85, 0.55, 1.0, 0.22 ], [ 1.0, 0.75, 0.5, 0.18 ],
];

export class Flares {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
        const n = MAXF * ELEMS;
        const geo = new THREE.InstancedBufferGeometry().copy( new THREE.PlaneGeometry( 2, 2 ) );
        geo.instanceCount = n;
        const inst = new Float32Array( n ), params = new Float32Array( n * 4 ), cols = new Float32Array( n * 4 );
        for ( let i = 0; i < n; i++ ) { inst[ i ] = i; params.set( PARAMS[ i % ELEMS ], i * 4 ); cols.set( COLORS[ i % ELEMS ], i * 4 ); }
        geo.setAttribute( 'inst', new THREE.InstancedBufferAttribute( inst, 1 ) );
        geo.setAttribute( 'elem', new THREE.InstancedBufferAttribute( params, 4 ) );
        geo.setAttribute( 'ecol', new THREE.InstancedBufferAttribute( cols, 4 ) );
        this.uniforms = { aspect: { value: 1 }, flares: { value: Array.from( { length: MAXF }, () => new THREE.Vector4() ) }, fcolor: { value: Array.from( { length: MAXF }, () => new THREE.Vector3( 1, 1, 1 ) ) } };
        const mat = new THREE.ShaderMaterial( {
            transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
            uniforms: this.uniforms,
            vertexShader: `attribute float inst; attribute vec4 elem; attribute vec4 ecol;
uniform float aspect; uniform vec4 flares[ ${MAXF} ]; uniform vec3 fcolor[ ${MAXF} ];
varying vec2 vUv; varying vec4 vColor; varying float vType;
void main() {
    int fi = int( inst ) / ${ELEMS}; int ei = int( inst ) - fi * ${ELEMS};
    vec4 fd = flares[ fi ];
    float strength = clamp( fd.z, 0.0, 1.0 );
    float scale = mix( 0.35, 1.3, strength );
    vec2 center = fd.xy * ( 1.0 - elem.x );
    vec2 c = position.xy;
    vec2 off = vec2( c.x * elem.y * scale / aspect, c.y * elem.z * scale );
    vUv = c;
    vec3 rgb = ei == 0 ? fcolor[ fi ] : ecol.rgb;
    float a = ecol.a * strength * strength;
    if ( ei == 1 ) a *= smoothstep( 0.15, 0.5, strength );
    if ( ei >= 2 ) a *= smoothstep( 0.35, 0.75, strength );
    vColor = vec4( rgb, a );
    vType = elem.w;
    gl_Position = vec4( center + off, 0.0, 1.0 );
}`,
            fragmentShader: `varying vec2 vUv; varying vec4 vColor; varying float vType;
void main() {
    float r = length( vUv );
    float f;
    if ( vType < 0.5 ) f = pow( max( 1.0 - r, 0.0 ), 2.4 ) * 1.4 + exp( -r * 8.0 ) * 0.6;
    else if ( vType < 1.5 ) f = exp( -abs( vUv.y ) * 5.0 ) * pow( max( 1.0 - abs( vUv.x ), 0.0 ), 1.6 );
    else if ( vType < 2.5 ) f = smoothstep( 1.0, 0.7, r ) * 0.7;
    else f = smoothstep( 0.12, 0.02, abs( r - 0.72 ) ) * 0.6;
    gl_FragColor = vec4( vColor.rgb * f * vColor.a, 1.0 );
}`,
        } );
        this.mesh = new THREE.Mesh( geo, mat );
        this.mesh.frustumCulled = false;
        this.scene.add( this.mesh );
        this.slots = Array.from( { length: MAXF }, () => ( { s: 0 } ) );
        this.probes = null;
    }

    // One 1-px point per star and sample offset, drawn depth-tested with colour writes off inside an
    // occlusion query, so anything in the depth buffer (voxels, trees, tiles, hulls, rings) hides the flare.
    initProbes( renderer ) {
        const gl = renderer.getContext();
        this.gl = gl;
        this.probeScene = new THREE.Scene();
        const mat = new THREE.ShaderMaterial( {
            colorWrite: false, depthWrite: false, depthTest: true,
            vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = 1.0;
    #include <logdepthbuf_vertex>
}`,
            fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4( 1.0 );
}`,
        } );
        this.probes = [];
        for ( let i = 0; i < MAXF * SAMPLES.length; i++ ) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 3 ), 3 ) );
            const pts = new THREE.Points( geo, mat );
            pts.frustumCulled = false;
            const probe = { pts, free: Array.from( { length: 8 }, () => gl.createQuery() ), pending: [], seen: 1 };
            pts.onBeforeRender = () => { const q = probe.free.pop(); probe.active = q || null; if ( q ) gl.beginQuery( gl.ANY_SAMPLES_PASSED, q ); };
            pts.onAfterRender = () => { if ( probe.active ) { gl.endQuery( gl.ANY_SAMPLES_PASSED ); probe.pending.push( probe.active ); } };
            this.probeScene.add( pts );
            this.probes.push( probe );
        }
    }

    // Reads last results, then places the probes for this frame's ranked sources and draws them.
    probe( renderer, camera, ranked ) {
        if ( ! this.probes ) this.initProbes( renderer );
        const gl = this.gl, w = renderer.domElement.width, h = renderer.domElement.height;
        const vis = [];
        for ( let i = 0; i < MAXF; i++ ) {
            const r = ranked[ i ];
            let seen = 0;
            for ( let j = 0; j < SAMPLES.length; j++ ) {
                const probe = this.probes[ i * SAMPLES.length + j ];
                // Results arrive a few frames late; take the newest one that is ready and recycle the rest.
                for ( let k = probe.pending.length - 1; k >= 0; k-- ) {
                    const q = probe.pending[ k ];
                    if ( ! gl.getQueryParameter( q, gl.QUERY_RESULT_AVAILABLE ) ) continue;
                    probe.seen = gl.getQueryParameter( q, gl.QUERY_RESULT ) ? 1 : 0;
                    probe.free.push( ...probe.pending.splice( 0, k + 1 ) );
                    break;
                }
                seen += probe.seen;
                probe.pts.visible = !! ( r && r.target > 0 );
                if ( ! probe.pts.visible ) { probe.seen = 1; continue; }
                const nx = Math.max( -0.98, Math.min( 0.98, r.nx + SAMPLES[ j ][ 0 ] * 8 / w ) ), ny = Math.max( -0.98, Math.min( 0.98, r.ny + SAMPLES[ j ][ 1 ] * 8 / h ) );
                const dir = new THREE.Vector3( nx, ny, 0.5 ).unproject( camera ).sub( camera.position ).normalize();
                const pos = camera.position.clone().addScaledVector( dir, Math.min( r.dist * 0.9, camera.far * 0.9 ) );
                probe.pts.geometry.attributes.position.setXYZ( 0, pos.x, pos.y, pos.z );
                probe.pts.geometry.attributes.position.needsUpdate = true;
            }
            vis.push( seen / SAMPLES.length );
        }
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        renderer.render( this.probeScene, camera );
        renderer.autoClear = auto;
        gl.flush();
        return vis;
    }

    // sources: [ { pos, color, bright } ]; bright ~ 1 is a faint flare, ~30 a full one. occluded( pos ) says whether a body blocks it.
    update( dt, camera, sources, occluded, renderer = null ) {
        const fwd = new THREE.Vector3( 0, 0, -1 ).applyQuaternion( camera.quaternion );
        const ranked = sources.map( ( src ) => {
            const dir = src.pos.clone().sub( camera.position );
            if ( dir.dot( fwd ) <= 0 ) return { src, target: 0, nx: 0, ny: 0, dist: 1 };
            const p = src.pos.clone().project( camera );
            const edge = Math.min( 1, Math.max( 0, 1.6 - Math.max( Math.abs( p.x ), Math.abs( p.y ) ) ) );
            const t = Math.min( 1, Math.max( 0, Math.log10( Math.max( src.bright, 0.01 ) / 4 ) / 2.4 ) );
            const target = occluded( src.pos ) ? 0 : t * t * ( 3 - 2 * t ) * edge;
            return { src, target, nx: p.x, ny: p.y, dist: dir.length() };
        } ).sort( ( a, b ) => b.target - a.target ).slice( 0, MAXF );
        const vis = renderer ? this.probe( renderer, camera, ranked ) : null;
        this.uniforms.aspect.value = camera.aspect;
        for ( let i = 0; i < MAXF; i++ ) {
            const r = ranked[ i ], slot = this.slots[ i ];
            const target = r ? r.target * ( vis ? vis[ i ] : 1 ) : 0;
            slot.s += ( target - slot.s ) * Math.min( dt * ( target < slot.s ? 10 : 4 ), 1 );
            this.uniforms.flares.value[ i ].set( r ? r.nx : 0, r ? r.ny : 0, slot.s, 0 );
            if ( r ) this.uniforms.fcolor.value[ i ].set( r.src.color.r, r.src.color.g, r.src.color.b );
        }
        this.mesh.visible = this.slots.some( ( s ) => s.s > 0.02 );
    }

    render( renderer ) {
        if ( ! this.mesh.visible ) return;
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        renderer.render( this.scene, this.camera );
        renderer.autoClear = auto;
    }
}
