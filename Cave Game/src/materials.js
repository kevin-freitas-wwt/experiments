import * as THREE from "three";

function seeded( seed ) {
    let s = seed >>> 0;
    return function () {
        s = ( s * 1664525 + 1013904223 ) >>> 0;
        return s / 4294967296;
    };
}

// Mottled rock: grain plus layered soft blotches, wrapped so it tiles. Used as
// both the colour base and the bump map.
function rockCanvas( seed, size = 512 ) {
    const rand = seeded( seed );
    const canvas = document.createElement( "canvas" );
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext( "2d" );
    ctx.fillStyle = "#808080";
    ctx.fillRect( 0, 0, size, size );

    for ( let pass = 0; pass < 3; pass++ ) {
        const count = [ 40, 160, 900 ][ pass ];
        const radius = [ 120, 40, 9 ][ pass ];
        for ( let i = 0; i < count; i++ ) {
            const v = 90 + Math.floor( rand() * 70 );
            const x = rand() * size;
            const y = rand() * size;
            const r = radius * ( 0.4 + rand() );
            // Repeat blotches that cross an edge on the far side so the tile wraps.
            for ( const ox of [ 0, -size, size ] ) {
                for ( const oy of [ 0, -size, size ] ) {
                    const bx = x + ox;
                    const by = y + oy;
                    if ( bx + r < 0 || bx - r > size || by + r < 0 || by - r > size ) {
                        continue;
                    }
                    const g = ctx.createRadialGradient( bx, by, 0, bx, by, r );
                    g.addColorStop( 0, `rgba(${ v },${ v },${ v },${ 0.5 - pass * 0.1 })` );
                    g.addColorStop( 1, `rgba(${ v },${ v },${ v },0)` );
                    ctx.fillStyle = g;
                    ctx.fillRect( bx - r, by - r, r * 2, r * 2 );
                }
            }
        }
    }

    const img = ctx.getImageData( 0, 0, size, size );
    const d = img.data;
    for ( let i = 0; i < d.length; i += 4 ) {
        const n = ( rand() - 0.5 ) * 28;
        d[ i ] = d[ i + 1 ] = d[ i + 2 ] = Math.max( 0, Math.min( 255, d[ i ] + n ) );
    }
    ctx.putImageData( img, 0, 0 );
    return canvas;
}

function tinted( canvas, tint ) {
    const out = document.createElement( "canvas" );
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext( "2d" );
    ctx.drawImage( canvas, 0, 0 );
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = tint;
    ctx.fillRect( 0, 0, out.width, out.height );
    return out;
}

