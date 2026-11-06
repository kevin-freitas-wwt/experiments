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

// With `jitter`, each block gets a ±7% tone from a hash of its cell in object space (so greedy-merged faces still read as blocks).
export function curved( material, edge = null, jitter = false ) {
    material.userData.patch = ( m ) => curved( m, edge, jitter );
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
        if ( jitter ) {
            shader.vertexShader = shader.vertexShader
                .replace( '#include <common>', '#include <common>\nvarying vec3 vJp; varying vec3 vJn;' )
                .replace( '#include <begin_vertex>', '#include <begin_vertex>\nvJp = position; vJn = normal;' );
            shader.fragmentShader = shader.fragmentShader
                .replace( '#include <common>', '#include <common>\nvarying vec3 vJp; varying vec3 vJn;' )
                .replace( '#include <color_fragment>', `#include <color_fragment>
                    vec3 jc = floor( vJp - vJn * 0.5 );
                    diffuseColor.rgb *= 0.93 + fract( sin( dot( jc, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) * 0.14;` );
        }
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
    material.customProgramCacheKey = () => ( edge ? 'curved-edge' : 'curved' ) + ( jitter ? '-jitter' : '' );
    return material;
}

// Planet heightfield tiles: no horizon curvature (they are true sphere points), hidden inside tileEdge.r0 of
// tileEdge.center (where voxels cover them) with a dither band to r1, offset to win depth ties with the sphere.
export const tileEdge = { center: { value: new THREE.Vector3() }, r0: { value: -1 }, r1: { value: -1 } };

