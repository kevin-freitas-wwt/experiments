import * as THREE from "three";
import { CELL } from "./sections.js";
import { glowSprite } from "./glow.js";

// A cave lamp: a rod hung from the ceiling with a small warm glass body and a
// dim point light. Static; the light has no flicker.

const rodMaterial = new THREE.MeshStandardMaterial( { color: 0x2a2622, metalness: 0.4, roughness: 0.7 } );
const capMaterial = new THREE.MeshStandardMaterial( { color: 0x3b332c, metalness: 0.3, roughness: 0.8 } );
const glassMaterial = new THREE.MeshStandardMaterial( { color: 0x201408, emissive: 0xffb866, emissiveIntensity: 6, roughness: 0.4 } );

export function buildLamp( cell, root ) {
    const ray = new THREE.Raycaster();
    const origin = new THREE.Vector3( cell.x * CELL, cell.y * CELL + 2, cell.z * CELL );
    cell.group.updateMatrixWorld( true );
    ray.set( origin, new THREE.Vector3( 0, 1, 0 ) );
    ray.far = CELL;
    const hit = ray.intersectObjects( cell.meshes, false )[ 0 ];
    const ceiling = hit ? hit.point.y - cell.y * CELL : CELL - 0.3;

    const group = new THREE.Group();
    group.position.set( 0, ceiling, 0 );
    cell.group.add( group );

    const drop = 0.9;
    const rod = new THREE.Mesh( new THREE.CylinderGeometry( 0.025, 0.025, drop, 6 ), rodMaterial );
    rod.position.y = -drop / 2 + 0.15;
    group.add( rod );

    const cap = new THREE.Mesh( new THREE.ConeGeometry( 0.26, 0.16, 10 ), capMaterial );
    cap.position.y = -drop + 0.22;
    group.add( cap );

    const glass = new THREE.Mesh( new THREE.SphereGeometry( 0.15, 12, 8 ), glassMaterial );
    glass.position.y = -drop;
    group.add( glass );

    const halo = glowSprite( 0xffc27a, 1.3, 0.6 );
    halo.position.y = -drop;
    group.add( halo );

    const light = new THREE.PointLight( 0xffc27a, 9, 11, 2 );
    light.position.set( cell.x * CELL, cell.y * CELL + ceiling - drop - 0.1, cell.z * CELL );
    root.add( light );
    return light;
}
