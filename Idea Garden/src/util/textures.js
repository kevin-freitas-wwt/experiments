import * as THREE from "three";

// Everything visual that needs text or a picture is drawn to a 2D <canvas> and
// uploaded as a texture. No external image files required.

// Wrap a string to lines that each fit within maxWidth (in px).
function wrapText( ctx, text, maxWidth ) {
    const words = text.split( " " );
    const lines = [];
    let line = "";

    for ( const word of words ) {
        const candidate = line ? line + " " + word : word;
        if ( ctx.measureText( candidate ).width > maxWidth && line ) {
            lines.push( line );
            line = word;
        } else {
            line = candidate;
        }
    }
    if ( line ) {
        lines.push( line );
    }
    return lines;
}

// Rounded-rectangle path helper.
function roundRect( ctx, x, y, w, h, r ) {
    ctx.beginPath();
    ctx.moveTo( x + r, y );
    ctx.arcTo( x + w, y, x + w, y + h, r );
    ctx.arcTo( x + w, y + h, x, y + h, r );
    ctx.arcTo( x, y + h, x, y, r );
    ctx.arcTo( x, y, x + w, y, r );
    ctx.closePath();
}

// A soft abstract "illustration" keyed off the idea's hue — a stand-in for a
// real photo. Swap this out for an <img> draw when you have real artwork.
function paintIllustration( ctx, x, y, w, h, hue ) {
    const sky = ctx.createLinearGradient( x, y, x, y + h );
    sky.addColorStop( 0, `hsl(${ hue }, 70%, 80%)` );
    sky.addColorStop( 1, `hsl(${ ( hue + 45 ) % 360 }, 60%, 42%)` );
    ctx.fillStyle = sky;
    ctx.fillRect( x, y, w, h );

    for ( let i = 0; i < 22; i++ ) {
        const cx = x + Math.random() * w;
        const cy = y + Math.random() * h;
        const r = 8 + Math.random() * ( w * 0.13 );
        ctx.beginPath();
        ctx.arc( cx, cy, r, 0, Math.PI * 2 );
        ctx.fillStyle = `hsla(${ ( hue + Math.random() * 90 ) % 360 }, 85%, ${ 55 + Math.random() * 25 }%, 0.45)`;
        ctx.fill();
    }
}

// The full idea "card" that hangs from the lattice: title, picture, text.
export function makeCardTexture( idea ) {
    const w = 1024;
    const h = 1280;
    const canvas = document.createElement( "canvas" );
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext( "2d" );

    // Paper
    roundRect( ctx, 0, 0, w, h, 48 );
    ctx.fillStyle = "#f6f3ea";
    ctx.fill();

    // Hue accent bar across the top
    roundRect( ctx, 0, 0, w, 130, 48 );
    ctx.fillStyle = `hsl(${ idea.hue }, 55%, 52%)`;
    ctx.fill();
    ctx.fillRect( 0, 90, w, 40 );

    const margin = 78;

    // Title (over the accent bar)
    ctx.font = "700 60px Georgia, serif";
    ctx.fillStyle = "#fbfaf4";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText( idea.title, margin, 68 );

    // Illustration
    const imgX = margin;
    const imgY = 180;
    const imgW = w - margin * 2;
    const imgH = 520;
    ctx.save();
    roundRect( ctx, imgX, imgY, imgW, imgH, 24 );
    ctx.clip();
    paintIllustration( ctx, imgX, imgY, imgW, imgH, idea.hue );
    ctx.restore();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    roundRect( ctx, imgX, imgY, imgW, imgH, 24 );
    ctx.stroke();

    // Body text
    ctx.font = "400 44px Georgia, serif";
    ctx.fillStyle = "#33402e";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const lines = wrapText( ctx, idea.text, w - margin * 2 );
    let ty = imgY + imgH + 70;
    for ( const line of lines ) {
        ctx.fillText( line, margin, ty );
        ty += 60;
    }

    const texture = new THREE.CanvasTexture( canvas );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

// Mossy gravel for the garden ground.
export function makeGravelTexture() {
    const size = 256;
    const canvas = document.createElement( "canvas" );
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext( "2d" );

    ctx.fillStyle = "#3a3e30";
    ctx.fillRect( 0, 0, size, size );

    for ( let i = 0; i < 4200; i++ ) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const moss = Math.random() < 0.4;
        const r = 1 + Math.random() * 2.2;
        if ( moss ) {
            ctx.fillStyle = `hsl(${ 95 + Math.random() * 25 }, ${ 25 + Math.random() * 20 }%, ${ 22 + Math.random() * 14 }%)`;
        } else {
            ctx.fillStyle = `hsl(${ 35 + Math.random() * 15 }, ${ 6 + Math.random() * 10 }%, ${ 38 + Math.random() * 18 }%)`;
        }
        ctx.fillRect( x, y, r, r );
    }

    const texture = new THREE.CanvasTexture( canvas );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

// Subtle plastered-wall texture: a soft, low-contrast mottle with faint vertical
// weathering streaks over a warm cream base. Gentle on purpose — just enough to
// break up flat walls.
export function makeWallTexture() {
    const size = 256;
    const canvas = document.createElement( "canvas" );
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext( "2d" );

    ctx.fillStyle = "#cabfa4";
    ctx.fillRect( 0, 0, size, size );

    // Soft mottled blotches.
    for ( let i = 0; i < 70; i++ ) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = 18 + Math.random() * 48;
        const light = Math.random() < 0.5;
        const grad = ctx.createRadialGradient( x, y, 0, x, y, r );
        const tint = light ? "214, 204, 178" : "168, 156, 132";
        grad.addColorStop( 0, `rgba( ${ tint }, 0.18 )` );
        grad.addColorStop( 1, `rgba( ${ tint }, 0 )` );
        ctx.fillStyle = grad;
        ctx.fillRect( x - r, y - r, r * 2, r * 2 );
    }

    // Faint vertical weathering streaks.
    ctx.globalAlpha = 0.06;
    for ( let i = 0; i < 50; i++ ) {
        const x = Math.random() * size;
        ctx.fillStyle = Math.random() < 0.5 ? "#9a8e72" : "#ded3b6";
        ctx.fillRect( x, 0, 1 + Math.random() * 2, size );
    }

    // Fine grain.
    ctx.globalAlpha = 0.05;
    for ( let i = 0; i < 2600; i++ ) {
        ctx.fillStyle = Math.random() < 0.5 ? "#000000" : "#ffffff";
        ctx.fillRect( Math.random() * size, Math.random() * size, 1, 1 );
    }
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture( canvas );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

// Tileable running-bond brick for the path.
export function makeBrickTexture() {
    const size = 256;
    const canvas = document.createElement( "canvas" );
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext( "2d" );

    ctx.fillStyle = "#564d42";
    ctx.fillRect( 0, 0, size, size );

    const bw = 64;
    const bh = 32;
    const gap = 5;

    let row = 0;
    for ( let y = 0; y < size; y += bh ) {
        const offset = row % 2 ? bw / 2 : 0;
        for ( let x = -bw; x < size; x += bw ) {
            const hue = 14 + Math.random() * 12;
            const light = 30 + Math.random() * 14;
            ctx.fillStyle = `hsl(${ hue }, ${ 32 + Math.random() * 14 }%, ${ light }%)`;
            ctx.fillRect( x + offset + gap / 2, y + gap / 2, bw - gap, bh - gap );
        }
        row++;
    }

    const texture = new THREE.CanvasTexture( canvas );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}