export function tiled( material ) {
    material.userData.patch = tiled;
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -2;
    material.onBeforeCompile = ( shader ) => {
        shader.uniforms.tileCenter = tileEdge.center;
        shader.uniforms.tileR0 = tileEdge.r0;
        shader.uniforms.tileR1 = tileEdge.r1;
        shader.vertexShader = shader.vertexShader
            .replace( '#include <common>', '#include <common>\nvarying vec3 vTileW;' )
            .replace( '#include <begin_vertex>', '#include <begin_vertex>\nvTileW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
        shader.fragmentShader = shader.fragmentShader
            .replace( '#include <common>', '#include <common>\nuniform vec3 tileCenter; uniform float tileR0; uniform float tileR1; varying vec3 vTileW;' )
            .replace( '#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                if ( tileR1 > tileR0 ) {
                    float tileT = smoothstep( tileR0, tileR1, length( vTileW - tileCenter ) );
                    float tileH = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
                    if ( tileH > tileT ) discard;
                }` );
    };
    material.customProgramCacheKey = () => 'tiled';
    return material;
}

export const waterTime = { value: 0 };

// Planar reflection of the scene mirrored in the current liquid plane, rendered by main each frame:
// the texture, the mirror camera's texture matrix, and a strength main sets to 0 when there is no plane.
export const reflection = { map: { value: null }, matrix: { value: new THREE.Matrix4() }, strength: { value: 0 } };
export const WATER_MATS = new Set();

// Animated liquid: scrolling ripples bend the normal and sparkle the surface, in the frame's own xz (frameInv, kept
// current by the World) so a spinning planet does not drag the pattern across its seas; the ripple also distorts the planar reflection, blended in by a Fresnel term biased so a fair
// share of sky and land shows even looking straight down.
export function watery( material ) {
    const prev = material.onBeforeCompile;
    WATER_MATS.add( material );
    material.onBeforeCompile = ( shader ) => {
        prev( shader );
        shader.uniforms.time = waterTime;
        shader.uniforms.reflMap = reflection.map;
        shader.uniforms.reflMatrix = reflection.matrix;
        shader.uniforms.reflStrength = reflection.strength;
        shader.uniforms.frameInv = material.userData.frameInv || ( material.userData.frameInv = { value: new THREE.Matrix4() } );
        shader.vertexShader = shader.vertexShader
            .replace( '#include <common>', '#include <common>\nuniform mat4 reflMatrix; uniform mat4 frameInv; varying vec4 vRefl; varying vec2 vWaveXZ;' )
            .replace( '#include <project_vertex>', '#include <project_vertex>\nvRefl = reflMatrix * modelMatrix * vec4( transformed, 1.0 );\nvWaveXZ = ( frameInv * modelMatrix * vec4( position, 1.0 ) ).xz;' );
        shader.fragmentShader = shader.fragmentShader
            .replace( '#include <opaque_fragment>', `#include <opaque_fragment>
                if ( reflStrength > 0.0 ) {
                    vec3 rv = normalize( vViewPosition );
                    float cosT = clamp( dot( normal, rv ), 0.0, 1.0 );
                    float fres = mix( 0.4, 0.9, pow( 1.0 - cosT, 3.0 ) ) * reflStrength;
                    vec4 rc = vRefl;
                    rc.xy += vec2( wx, wz ) * 0.03 * rc.w;
                    vec3 refl = texture2DProj( reflMap, rc ).rgb * vec3( 0.9, 0.94, 1.0 );
                    gl_FragColor.rgb = mix( gl_FragColor.rgb, refl, fres );
                    gl_FragColor.a = max( gl_FragColor.a, fres );
                }` )
            .replace( '#include <common>', `#include <common>
                uniform sampler2D reflMap; uniform float reflStrength; varying vec4 vRefl; varying vec2 vWaveXZ;
                uniform float time; varying vec2 vCurveXZ;
                float wave( vec2 p, float t ) {
                    return sin( p.x * 1.1 + t * 1.4 ) * sin( p.y * 0.8 - t * 1.1 ) * 0.5
                         + sin( ( p.x + p.y ) * 1.9 + t * 2.3 ) * 0.3
                         + sin( ( p.x * 0.6 - p.y * 1.4 ) * 2.7 - t * 1.7 ) * 0.2;
                }` )
            .replace( '#include <color_fragment>', `#include <color_fragment>
                float w0 = wave( vWaveXZ, time );
                float ripple = 0.5 + 0.5 * w0;
                float cells = abs( sin( ( vWaveXZ.x * 2.3 + w0 * 2.0 ) ) * sin( ( vWaveXZ.y * 2.1 - w0 * 2.0 + time * 0.6 ) ) );
                diffuseColor.rgb *= 0.86 + ripple * 0.22;
                diffuseColor.rgb += vec3( 0.18, 0.2, 0.22 ) * pow( cells, 6.0 ) * ( 0.4 + 0.6 * ripple );` )
            .replace( '#include <normal_fragment_begin>', `#include <normal_fragment_begin>
                float eps = 0.35;
                float wx = wave( vWaveXZ + vec2( eps, 0.0 ), time ) - w0;
                float wz = wave( vWaveXZ + vec2( 0.0, eps ), time ) - w0;
                normal = normalize( normal + vec3( -wx, 0.0, -wz ) * 0.9 );` );
    };
    material.customProgramCacheKey = () => 'curved-water';
    material.userData.patch = ( m ) => watery( curved( m ) );
    return material;
}

// Terrain fade without material clones: each vertex carries the second its chunk arrived (`born`), the
// shader dithers it in over 0.6 s from terrainNow, and a per-world `dieAt` dithers the whole world out.
export const terrainNow = { value: 0 };

export function fading( material, die ) {
    const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = ( shader ) => {
        prev( shader );
        shader.uniforms.terrainNow = terrainNow;
        shader.uniforms.dieAt = die.dieAt;
        shader.uniforms.dieDur = die.dieDur;
        shader.vertexShader = shader.vertexShader
            .replace( '#include <common>', '#include <common>\nattribute float born; varying float vBorn;' )
            .replace( '#include <begin_vertex>', '#include <begin_vertex>\nvBorn = born;' );
        shader.fragmentShader = shader.fragmentShader
            .replace( '#include <common>', '#include <common>\nuniform float terrainNow; uniform float dieAt; uniform float dieDur; varying float vBorn;' )
            .replace( '#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                float fadeT = clamp( ( terrainNow - vBorn ) / 0.6, 0.0, 1.0 );
                if ( dieAt > 0.0 ) fadeT = min( fadeT, 1.0 - clamp( ( terrainNow - dieAt ) / dieDur, 0.0, 1.0 ) );
                if ( fadeT < 1.0 && fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) > fadeT ) discard;` );
    };
    material.customProgramCacheKey = () => prevKey.call( material ) + '-fade';
    return material;
}

