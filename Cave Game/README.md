# Cave Game

First-person cave kit. Levels are JSON (JavaScript Object Notation) grids; every section is carved inside the same bounding cube with fixed mouth shapes, so any two sections that both open onto a shared face line up automatically.

Not listed on the experiments index.

## Running

```bash
python3 "Cave Game/serve.py" 8765     # from the experiments folder
```

Open http://localhost:8765/Cave%20Game/ (ES modules need `http://`, not `file://`). Three.js loads from jsDelivr via an importmap; there is no build step. `serve.py` is a plain static server that sends `Cache-Control: no-store`; with `python3 -m http.server` Chrome will happily keep stale modules across reloads and you end up hard-refreshing after every edit.

Levels: `?level=gallery` (default, the whole kit laid out) or `?level=sample` (a small connected loop with a chimney). `?pose=x,y,z,yaw,pitch` frames a still with the overlay hidden.

## Controls

`E S D F` or arrows to move, `Shift` to run, hold `A` to lift off like a helicopter (it spools up over about a second, and when released you sink gently until you touch down), mouse to look, `Esc` to release.

## The cube

`CELL = 6` units: floor at local `y = 0`, ceiling at `y = 6`, walls at `±3`. Every section is carved out of that cube and all its rock faces inward, so from outside a cell you look straight through into it, which is what makes the gallery readable without a cutaway mode.

## Section kit (`src/sections.js`)

| Type | Openings (rot 0) | Notes |
| --- | --- | --- |
| `corridor` | n s | straight pass-through |
| `corner` | n e | 90° turn |
| `tee` | n s e | one side opens off |
| `cross` | n e s w | both sides open off |
| `end` | n | dead end |
| `chimney` | s up | dead end under a ceiling hole; hold `A` to rise through it |
| `shaft` | up down | vertical pass-through |
| `pit` | n down | dead end over a drop |
| `well` | n s down | passage with a floor hole |
| `cap` | n s up | passage with a ceiling hole |
| `pool` | n s | wide low chamber of liquid, held in by a rock sill just inside each mouth |
| `channel` | n s | liquid runs face to face; chain channels to make a river, and cap the ends with pools |

`n` is `-z`, `e` is `+x`. `rot` is quarter turns clockwise seen from above (0 to 3); wall openings rotate, `up`/`down` do not. `rotatedOpenings( type, rot )` gives the world-facing set.

A section is carved, not assembled: `src/caves.js` writes a signed distance field (negative is air) made of an elliptical tube from every wall opening to the centre, a round shaft from every floor or ceiling opening, a sphere chamber wherever three or more meet, three octaves of value noise that pinch and swell the passage, and small spheres and capsules added back as rubble and stalactites. Marching cubes (Three.js's `MarchingCubes` addon, 30³ samples per cell) turns the field into one inward-facing mesh, shaded smoothly with the field gradient as its normals. The rock texture is triplanar: colour and bump are projected along each world axis (one tile per 3 units) and blended by the surface normal, so walls, floor and ceiling all read at the same density with no stretching.

Two rules keep sections connectable. Noise fades to zero within `1.3` units of any open face, so a tube mouth at the cell boundary is always the same fixed ellipse (`3.2` wide, floor to `3.4`) or circle (radius `1.3`) and lines up with the neighbour's. A `0.15` shell of rock is forced along every closed face, pierced only by the exact mouth shape, so air never leaks out of the cube.

## Level JSON (`levels/*.json`)

```json
{
    "name": "sample",
    "blurb": "Shown on the entry sheet.",
    "ground": false,
    "labels": false,
    "fog": 0.05,
    "spawn": { "x": 0, "y": 0, "z": 0, "yaw": 3.14159 },
    "cells": [
        { "x": 0, "y": 0, "z": 0, "type": "end", "rot": 2 },
        { "x": 0, "y": 0, "z": 1, "type": "corridor", "rot": 0, "label": false }
    ]
}
```

Cells are in grid units (world position is `cell * CELL`). `spawn` may be fractional; `yaw` is radians, `0` faces north. `ground` adds a flat plane at `y = 0`; `labels` hangs a type/blurb sprite in front of each cell unless that cell sets `label: false`. `ambient` scales the hemisphere fill light (default 0.6, cave-dark; the gallery uses 9 so every exhibit is lit). `view` is the draw distance in cells (default 5): cells further than that from the player are hidden, and unless `fog` is given the fog density is set so the cut-off is already invisible.

`pool` and `channel` cells are filled with a glowing liquid at `y = 0.45`: lava (`#ff5a1a`) by default, or any CSS colour given as `"liquid": "#28d7ff"` on the cell. The surface is a flat mesh trimmed to the carved air so it never shows through rock, with the colour as a strong emissive and a slowly drifting crust texture; one point light of the same colour floods the cell. Touching the liquid (your feet below its surface in that cell) kills you: a red flash and you respawn. The liquid is not a collider, so you fall into it. Hold `A` to fly across; a pool's sills are high enough to stand on at each mouth.

A cell with `"flare": true` gets a dropped road flare: a short red stick placed at a seeded random spot on that cell's floor (found by raycasting down, so it sits on cave rock too), a flickering red point light at its tip, and a column of soft white smoke (a 32-point particle system with a small custom shader). Each flare is one real light, so use them in handfuls, not everywhere.

On load, every opening is checked against its neighbour. A face that opens into a closed face logs a `console.warn` naming both cells.

## Movement (`src/main.js`)

Raycast collision against the section meshes: two horizontal rays at knee and chest height block walls, a downward ray from step height finds the floor and follows slopes up and down, an upward ray stops you at ceilings, and gravity takes over at holes. Lifting with `A` cancels gravity while held and ramps up to 3.2 m/s. Because rock faces inward only, collision also only works from inside a cell; walking into a cell from outside passes through its wall. Fall below `y = -40`, or into liquid, and you respawn at the level's `spawn`.

## Performance

No shadow maps. Pixel ratio is capped at 1.5. The only lights are the headlamp, a dim hemisphere fill, and one point light per flare or liquid cell. Collision rays only test the meshes of the 3×3×3 block of cells around the player. Fields are sampled at 30³, which keeps a cell at roughly 3–6k triangles; the console reports build time and the triangle count in view.

## Files

| File | Purpose |
| --- | --- |
| `src/sections.js` | Cube constants, the kit table, rotation helper |
| `src/level.js` | JSON loading, placing cells, connectivity check, labels, ground |
| `src/materials.js` | Tileable canvas rock, triplanar-projected colour and bump (`onBeforeCompile`); glowing liquid |
| `src/noise.js` | Seeded RNG (random number generator) and 3D value noise |
| `src/caves.js` | Signed distance field and marching-cubes mesh for every section; trimmed liquid surface |
| `src/flare.js` | Dropped flare: stick, flickering light, smoke particles |
| `src/main.js` | Renderer, headlamp, pointer-lock controls, collision, HUD (heads-up display) |
| `src/style.css` | Entry sheet, survey log, crosshair |
| `levels/gallery.json` | Every section on a 4×3 grid with aisles, vertical partners stacked |
| `levels/sample.json` | Small connected loop using rotation, a chimney and a lava pool |
