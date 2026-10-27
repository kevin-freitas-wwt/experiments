# Cave Game

First-person cave kit. Levels are JSON (JavaScript Object Notation) grids; every section primitive fits the same bounding cube, so any two sections that both open onto a shared face line up automatically.

Not listed on the experiments index.

## Running

```bash
python3 "Cave Game/serve.py" 8765     # from the experiments folder
```

Open http://localhost:8765/Cave%20Game/ (ES modules need `http://`, not `file://`). Three.js loads from jsDelivr via an importmap; there is no build step. `serve.py` is a plain static server that sends `Cache-Control: no-store`; with `python3 -m http.server` Chrome will happily keep stale modules across reloads and you end up hard-refreshing after every edit.

Levels: `?level=gallery` (default, the whole kit laid out) or `?level=sample` (a small connected loop with a ramp). `?pose=x,y,z,yaw,pitch` frames a still with the overlay hidden.

## Controls

`E S D F` or arrows to move, `Shift` to run, hold `A` to lift off like a helicopter (it spools up over about a second, and when released you sink gently until you touch down), mouse to look, `Esc` to release.

## The cube

`CELL = 6` units. Floor at local `y = 0`, ceiling at `y = 6`, walls at `±3`. Openings are fixed: wall doorways are `2.4` wide by `3.6` tall, centred; floor and ceiling holes are `2.4` squares, centred. All geometry faces inward only, so from outside a cube you look straight through into it, which is what makes the gallery readable without a cutaway mode.

## Section kit (`src/sections.js`)

| Type | Openings (rot 0) | Notes |
| --- | --- | --- |
| `corridor` | n s | |
| `corner` | n e | |
| `tee` | n s e | corridor, one side open |
| `cross` | n e s w | corridor, both sides open |
| `end` | n | dead end |
| `ramp` | s up | slab from the south doorsill up through the ceiling hole (about 55°) |
| `shaft` | up down | vertical pass-through (fall only; no climbing yet) |
| `pit` | n down | dead end over a drop |
| `well` | n s down | corridor with a floor hole |
| `cap` | n s up | corridor with a ceiling hole |

Each type also exists as a `cave-` variant (`cave-corridor`, `cave-ramp`, and so on) with the same openings but none of the box. A cave section is carved, not assembled: `src/caves.js` writes a signed distance field (negative is air) made of an elliptical tube from every wall opening to the centre, a round shaft from every floor or ceiling opening, a sphere chamber wherever three or more meet, three octaves of value noise that pinch and swell the passage, and small spheres and capsules added back as rubble and stalactites. The `cave-ramp` carves its slope as solid rock instead of using the slab. Marching cubes (Three.js's `MarchingCubes` addon, 30³ samples per cell) turns the field into one flat-shaded, inward-facing mesh.

Two rules keep cave sections connectable. Noise fades to zero within `1.3` units of any open face, so a tube mouth at the cell boundary is always the same fixed ellipse (`3.2` wide, floor to `3.4`) or circle (radius `1.3`) and lines up with the neighbour's. A `0.15` shell of rock is forced along every closed face, pierced only by the exact mouth shape, so air never leaks out of the cube. Cave and flat sections can be placed next to each other and are passable, but their mouths are different shapes, so the join looks rough and a flat wall offers no collision from the cave side.

`n` is `-z`, `e` is `+x`. `rot` is quarter turns clockwise seen from above (0 to 3); wall openings rotate, `up`/`down` do not. `rotatedOpenings( type, rot )` gives the world-facing set.

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

Cells are in grid units (world position is `cell * CELL`). `spawn` may be fractional; `yaw` is radians, `0` faces north. `ground` adds a flat plane at `y = 0`; `labels` hangs a type/blurb sprite in front of each cell unless that cell sets `label: false`. `view` is the draw distance in cells (default 5): cells further than that from the player are hidden, and unless `fog` is given the fog density is set so the cut-off is already invisible.

On load, every opening is checked against its neighbour. A face that opens into a closed face logs a `console.warn` naming both cells.

## Movement (`src/main.js`)

Raycast collision against the section meshes: two horizontal rays at knee and chest height block walls, a downward ray from step height finds the floor and follows ramps up and down, an upward ray stops you at ceilings, and gravity takes over at holes. Lifting with `A` cancels gravity while held and ramps up to 3.2 m/s. Because faces are inward-only, collision also only works from inside a cube; walking into a cube from outside passes through its wall. Fall below `y = -40` and you respawn.

## Performance

No shadow maps. Pixel ratio is capped at 1.5. The only lights are the headlamp and a dim hemisphere fill. Collision rays only test the meshes of the 3×3×3 block of cells around the player. Cave fields are sampled at 30³, which keeps a cave cell at roughly 3–6k triangles; the console reports build time and the triangle count in view.

## Files

| File | Purpose |
| --- | --- |
| `src/sections.js` | Cube constants, the kit table, and the section builders |
| `src/level.js` | JSON loading, placing cells, connectivity check, labels, ground |
| `src/materials.js` | Canvas-generated rock colour and bump maps, smooth and flat-shaded sets |
| `src/noise.js` | Seeded RNG (random number generator) and 3D value noise |
| `src/caves.js` | Signed distance field and marching-cubes mesh for `cave-` sections |
| `src/main.js` | Renderer, headlamp, pointer-lock controls, collision, HUD (heads-up display) |
| `src/style.css` | Entry sheet, survey log, crosshair |
| `levels/gallery.json` | Flat kit in the front row, cave variants staggered behind, vertical partners stacked |
| `levels/sample.json` | Small connected loop of cave sections using rotation and a ramp |
