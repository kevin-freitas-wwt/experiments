# Idea Garden

## Concept

Idea Garden is a desktop-only, first-person 3D garden built with Three.js where your "ideas" hang as always-visible cards from an overhead wooden lattice. The scene is a fully enclosed, classy Japanese-style courtyard at dusk: subtly plastered perimeter walls with dark capped tops -- gently mottled and faintly weathered -- close the square space on all four sides in solid, unbroken runs. A square central area is paved with brick, beneath a square overhead wooden lattice / pergola -- posts, beams, rafters, and slats -- that spans the courtyard. A field of stars is scattered across the dusk sky overhead, visible above the lattice. The nine idea cards hang vertically from the lattice in a scattered, jittered arrangement -- a jittered grid where each card sits at a random position and faces a random direction (`cardHangPoints` in `src/world/layout.js`) rather than a neat 3x3 grid -- and sway gently above you. Each card shows the same content on the front and the back (two planes back-to-back), so it reads from either side -- there is nothing to click open, and every card is always readable from any approach. Each card shows its idea up front: a title, a photograph used as stand-in art, and a short piece of text. The card art is a real photo pulled from the Unsplash CDN (a placeholder/stand-in); if the image fails to load, a procedural hue swatch shows through as a fallback. Warm string lights are strung along the lattice with a soft glow around them, and stone lanterns (also glowing) sit nearby. Stylised cross-card trees and shrubs in a darker shade of green -- a canvas leaf-cluster texture mapped onto several intersecting alpha-cut planes so canopies read as leafy volumes -- are arranged around the periphery between the lattice and the walls, alongside smooth half-buried stones. Off in the periphery sit dusk water features: a koi pond with a stone rim and lily pads, and a small tsukubai stone basin with a bamboo spout. Their surfaces carry an animated, procedural tileable normal map that scrolls over time (driven from the render clock via `onBeforeRender`), so the water gently ripples and the warm lights shimmer across it. A gentle atmospheric haze (exponential fog) softens the depth under the dusk sky.

## Tech Stack

- **Three.js** -- 3D scene, geometry, and rendering (loaded from a CDN -- jsDelivr -- via an ES-module importmap in `index.html`)
- **WebGL** -- hardware-accelerated graphics backing Three.js
- **Pointer Lock API** -- first-person mouse-look controls

There is **no build step**: Idea Garden is a pure front-end HTML/CSS/JS app with zero npm dependencies.

## Getting Started

No install or build is needed. Serve the folder with any static file server and open it, for example:

```bash
python3 -m http.server 5173
```

Then visit http://localhost:5173 .

It must be served over `http://`, not opened as a `file://` URL, because it uses ES modules.

## Controls

- **E S D F** or **arrow keys** -- move
- **Move the mouse** -- look around
- **Esc** -- release the pointer

## Project Structure

| File | Purpose |
| --- | --- |
| `src/world/layout.js` | Shared courtyard dimensions and key positions (single source of truth) |
| `src/world/structures.js` | Ground, brick paving, perimeter walls, and the pergola/lattice |
| `src/world/lighting.js` | Dusk lighting, string lights with glow, and stone lanterns |
| `src/world/planting.js` | Periphery foliage: stylised cross-card trees and shrubs (canvas leaf-cluster texture on intersecting alpha-cut planes) and smooth half-buried stones |
| `src/world/water.js` | Periphery dusk water features: koi pond with stone rim and lily pads, and a tsukubai stone basin with a bamboo spout (`buildWater(scene)`) |
| `src/world/garden.js` | Orchestrator: dusk sky + overhead star field + atmospheric haze (exponential fog), then calls structures/lighting/planting/water; returns the card hang points |
| `src/world/fruit.js` | The vertical, double-sided hanging idea cards that sway gently; loads each idea's Unsplash stand-in photo onto the card art region at runtime, falling back to the procedural hue swatch if it fails to load |
| `src/util/textures.js` | Canvas-generated card, brick, gravel, wall (plaster mottle + weathering), and leaf-cluster textures |
| `src/data/cards.js` | Async card-data source backing the scene; reads from `src/data/ideas.js` today but is designed so it can later fetch from an API instead |
| `src/data/ideas.js` | Idea content (each idea carries an `image` field pointing to an Unsplash CDN stand-in photo) |
| `src/main.js` | Entry point, render loop, and controls |
| `src/style.css` | Overlay / crosshair styling |
| `index.html` | HTML host page |

## Note

Idea Garden is **desktop-only**. It relies on a keyboard, a mouse, and the Pointer Lock API, and is not designed for touch or mobile devices.
