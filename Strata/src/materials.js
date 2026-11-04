import * as THREE from 'three';

export const CURVE_RADIUS = 90000;

// Drops vertices by d²/2R in local y, so curved meshes must carry no rotation.
// With `edge`, fragments inside edge.r0 of edge.center are dithered away and fade in by edge.r1.
export const hole = { center: { value: new THREE.Vector3() }, r0: { value: -1 }, r1: { value: -1 } };

// Dithers away fragments within hole.r0 of hole.center (world space), fading in by hole.r1.
export function holed( material ) {
    material.userData.patch = holed;
    material.onBeforeCompile = ( shader ) => {
        shader.uniforms.holeCenter = hole.center;
        shader.uniforms.holeR0 = hole.r0;
        shader.uniforms.holeR1 = hole.r1;
        shader.vertexShader = shader.vertexShader
            .replace( '#include <common>', '#include <common>\nvarying vec3 vHoleW;' )
            .replace( '#include <begin_vertex>', '#include <begin_vertex>\nvHoleW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
        shader.fragmentShader = shader.fragmentShader
            .replace( '#include <common>', '#include <common>\nuniform vec3 holeCenter; uniform float holeR0; uniform float holeR1; varying vec3 vHoleW;' )
            .replace( '#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                if ( holeR1 > holeR0 ) {
                    float holeT = smoothstep( holeR0, holeR1, length( vHoleW - holeCenter ) );
                    float holeH = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
                    if ( holeH > holeT ) discard;
                }` );
    };
    material.customProgramCacheKey = () => 'holed';
    return material;
}

export function curved( material, edge = null ) {
    material.userData.patch = ( m ) => curved( m, edge );
    material.userData.curved = true;
    material.userData.edge = edge;
    material.onBeforeCompile = ( shader ) => {
        shader.uniforms.curveR = { value: CURVE_RADIUS };
        shader.vertexShader = shader.vertexShader
            .replace( '#include <common>', '#include <common>\nuniform float curveR;\nvarying vec2 vCurveXZ;' )
            .replace( '#include <begin_vertex>', `#include <begin_vertex>
                vec4 curveWorld = modelMatrix * vec4( transformed, 1.0 );
                vCurveXZ = curveWorld.xz;
                vec2 curveD = curveWorld.xz - cameraPosition.xz;
                transformed.y -= dot( curveD, curveD ) / ( 2.0 * curveR );` );
        if ( edge ) {
            shader.uniforms.edgeCenter = edge.center;
            shader.uniforms.edgeR0 = edge.r0;
            shader.uniforms.edgeR1 = edge.r1;
            shader.fragmentShader = shader.fragmentShader
                .replace( '#include <common>', '#include <common>\nuniform vec2 edgeCenter; uniform float edgeR0; uniform float edgeR1; varying vec2 vCurveXZ;' )
                .replace( '#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                    if ( edgeR1 > edgeR0 ) {
                        float edgeT = smoothstep( edgeR0, edgeR1, length( vCurveXZ - edgeCenter ) );
                        float edgeH = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
                        if ( edgeH > edgeT ) discard;
                    }` );
        }
    };
    material.customProgramCacheKey = () => edge ? 'curved-edge' : 'curved';
    return material;
}

const edgeUniforms = () => ( { center: { value: new THREE.Vector2() }, r0: { value: -1 }, r1: { value: -1 } } );

export const solidMat = curved( new THREE.MeshLambertMaterial( { vertexColors: true } ) );
export const waterMat = curved( new THREE.MeshLambertMaterial( { vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false } ) );
export const fineTileMat = curved( new THREE.MeshLambertMaterial( { vertexColors: true } ), edgeUniforms() );
export const midTileMat = curved( new THREE.MeshLambertMaterial( { vertexColors: true } ), edgeUniforms() );
export const coarseTileMat = curved( new THREE.MeshLambertMaterial( { vertexColors: true } ), edgeUniforms() );
export const oceanMat = curved( new THREE.MeshLambertMaterial( { color: 0x2d4e80 } ) );
export const bodyMat = holed( new THREE.MeshLambertMaterial( { vertexColors: true } ) );
export const rockMat = new THREE.MeshLambertMaterial( { vertexColors: true } );
export const instanceMat = new THREE.MeshLambertMaterial( { color: 0xffffff } );

const fades = [];

export function fadeIn( mesh, duration = 0.6, onDone = null, out = false ) {
    const existing = fades.find( ( f ) => f.mesh === mesh );
    const base = existing ? existing.base : mesh.material;
    if ( existing ) { existing.m.dispose(); fades.splice( fades.indexOf( existing ), 1 ); }
    const m = base.clone();
    if ( base.userData.patch ) base.userData.patch( m );
    m.alphaHash = true;
    m.opacity = out ? 1 : 0;
    if ( out ) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    mesh.material = m;
    fades.push( { mesh, base, m, t: 0, duration, onDone, out } );
}

export function fadeOut( mesh, duration = 0.8, onDone = null ) {
    fadeIn( mesh, duration, onDone, true );
}

export function tickFades( dt ) {
    for ( let i = fades.length - 1; i >= 0; i-- ) {
        const f = fades[ i ];
        f.t += dt;
        const k = Math.min( 1, f.t / f.duration );
        f.m.opacity = f.out ? 1 - k : k;
        if ( f.t < f.duration ) continue;
        if ( f.out ) f.mesh.visible = false;
        f.mesh.material = f.base;
        f.m.dispose();
        fades.splice( i, 1 );
        if ( f.onDone ) f.onDone();
    }
}
