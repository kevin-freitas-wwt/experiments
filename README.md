# experiments

A small collection of standalone web experiments. Each lives in its own
folder and runs as static HTML/CSS/JS — open the folder's `index.html`
locally, or visit the live site at
**[kevin-freitas-wwt.github.io/experiments](https://kevin-freitas-wwt.github.io/experiments/)**.

## Projects

- **[Latch](https://kevin-freitas-wwt.github.io/experiments/Latch/)** — six working UI mechanisms with zero script tags: anchored callouts, `:has()` state, typed properties, scoped styles, discrete transitions, routed panels. Every one verified in headless Firefox *and* Chromium
- **[Panes](https://kevin-freitas-wwt.github.io/experiments/Panes/)** — one aquarium spread across every browser window on your desktop; fish live in real screen coordinates, so dragging a window pushes the water
- **[Roomtone](https://kevin-freitas-wwt.github.io/experiments/Roomtone/)** — a reading surface that reshapes itself to the sound of the room; silence lets it bloom, typing strips it back, a nearby voice blurs anything private
- **[Choreo](https://kevin-freitas-wwt.github.io/experiments/Choreo/)** — Swiss editorial page choreographed entirely in CSS: scroll timelines, anchored footnotes, cross-document view transitions, zero script tags
- **[Airgap](https://kevin-freitas-wwt.github.io/experiments/Airgap/)** — on-device text rewriter using Chrome's built-in Gemini Nano, with a live monitor proving zero network requests
- **[Pop o'Clock](https://kevin-freitas-wwt.github.io/experiments/Pop%20o'Clock/)** — clock with audible pop ticks
- **[Pic Shop](https://kevin-freitas-wwt.github.io/experiments/Pic%20Shop/)** — image editor
- **[Pixel Pics](https://kevin-freitas-wwt.github.io/experiments/Pixel%20Pics/)** — pixel art tool
- **[Vid Stacker Web](https://kevin-freitas-wwt.github.io/experiments/Vid%20Stacker%20Web/)** — web version of the Vid Stacker frame stacker
- **[Innertris](https://kevin-freitas-wwt.github.io/experiments/Innertris/)** — first-person Tetris, fly into the well and bump pieces to move them, fire a laser to spin them

## Adding a new project

1. Drop a new folder at the repo root containing an `index.html`.
2. Add a link to it in the root `index.html`.
3. Commit and push — GitHub Pages picks it up automatically.
