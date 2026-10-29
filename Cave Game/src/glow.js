import * as THREE from "three";

// Soft additive billboard used as the visible halo around every light source.

let haloTexture = null;

function texture() {
    if ( !haloTexture ) {
        const size = 128;
        const canvas = document.createElement( "canvas" );
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext( "2d" );
        const g = ctx.createRadialGradient( size / 2, size / 2, 0, size / 2, size / 2, size / 2 );
        g.addColorStop( 0, "rgba(255,255,255,1)" );
        g.addColorStop( 0.25, "rgba(255,255,255,0.45)" );
        g.addColorStop( 0.6, "rgba(255,255,255,0.1)" );
        g.addColorStop( 1, "rgba(255,255,255,0)" );
        ctx.fillStyle = g;
        ctx.fillRect( 0, 0, size, size );
        haloTexture = new THREE.CanvasTexture( canvas );
    }
    return haloTexture;
}

export function glowSprite( colour, size, opacity ) {
    const sprite = new THREE.Sprite( new THREE.SpriteMaterial( {
        blending: THREE.AdditiveBlending,
        color: colour,
        depthWrite: false,
        fog: false,
        map: texture(),
        opacity,
        transparent: true
    } ) );
    sprite.scale.set( size, size, 1 );
    return sprite;
}
