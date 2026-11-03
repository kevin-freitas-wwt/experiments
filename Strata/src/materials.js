import * as THREE from 'three';

export const CURVE_RADIUS = 90000;

// Drops vertices by d²/2R in local y, so curved meshes must carry no rotation.
export function curved( material ) {
    material.onBeforeCompile = ( shader ) => {
        shader.uniforms.curveR = { value: CURVE_RADIUS };
        shader.vertexShader = shader.vertexShader
            .replace( '#include <common>', '#include <common>\nuniform float curveR;' )
            .replace( '#include <begin_vertex>', `#include <begin_vertex>
                vec4 curveWorld = modelMatrix * vec4( transformed, 1.0 );
                vec2 curveD = curveWorld.xz - cameraPosition.xz;
                transformed.y -= dot( curveD, curveD ) / ( 2.0 * curveR );` );
    };
    material.customProgramCacheKey = () => 'curved';
    return material;
}

export const solidMat = curved( new THREE.MeshLambertMaterial( { vertexColors: true } ) );
export const waterMat = curved( new THREE.MeshLambertMaterial( { vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false } ) );
export const tileMat = curved( new THREE.MeshLambertMaterial( { vertexColors: true } ) );
export const oceanMat = curved( new THREE.MeshLambertMaterial( { color: 0x2d4e80 } ) );
export const bodyMat = new THREE.MeshLambertMaterial( { vertexColors: true } );
export const rockMat = new THREE.MeshLambertMaterial( { vertexColors: true } );