// One solid and one water material per world, sharing that world's fade-out uniforms.
export function terrainMaterials() {
    const die = { dieAt: { value: -1 }, dieDur: { value: 1 } };
    return {
        die,
        solid: hazed( weathered( fading( curved( new THREE.MeshLambertMaterial( { vertexColors: true } ), null, true ), die ) ) ),
        water: hazed( fading( watery( curved( new THREE.MeshLambertMaterial( { vertexColors: true, transparent: true, opacity: 0.86, depthWrite: false } ) ) ), die ) ),
    };
}

// Weather on the ground: rain darkens the terrain and pools sky-coloured puddles on flat tops, and a snow
// line (metres above the sea, lowered toward the poles and into the winter hemisphere) whitens upward faces
// above it, so seasons move the snow without regenerating a block. wxUp is the frame's up for flat worlds.
export const wx = {
    wet: { value: 0 }, snowLine: { value: 1e9 }, season: { value: 0 }, polar: { value: 0 }, soft: { value: 40 },
    flat: { value: 1 }, center: { value: new THREE.Vector3() }, r: { value: 1 }, seaY: { value: 0 }, axis: { value: new THREE.Vector3( 0, 1, 0 ) }, sky: { value: new THREE.Color( 0x9fb4d6 ) },
};

export function weathered( material ) {
    const prev = material.onBeforeCompile || ( () => {} ), prevKey = material.customProgramCacheKey, prevPatch = material.userData.patch;
    material.userData.patch = ( m ) => weathered( prevPatch ? prevPatch( m ) : m );
    material.onBeforeCompile = ( shader ) => {
        prev( shader );
        for ( const [ k, u ] of Object.entries( wx ) ) shader.uniforms[ 'wx' + k[ 0 ].toUpperCase() + k.slice( 1 ) ] = u;
        shader.vertexShader = shader.vertexShader
            .replace( '#include <common>', '#include <common>\nvarying vec3 vWxW; varying vec3 vWxN;' )
            .replace( '#include <begin_vertex>', '#include <begin_vertex>\nvWxW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; vWxN = normalize( mat3( modelMatrix ) * objectNormal );' );
        shader.fragmentShader = shader.fragmentShader
            .replace( '#include <common>', `#include <common>
                uniform float wxWet; uniform float wxSnowLine; uniform float wxSeason; uniform float wxPolar; uniform float wxSoft; uniform float wxFlat; uniform vec3 wxCenter; uniform float wxR; uniform float wxSeaY; uniform vec3 wxAxis; uniform vec3 wxSky;
                varying vec3 vWxW; varying vec3 vWxN;
                float wxHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
                float wxNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( wxHash( i ), wxHash( i + vec2( 1, 0 ) ), f.x ), mix( wxHash( i + vec2( 0, 1 ) ), wxHash( i + vec2( 1, 1 ) ), f.x ), f.y ); }` )
            .replace( '#include <color_fragment>', `#include <color_fragment>
                {
                    vec3 wxUp = wxFlat > 0.5 ? vec3( 0.0, 1.0, 0.0 ) : normalize( vWxW - wxCenter );
                    float wxAlt = wxFlat > 0.5 ? vWxW.y - wxSeaY : length( vWxW - wxCenter ) - wxR;
                    float wxLat = wxFlat > 0.5 ? 1.0 : dot( wxUp, wxAxis );
                    float wxFace = dot( vWxN, wxUp );
                    if ( wxSnowLine < 1e8 ) {
                        float line = wxSnowLine + wxSeason * wxLat - wxPolar * wxLat * wxLat;
                        float snow = smoothstep( line, line + wxSoft, wxAlt + wxNoise( vWxW.xz * 0.05 + vWxW.yz * 0.03 ) * wxSoft * 0.8 ) * smoothstep( 0.35, 0.8, wxFace ) * smoothstep( 0.3, 1.5, wxAlt );
                        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.82, 0.85, 0.9 ), snow );
                    }
                    if ( wxWet > 0.001 ) {
                        diffuseColor.rgb *= 1.0 - 0.3 * wxWet;
                        float pool = smoothstep( 0.66, 0.74, wxNoise( vWxW.xz * 0.16 + vWxW.yz * 0.09 ) ) * smoothstep( 0.9, 0.99, wxFace ) * wxWet;
                        diffuseColor.rgb = mix( diffuseColor.rgb, wxSky * 0.85, pool * 0.6 );
                    }
                }` );
    };
    material.customProgramCacheKey = () => ( prevKey ? prevKey.call( material ) : '' ) + '-wx';
    return material;
}

