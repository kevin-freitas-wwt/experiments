import * as THREE from "three";

function seeded( seed ) {
    let s = seed >>> 0;
    return function () {
        s = ( s * 1664525 + 1013904223 ) >>> 0;
        return s / 4294967296;
    };
}

// Mottled rock: grain plus layered soft blotches. Returns a tileable-enough
// grayscale canvas used as both the color base and the bump map.
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
            const g = ctx.createRadialGradient( x, y, 0, x, y, r );
            g.addColorStop( 0, `rgba(${ v },${ v },${ v },${ 0.5 - pass * 0.1 })` );
            g.addColorStop( 1, `rgba(${ v },${ v },${ v },0)` );
            ctx.fillStyle = g;
            ctx.fillRect( x - r, y - r, r * 2, r * 2 );
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

function rock( seed, tint, roughness ) {
    const base = rockCanvas( seed );
    const bump = new THREE.CanvasTexture( base );
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial( {
        bumpMap: bump,
        bumpScale: 0.6,
        map: texture( tinted( base, tint ) ),
        metalness: 0,
        roughness
    } );
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
