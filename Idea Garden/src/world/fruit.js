import * as THREE from "three";
import { makeCardTexture } from "../util/textures.js";

// Each idea is a card that hangs vertically from the overhead lattice on a short
// cord and sways gently. Two planes are mounted back-to-back so the same content
// reads correctly from both the front and the back. Nothing to click.

const CARD_W = 1.4;
const CARD_H = CARD_W * ( 1280 / 1024 );
const STEM = 0.3;

// The photo sits over the card's illustration region — these fractions match the
// box drawn by makeCardTexture (imgX 78, imgY 180, imgW 868, imgH 520 of 1024×1280).
const PHOTO_W = ( 868 / 1024 ) * CARD_W;
const PHOTO_H = ( 520 / 1280 ) * CARD_H;
const PHOTO_Y = ( 0.5 - ( 180 + 520 / 2 ) / 1280 ) * CARD_H;

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin( "anonymous" );

// Distance at which a card flips to flat shading even if you aren't aiming at it.
const NEAR_DIST = 5;

// A card surface that is lit by the scene normally, but can fade to flat,
// full-brightness shading by raising emissiveIntensity toward 1 (the emissiveMap
// is the same texture, so at 1 it reads as an unlit, fully legible card).
function makeCardMaterial( texture, side ) {
    return new THREE.MeshStandardMaterial( {
        map: texture,
        emissiveMap: texture,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        roughness: 1,
        metalness: 0,
        side: side
    } );
}

class IdeaCard {
    constructor( idea, hang ) {
        this.idea = idea;
        this.focused = false;
        this.phase = hang.anchor.x * 1.3 + hang.anchor.z * 0.7;

        this.group = new THREE.Group();
        this.group.position.copy( hang.anchor );
        this.group.rotation.y = hang.yaw || 0;

        // Swing group provides the sway; everything below hangs from it.
        this.swing = new THREE.Group();
        this.group.add( this.swing );

        const stem = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints( [
                new THREE.Vector3( 0, 0, 0 ),
                new THREE.Vector3( 0, -STEM, 0 )
            ] ),
            new THREE.LineBasicMaterial( { color: 0x6a5638 } )
        );
        this.swing.add( stem );

        // Card body: two single-sided planes back-to-back, so the back shows the
        // same (un-mirrored) content as the front.
        this.cardBody = new THREE.Group();
        this.cardBody.position.set( 0, -STEM - CARD_H / 2, 0 );
        this.swing.add( this.cardBody );

        const texture = makeCardTexture( idea );
        const material = makeCardMaterial( texture, THREE.FrontSide );
        this.materials = [ material ];
        this.lit = 0;
        const geometry = new THREE.PlaneGeometry( CARD_W, CARD_H );

        const front = new THREE.Mesh( geometry, material );
        front.position.z = 0.012;
        front.userData.card = this;
        this.cardBody.add( front );

        const back = new THREE.Mesh( geometry, material );
        back.rotation.y = Math.PI;
        back.position.z = -0.012;
        back.userData.card = this;
        this.cardBody.add( back );

        this.meshes = [ front, back ];

        // Drop a real photo over the illustration region (front and back). If it
        // fails to load, the procedural swatch underneath simply shows through.
        if ( idea.image ) {
            this.loadPhoto( idea.image );
        }
    }

    loadPhoto( url ) {
        textureLoader.load( url, ( texture ) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            const geometry = new THREE.PlaneGeometry( PHOTO_W, PHOTO_H );
            const material = makeCardMaterial( texture, THREE.FrontSide );
            material.emissiveIntensity = this.lit;   // match the card's current state
            this.materials.push( material );

            const front = new THREE.Mesh( geometry, material );
            front.position.set( 0, PHOTO_Y, 0.02 );
            this.cardBody.add( front );

            const back = new THREE.Mesh( geometry, material );
            back.rotation.y = Math.PI;
            back.position.set( 0, PHOTO_Y, -0.02 );
            this.cardBody.add( back );
        } );
    }

    setFocused( value ) {
        this.focused = value;
    }

    update( elapsed, camera ) {
        this.swing.rotation.z = Math.sin( elapsed * 0.7 + this.phase ) * 0.04;
        this.swing.rotation.x = Math.sin( elapsed * 0.5 + this.phase ) * 0.025;

        // Active when aimed at (focused) or stood near — then flip to flat shading.
        const near = camera.position.distanceTo( this.group.position ) < NEAR_DIST;
        const active = this.focused || near;

        const litTarget = active ? 1 : 0;
        this.lit += ( litTarget - this.lit ) * 0.035;
        for ( const m of this.materials ) {
            m.emissiveIntensity = this.lit;
        }

        const scaleTarget = active ? 1.06 : 1.0;
        const s = this.cardBody.scale.x + ( scaleTarget - this.cardBody.scale.x ) * 0.15;
        this.cardBody.scale.setScalar( s );
    }
}

export function buildCards( scene, hangPoints, ideas ) {
    const cards = [];
    const meshes = [];

    ideas.forEach( ( idea, i ) => {
        const card = new IdeaCard( idea, hangPoints[ i % hangPoints.length ] );
        scene.add( card.group );
        cards.push( card );
        meshes.push( ...card.meshes );
    } );

    return { cards, meshes };
}