// Aerial perspective. Optical depth along the fragment-to-camera path through an exponential atmosphere
// (sea-level extinction hazeK per metre, scale height hazeH), around hazeCenter at radius hazeR, or above a
// flat sea at hazeSeaY when hazeFlat is set. Colour and strength come from the sky of the body you are near.
export const haze = {
    on: { value: 0 }, color: { value: new THREE.Color( 0xeadfca ) }, k: { value: 4.5e-5 }, h: { value: 2500 },
    center: { value: new THREE.Vector3() }, r: { value: 1 }, flat: { value: 1 }, seaY: { value: 0 }, sun: { value: new THREE.Vector3( 0, 1, 0 ) },
    zenith: { value: new THREE.Color( 0x5d73a3 ) }, top: { value: 12000 }, veil: { value: 6.3 }, fog: { value: 0 }, fogH: { value: 60 },
};

export function hazed( material ) {
    const prev = material.onBeforeCompile || ( () => {} ), prevKey = material.customProgramCacheKey, prevPatch = material.userData.patch;
    material.userData.patch = ( m ) => hazed( prevPatch ? prevPatch( m ) : m );
    material.onBeforeCompile = ( shader ) => {
        prev( shader );
        for ( const [ k, u ] of Object.entries( haze ) ) shader.uniforms[ 'haze' + k[ 0 ].toUpperCase() + k.slice( 1 ) ] = u;
        shader.vertexShader = shader.vertexShader
            .replace( '#include <common>', '#include <common>\nvarying vec3 vHazeW;' )
            .replace( '#include <begin_vertex>', '#include <begin_vertex>\nvHazeW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
        shader.fragmentShader = shader.fragmentShader
            .replace( '#include <common>', `#include <common>
                uniform float hazeOn; uniform vec3 hazeColor; uniform float hazeK; uniform float hazeH; uniform vec3 hazeCenter; uniform float hazeR; uniform float hazeFlat; uniform float hazeSeaY; uniform vec3 hazeSun; uniform vec3 hazeZenith; uniform float hazeTop; uniform float hazeVeil; uniform float hazeFog; uniform float hazeFogH;
                varying vec3 vHazeW;
                float hazeAlt( vec3 p ) { return hazeFlat > 0.5 ? p.y - hazeSeaY : length( p - hazeCenter ) - hazeR; }
                float hazeDepth( vec3 a, vec3 b ) {
                    float a0 = max( hazeAlt( a ), 0.0 ), a1 = max( hazeAlt( b ), 0.0 ), e0 = exp( -a0 / hazeH ), e1 = exp( -a1 / hazeH );
                    float avg = abs( a1 - a0 ) < 1.0 ? e0 : ( e0 - e1 ) * hazeH / ( a1 - a0 );
                    float tau = hazeK * distance( a, b ) * avg;
                    if ( hazeFog > 0.0 ) {
                        // A second, shallow layer: valley fog that pools a few tens of metres deep at dawn.
                        float f0 = exp( -a0 / hazeFogH ), f1 = exp( -a1 / hazeFogH );
                        float favg = abs( a1 - a0 ) < 1.0 ? f0 : ( f0 - f1 ) * hazeFogH / ( a1 - a0 );
                        tau += hazeFog * distance( a, b ) * favg;
                    }
                    return tau;
                }` )
            .replace( '#include <fog_fragment>', `#include <fog_fragment>
                if ( hazeOn > 0.5 ) {
                    if ( hazeAlt( vHazeW ) > hazeTop ) {
                        // Beyond the air: the whole column's airlight lies in front, so by day the sky washes the object out.
                        vec3 camUp = hazeFlat > 0.5 ? vec3( 0.0, 1.0, 0.0 ) : normalize( cameraPosition - hazeCenter );
                        vec3 view = normalize( vHazeW - cameraPosition );
                        float sinE = max( dot( view, camUp ), 0.04 ), aC = max( hazeAlt( cameraPosition ), 0.0 );
                        float tau = hazeK * hazeH * exp( -aC / hazeH ) / sinE;
                        float lit = smoothstep( -0.1, 0.2, dot( camUp, hazeSun ) );
                        vec3 sky = mix( hazeColor, hazeZenith, smoothstep( -0.02, 0.75, dot( view, camUp ) ) );
                        gl_FragColor.rgb = gl_FragColor.rgb * exp( -tau ) + sky * lit * ( 1.0 - exp( -tau * hazeVeil ) );
                    } else {
                        vec3 hazeUp = hazeFlat > 0.5 ? vec3( 0.0, 1.0, 0.0 ) : normalize( vHazeW - hazeCenter );
                        float hazeLit = 0.08 + 0.92 * smoothstep( -0.12, 0.25, dot( hazeUp, hazeSun ) );
                        gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeColor * hazeLit, 1.0 - exp( -hazeDepth( vHazeW, cameraPosition ) ) );
                    }
                }` );
    };
    material.customProgramCacheKey = () => ( prevKey ? prevKey.call( material ) : '' ) + '-haze';
    return material;
}

const edgeUniforms = () => ( { center: { value: new THREE.Vector2() }, r0: { value: -1 }, r1: { value: -1 } } );

export const solidMat = curved( new THREE.MeshLambertMaterial( { vertexColors: true } ), null, true );
export const waterMat = watery( curved( new THREE.MeshLambertMaterial( { vertexColors: true, transparent: true, opacity: 0.86, depthWrite: false } ) ) );
export const fineTileMat = hazed( weathered( curved( new THREE.MeshLambertMaterial( { vertexColors: true } ), edgeUniforms() ) ) );
export const midTileMat = hazed( weathered( curved( new THREE.MeshLambertMaterial( { vertexColors: true } ), edgeUniforms() ) ) );
export const coarseTileMat = hazed( weathered( curved( new THREE.MeshLambertMaterial( { vertexColors: true } ), edgeUniforms() ) ) );
export const oceanMat = hazed( curved( new THREE.MeshLambertMaterial( { color: 0x2d4e80 } ) ) );
export const planetTileMat = hazed( weathered( tiled( new THREE.MeshLambertMaterial( { vertexColors: true } ) ) ) );
export const bodyMat = hazed( weathered( holed( new THREE.MeshLambertMaterial( { vertexColors: true } ) ) ) );
export const rockMat = hazed( new THREE.MeshLambertMaterial( { vertexColors: true } ) );
export const instanceMat = hazed( new THREE.MeshLambertMaterial( { color: 0xffffff } ) );

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
