import * as THREE from "three";

// A big inward-facing sphere painted with a procedural starfield + Milky Way
// band, modeled loosely on the real night sky rather than a photographic
// skybox: a nebulous, dust-streaked band of clustered stars crossing an
// otherwise sparse field, with a handful of standout bright stars.

const TEX_WIDTH = 2048;
const TEX_HEIGHT = 1024;
const SKY_RADIUS = 180; // comfortably inside camera.far (200), well outside FLIGHT_BOUND_XY/Z

function rand( min, max ) {
    return min + Math.random() * ( max - min );
}

// A soft radial glow blob - the one brush stroke used for both the Milky
// Way's nebulous cloud and each bright star's halo.
function glow( ctx, x, y, radius, color, alpha ) {
    const gradient = ctx.createRadialGradient( x, y, 0, x, y, radius );
    gradient.addColorStop( 0, `rgba(${ color },${ alpha })` );
    gradient.addColorStop( 1, `rgba(${ color },0)` );
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc( x, y, radius, 0, Math.PI * 2 );
    ctx.fill();
}

// The band's centerline across the equirectangular canvas - a shallow, wavy
// arc, so it reads as the Milky Way crossing a real sky rather than a
// perfectly straight seam. Frequencies are whole numbers of cycles across
// TEX_WIDTH so the curve lines up exactly at x=0/x=TEX_WIDTH - required for
// the sphere's horizontal wrap (u=0 meets u=1) to show no seam.
function bandY( x ) {
    return TEX_HEIGHT * 0.42
        + Math.sin( x / TEX_WIDTH * Math.PI * 2 * 1 ) * TEX_HEIGHT * 0.12
        + Math.sin( x / TEX_WIDTH * Math.PI * 2 * 3 + 1.7 ) * TEX_HEIGHT * 0.03;
}

// Every dot/blob is drawn at x and, if it falls within `radius` of either
// edge, also drawn one canvas-width to either side - so it wraps around
// exactly like it should once the sphere joins the canvas's left edge back
// to its right edge, instead of getting clipped into a seam.
function edgeWrapXs( x, radius ) {
    const xs = [ x ];
    if ( x - radius < 0 ) xs.push( x + TEX_WIDTH );
    if ( x + radius > TEX_WIDTH ) xs.push( x - TEX_WIDTH );
    return xs;
}

function paintMilkyWay( ctx ) {
    for ( let i = 0; i < 900; i++ ) {
        const x = Math.random() * TEX_WIDTH;
        const spread = rand( -1, 1 );
        const y = bandY( x ) + spread * TEX_HEIGHT * 0.09;
        const edgeFalloff = 1 - Math.min( 1, Math.abs( spread ) );
        const warmth = Math.random() < 0.5;
        const color = warmth ? "215,205,180" : "190,205,225";
        const radius = rand( 30, 90 );
        edgeWrapXs( x, radius ).forEach( ( wx ) => glow( ctx, wx, y, radius, color, 0.025 * edgeFalloff ) );
    }
    // Dust lanes: dark streaks carved back out of the band so it doesn't
    // read as one uniform glowing stripe.
    ctx.globalCompositeOperation = "destination-out";
    for ( let i = 0; i < 60; i++ ) {
        const x = Math.random() * TEX_WIDTH;
        const y = bandY( x ) + rand( -1, 1 ) * TEX_HEIGHT * 0.05;
        const radius = rand( 20, 70 );
        edgeWrapXs( x, radius ).forEach( ( wx ) => glow( ctx, wx, y, radius, "0,0,0", rand( 0.08, 0.22 ) ) );
    }
    ctx.globalCompositeOperation = "source-over";
}

function paintStars( ctx ) {
    for ( let i = 0; i < 9000; i++ ) {
        const x = Math.random() * TEX_WIDTH;
        const y = Math.random() * TEX_HEIGHT;
        const distFromBand = Math.abs( y - bandY( x ) ) / TEX_HEIGHT;
        // Stars cluster near the band, same as the real night sky - sparse
        // field elsewhere, dense right along the galactic band.
        if ( Math.random() > Math.max( 0.08, 1 - distFromBand * 4 ) ) continue;
        const size = Math.random() < 0.04 ? rand( 1.2, 2 ) : rand( 0.4, 1 );
        const tint = Math.random();
        const color = tint < 0.1 ? "170,195,255" : tint < 0.18 ? "255,220,180" : "255,255,255";
        ctx.fillStyle = `rgba(${ color },${ rand( 0.35, 1 ) })`;
        edgeWrapXs( x, size ).forEach( ( wx ) => {
            ctx.beginPath();
            ctx.arc( wx, y, size, 0, Math.PI * 2 );
            ctx.fill();
        } );
    }
    // A handful of standout bright stars, scattered anywhere (not just the
    // band), each with a tiny glow halo so a few points actually read as
    // "bright" rather than just slightly bigger dots.
    for ( let i = 0; i < 40; i++ ) {
        const x = Math.random() * TEX_WIDTH;
        const y = Math.random() * TEX_HEIGHT;
        const haloRadius = rand( 3, 6 );
        const dotRadius = rand( 1, 1.6 );
        edgeWrapXs( x, haloRadius ).forEach( ( wx ) => {
            glow( ctx, wx, y, haloRadius, "255,255,255", 0.5 );
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.beginPath();
            ctx.arc( wx, y, dotRadius, 0, Math.PI * 2 );
            ctx.fill();
        } );
    }
}

function buildSkyTexture() {
    const canvas = document.createElement( "canvas" );
    canvas.width = TEX_WIDTH;
    canvas.height = TEX_HEIGHT;
    const ctx = canvas.getContext( "2d" );
    ctx.fillStyle = "#04050a";
    ctx.fillRect( 0, 0, TEX_WIDTH, TEX_HEIGHT );
    paintMilkyWay( ctx );
    paintStars( ctx );
    const texture = new THREE.CanvasTexture( canvas );
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export function createSkybox() {
    const geometry = new THREE.SphereGeometry( SKY_RADIUS, 32, 16 );
    const material = new THREE.MeshBasicMaterial( {
        map: buildSkyTexture(),
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
    } );
    return new THREE.Mesh( geometry, material );
}
