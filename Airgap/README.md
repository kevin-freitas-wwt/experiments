# Airgap

## Concept

Airgap rewrites your text in a chosen tone entirely on-device, using Chrome's built-in Prompt API (Gemini Nano). A live network monitor counts every request the page fires since load and during each rewrite — it should stay at zero, proving the model runs locally with no server round-trip.

Design direction: "technical mono" — monochrome, monospaced, single accent color, terminal-inspired. Chosen to match the subject matter (a machine doing local inference) rather than reuse a prior experiment's look.

## Tech Stack

- **Prompt API** (`LanguageModel.create()` / `session.promptStreaming()`) — on-device Gemini Nano inference
- **PerformanceObserver** — watches `resource` timing entries to verify zero network calls
- Plain HTML/CSS/JS, no build step, no dependencies

## Requirements

- Chrome 138+ on desktop (Windows, macOS, Linux, or Chromebook Plus)
- ~22 GB free disk space for the model on first download
- Not supported in Firefox, Safari, Edge, or on mobile

## Getting Started

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 5173
```

If the model isn't downloaded yet, the first rewrite triggers the download (shown as a progress bar) — this is the only network activity Airgap ever causes.