function texture( canvas ) {
    const tex = new THREE.CanvasTexture( canvas );
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

// Triplanar rock: colour and bump are projected along each world axis and
// blended by the surface normal, so no face of a carved cell is stretched.
const TILE = 3;

function rock( seed, tint, roughness ) {
    const base = rockCanvas( seed );
    const bump = new THREE.CanvasTexture( base );
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    const material = new THREE.MeshStandardMaterial( {
        bumpMap: bump,
        bumpScale: 0.6,
        map: texture( tinted( base, tint ) ),
        metalness: 0,
        roughness
    } );

    material.onBeforeCompile = ( shader ) => {
        shader.uniforms.uTile = { value: 1 / TILE };

        shader.vertexShader = shader.vertexShader
            .replace( "#include <common>", `#include <common>
                varying vec3 vTriPos;
                varying vec3 vTriNormal;` )
            .replace( "#include <project_vertex>", `#include <project_vertex>
                vTriPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
                vTriNormal = normalize( mat3( modelMatrix ) * objectNormal );` );

        shader.fragmentShader = shader.fragmentShader
            .replace( "#include <common>", `#include <common>
                uniform float uTile;
                varying vec3 vTriPos;
                varying vec3 vTriNormal;
                vec3 triWeights() {
                    vec3 w = pow( abs( vTriNormal ), vec3( 4.0 ) );
                    return w / ( w.x + w.y + w.z );
                }
                vec4 triSample( sampler2D tex, vec3 p ) {
                    vec3 w = triWeights();
                    return texture2D( tex, p.yz * uTile ) * w.x
                        + texture2D( tex, p.xz * uTile ) * w.y
                        + texture2D( tex, p.xy * uTile ) * w.z;
                }` )
            .replace( "#include <map_fragment>", `
                diffuseColor *= triSample( map, vTriPos );` )
            .replace( "#include <bumpmap_pars_fragment>", `
                uniform sampler2D bumpMap;
                uniform float bumpScale;
                vec2 dHdxy_fwd() {
                    vec3 dx = dFdx( vTriPos );
                    vec3 dy = dFdy( vTriPos );
                    float h = triSample( bumpMap, vTriPos ).x;
                    float hx = triSample( bumpMap, vTriPos + dx ).x;
                    float hy = triSample( bumpMap, vTriPos + dy ).x;
                    return vec2( hx - h, hy - h ) * bumpScale;
                }
                vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
                    vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
                    vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
                    vec3 vN = surf_norm;
                    vec3 R1 = cross( vSigmaY, vN );
                    vec3 R2 = cross( vN, vSigmaX );
                    float fDet = dot( vSigmaX, R1 ) * faceDirection;
                    vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
                    return normalize( abs( fDet ) * surf_norm - vGrad );
                }` );
    };
    return material;
}

// Glowing liquid: two layers of tileable noise scroll and warp each other to
// make drifting crust over molten colour. Unlit; fogged and tone mapped like
// everything else. `update( elapsed )` advances it.
const crust = texture( rockCanvas( 0x1a7a, 256 ) );
crust.colorSpace = THREE.NoColorSpace;

export function liquidMaterial( colour ) {
    const material = new THREE.ShaderMaterial( {
        fog: true,
        fragmentShader: `
            uniform vec3 uColour;
            uniform float uTime;
            uniform sampler2D uNoise;
            varying vec2 vUv;
            #include <common>
            #include <fog_pars_fragment>
            void main() {
                vec2 uv = vUv * 2.0;
                float n1 = texture2D( uNoise, uv * 0.45 + vec2( uTime * 0.012, uTime * 0.02 ) ).r;
                float n2 = texture2D( uNoise, uv * 0.9 + vec2( -uTime * 0.017, uTime * 0.009 ) + ( n1 - 0.5 ) * 0.4 ).r;
                float n3 = texture2D( uNoise, uv * 1.8 + vec2( uTime * 0.03, -uTime * 0.024 ) + ( n2 - 0.5 ) * 0.25 ).r;
                // 0 = cooled crust, 1 = white hot
                float heat = clamp( ( n1 * 0.5 + n2 * 0.38 + n3 * 0.12 - 0.5 ) * 6.0 + 0.5, 0.0, 1.0 );
                float crust = 1.0 - smoothstep( 0.28, 0.46, heat );
                float white = smoothstep( 0.68, 0.95, heat );
                float pulse = 0.9 + 0.1 * sin( uTime * 1.7 );
                vec3 hot = mix( uColour, vec3( 1.0 ), 0.35 ) * 1.3;
                vec3 molten = uColour * 0.75;
                vec3 dark = uColour * 0.06;
                vec3 colour = mix( mix( molten, hot, white ), dark, crust ) * pulse;
                gl_FragColor = vec4( colour, 1.0 );
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
                #include <fog_fragment>
            }`,
        uniforms: THREE.UniformsUtils.merge( [
            THREE.UniformsLib.fog,
            {
                uColour: { value: new THREE.Color( colour ) },
                uNoise: { value: crust },
                uTime: { value: 0 }
            }
        ] ),
        vertexShader: `
            varying vec2 vUv;
            #include <common>
            #include <fog_pars_vertex>
            void main() {
                vUv = uv;
                vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }`
    } );
    material.uniforms.uNoise.value = crust;
    material.update = ( elapsed ) => {
        material.uniforms.uTime.value = elapsed;
    };
    return material;
}

export const materials = {
    ground: new THREE.MeshStandardMaterial( {
        color: 0x272d38,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        roughness: 1
    } ),
    rock: rock( 0xc4e1, "#5a6170", 0.95 )
};
