# Strata

An endless voxel landscape that is generated as you walk through it. One seed word grows the same continents, forests and seas every time, in every direction.

Live: https://kevin-freitas-wwt.github.io/experiments/Strata/

## Running

ES modules and workers need `http://`, not `file://`:

```bash
python3 -m http.server 8765      # from the experiments folder
```

Open http://localhost:8765/Strata/. Three.js loads from jsDelivr via an importmap; there is no build step.

URL parameters: `?seed=word` picks a world, `?r=11` sets the view distance in chunks (4 to 14), `?keys=esdf` swaps WASD for ESDF, and `?pose=x,y,z,yaw,pitch` frames a still with the overlay hidden (used for the thumbnail).

## How it is made

The world is split into 16×16 columns, 128 blocks tall. Each chunk is built in a Web Worker (a pool of up to four) from nothing but its coordinates and the seed:

1. **Column heights.** A low-frequency value-noise FBM (fractal Brownian motion) decides continent vs. sea; a ridged multifractal adds mountains only where the continent term is strong; a short-wavelength FBM adds roll. The continent field is offset per seed so the origin always lands a few blocks above sea level near a coast.
2. **Biomes.** Temperature (noise minus altitude) and moisture (noise) pick one of nine terrains: open sea, shore, plains, forest, dry basin, tundra, taiga, highlands, snowfield. Each has its own surface stack and tree density.
3. **Trees.** A per-column hash places broadleaf canopies or conifers. The worker generates a 3-block apron around every chunk so trees straddling a boundary are complete on both sides.
4. **Meshing.** Only faces that touch air or water are emitted, each with a palette colour, a face shade, a per-block jitter and baked vertex ambient occlusion (the classic 0-to-3 corner count). Water is a single sheet of top faces, drawn translucent in a second pass. Positions, colours, normals and indices come back as transferable buffers.

The main thread keeps a ring of chunks around the player, installs at most three new chunks per frame, and drops anything more than two chunks outside the ring. Movement is a swept AABB (axis-aligned bounding box) against the block grid with walking, running, jumping, swimming and a free-flight toggle.

## Palette

Woodblock-print tones: Prussian-blue water, cream mist on the horizon, ochre sand, muted mosses, a vermilion seed stamp. The HUD (heads-up display) is a serif survey card; the seal in the corner is the numeric seed.

## Files

| File | Role |
| --- | --- |
| `src/noise.js` | hash, value noise, FBM, ridged noise |
| `src/blocks.js` | block ids, palette, biome names, constants |
| `src/worker.js` | terrain generation and meshing |
| `src/world.js` | chunk ring, worker pool, block queries |
| `src/player.js` | input, physics, camera |
| `src/main.js` | scene, sky, lights, HUD, URL parameters |
