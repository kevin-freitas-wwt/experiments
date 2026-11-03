# Strata

An endless voxel landscape that is generated as you walk through it, and a small solar system above it. One seed word grows the same continents, forests and seas every time, hangs the same five planets, asteroid belt and ships overhead, and everything is rendered in more detail the closer you get.

Live: https://kevin-freitas-wwt.github.io/experiments/Strata/

## Running

ES modules and workers need `http://`, not `file://`:

```bash
python3 -m http.server 8765      # from the experiments folder
```

Open http://localhost:8765/Strata/. Three.js loads from jsDelivr via an importmap; there is no build step.

URL parameters: `?seed=word` picks a world, `?r=11` sets the detail radius in chunks (4 to 14; it also scales the heightfield ranges and the distances at which planets and asteroids step up in detail), `?crumb=8` sets breadcrumb spacing in metres, and `?pose=x,y,z,yaw,pitch` frames a still with the overlay hidden (used for the thumbnail).

## How it is made

The world is split into 16×16 columns, 128 blocks tall. Each chunk is built in a Web Worker (a pool of up to four) from nothing but its coordinates and the seed:

1. **Column heights.** A low-frequency value-noise FBM (fractal Brownian motion) decides continent vs. sea; a ridged multifractal adds mountains only where the continent term is strong; a short-wavelength FBM adds roll. The continent field is offset per seed so the origin always lands a few blocks above sea level near a coast.
2. **Biomes.** Temperature (noise minus altitude) and moisture (noise) pick one of nine terrains: open sea, shore, plains, forest, dry basin, tundra, taiga, highlands, snowfield. Each has its own surface stack and tree density.
3. **Trees.** A per-column hash places broadleaf canopies or conifers. The worker generates a 3-block apron around every chunk so trees straddling a boundary are complete on both sides.
4. **Meshing.** Only faces that touch air or water are emitted, each with a palette colour, a face shade, a per-block jitter and baked vertex ambient occlusion (the classic 0-to-3 corner count). Water is a single sheet of top faces, drawn translucent in a second pass. Positions, colours, normals and indices come back as transferable buffers.

The main thread keeps a ring of chunks around the player, installs at most three new chunks per frame, and drops anything more than two chunks outside the ring. Above 400 m the ring stops following you; the ground beyond it is carried by two levels of heightfield tiles from the same column function (256 m tiles at 8 m steps out to 3 km, 4 km tiles at 128 m steps out to 40 km), each tile hidden once the finer level fully covers it, with a plain sea disc under everything. There is no fog. Instead a vertex shader drops every ground vertex by d²/2R (R = 90 km), so a horizon appears as you climb and the flat world reads as a small planet from orbit.

## Space

Past 1.5 km the sky thins to black and stars fade in. The same seed places five planets (gas giant with rings, lush, icy, rocky, ember) 36 to 110 km out, each an icosphere displaced and coloured by 3D noise in a worker at four detail levels (320 to 327,680 triangles) chosen by distance over radius, and within 1.6 radii a 97×97 high-resolution patch of the same surface function is regenerated under you as you move. Within 220 m of the ground the planet becomes voxels: a tangent-plane shell (the same chunk pipeline as the home world, fed by the planet's surface function through a gnomonic projection, with column heights following the true sphere) is attached to the planet with its own frame, so gravity points at the planet's centre and you can land, walk and jump. The shell re-centres every 64 m you move and dissolves when you climb above 350 m. Lush worlds get grass, forest and seas; icy ones snow over ice with frozen seas; ember worlds basalt and rust around lava seas; rocky ones highlands and dry basins. Gas giants have no surface. The smooth planet mesh is dithered away under the shell so the two never fight. Detail changes everywhere cross-fade with hashed alpha rather than popping, and the seams between voxel ring, fine tiles and coarse tiles are dithered over a band rather than cut. 110 asteroids, 80 of them in the gas giant's ring plane, are low-poly instances until you come within a few kilometres, when each is generated as a voxel blob and meshed with the same ambient-occlusion mesher as the ground. Thirteen procedural voxel ships in three classes (skiffs, mid-size hulls with wings, and capital ships with a bridge tower and four engines, up to 650 m long) orbit the planets, and three ring stations, each generated from a torus, a hub, spokes and solar panels, orbit the inner three.

Flight speed scales with clearance: 14 m/s on the deck, growing by that much again for every 120 m of height or distance to the nearest planet surface, up to 9 km/s (`Shift` triples it). Space is under a minute away and the same rule slows you down again on approach, so you can land on a planet without overshooting; planets are solid, nothing else is. Movement on the ground is a swept AABB (axis-aligned bounding box) against the block grid: `E S D F` to walk, `Shift` to sprint, `A` to jump or rise, `Z` to descend, `V` to toggle flight. `B` turns on breadcrumbs, bright red dots dropped every few metres (spacing from the start card or `?crumb=`) so a route can be retraced; `X` clears them. `1` to `5` jump to a planet, `6` to the nearest asteroid, `7` to the nearest ship, `8` to the nearest station and `0` home; the same list sits under Travel on the start card.

## Palette

Woodblock-print tones: Prussian-blue water, cream mist on the horizon, ochre sand, muted mosses, a vermilion seed stamp. The HUD (heads-up display) is a serif survey card; the seal in the corner is the numeric seed.

## Files

| File | Role |
| --- | --- |
| `src/noise.js` | hash, value noise, FBM, ridged noise |
| `src/blocks.js` | block ids, palette, biome names, constants |
| `src/worker.js` | terrain generation and meshing, heightfield tiles, planet spheres, asteroid and ship voxels |
| `src/pool.js` | priority worker pool shared by everything below |
| `src/world.js` | chunk ring, block queries (home world or a planet shell) |
| `src/shell.js` | a ground frame: the home plane or a tangent-plane voxel shell attached to a planet |
| `src/far.js` | heightfield tile levels and the sea disc |
| `src/planet.js` | planet surface function shared by worker (meshes) and main thread (collision) |
| `src/space.js` | planets, LOD and near-surface patches, asteroids, ships, stars, sun |
| `src/materials.js` | shared materials, horizon-curvature and edge-dither shader patch, hashed-alpha fade-ins |
| `src/player.js` | input, physics, camera, moving between frames |
| `src/crumbs.js` | breadcrumb trail (one InstancedMesh, unfogged so it reads at distance) |
| `src/main.js` | scene, sky, lights, HUD, URL parameters |
