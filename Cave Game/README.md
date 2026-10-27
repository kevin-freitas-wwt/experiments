# Cave Game

First-person cave kit. Levels are JSON (JavaScript Object Notation) grids; every section primitive fits the same bounding cube, so any two sections that both open onto a shared face line up automatically.

Not listed on the experiments index.

## Running

```bash
python3 -m http.server 5173
```

Open http://localhost:5173 (ES modules need `http://`, not `file://`). Three.js loads from jsDelivr via an importmap; there is no build step.

Levels: `?level=gallery` (default, the whole kit laid out) or `?level=sample` (a small connected loop with a ramp). `?pose=x,y,z,yaw,pitch` frames a still with the overlay hidden.

## Controls

`E S D F` or arrows to move, `Shift` to run, `Space` to jump, hold `A` to lift off like a helicopter (release and you sink gently until you touch down), mouse to look, `Esc` to release.

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

Each type also exists as a `cave-` variant (`cave-corridor`, `cave-ramp`, and so on) with the same openings. Cave panels are subdivided (`0.4` unit segments), pushed into the room by two octaves of value noise, and flat-shaded so the facets read as rock. Displacement fades to zero within `0.9` units of every panel edge, so cube boundaries and doorways stay exactly where the flat kit puts them and cave sections connect to flat ones. Each cave cell is also dressed with stalagmites, rubble and stalactites, seeded from its grid position, kept near the walls and out of door lanes, and under knee height on the floor so they never block movement.

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

Cells are in grid units (world position is `cell * CELL`). `spawn` may be fractional; `yaw` is radians, `0` faces north. `ground` adds a flat plane at `y = 0`; `labels` hangs a type/blurb sprite in front of each cell unless that cell sets `label: false`.

On load, every opening is checked against its neighbour. A face that opens into a closed face logs a `console.warn` naming both cells.

## Movement (`src/main.js`)

Raycast collision against the section meshes: two horizontal rays at knee and chest height block walls, a downward ray from step height finds the floor and follows ramps up and down, an upward ray stops you at ceilings, and gravity takes over at holes. Jumping needs ground under you; lifting with `A` does not and cancels gravity while held. Because faces are inward-only, collision also only works from inside a cube; walking into a cube from outside passes through its wall. Fall below `y = -40` and you respawn.

## Files

| File | Purpose |
| --- | --- |
| `src/sections.js` | Cube constants, the kit table, and the section builders |
| `src/level.js` | JSON loading, placing cells, connectivity check, labels, ground |
| `src/materials.js` | Canvas-generated rock colour and bump maps, smooth and flat-shaded sets |
| `src/noise.js` | Seeded RNG (random number generator) and 2D value noise |
| `src/main.js` | Renderer, headlamp, pointer-lock controls, collision, HUD (heads-up display) |
| `src/style.css` | Entry sheet, survey log, crosshair |
| `levels/gallery.json` | Flat kit in the front row, cave variants staggered behind, vertical partners stacked |
| `levels/sample.json` | Small connected loop of cave sections using rotation and a ramp |
