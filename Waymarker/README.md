# Waymarker

A browser-based AR peak-finder. Hold your phone up, pan across the horizon, and
labelled markers name the mountains around you. Built with plain HTML/CSS/JS — no
build step, no framework.

## Run locally

Device sensors (Geolocation, DeviceOrientation) require a **secure context**, so
serve the folder over HTTPS or `localhost`:

```
npx serve .
```

Then open the printed URL. On a laptop, choose **Try it without sensors** to drive
the view with the mouse (drag to look around, edit lat/lon/alt). On a phone, choose
**Use my location & compass** — iOS will prompt for motion + location access.

To test on a phone you need HTTPS; the simplest path is a deploy:

```
vercel
```

## How it works

| File | Responsibility |
| --- | --- |
| `js/geomath.js` | Great-circle distance/bearing, curvature-corrected elevation angle |
| `js/geo.js` | Geolocation watch |
| `js/orientation.js` | DeviceOrientation → heading + pitch (orientation-independent) |
| `js/render.js` | Canvas: compass strip, ticks, peak markers |
| `js/main.js` | Wiring, render loop, simulation mode |
| `data/peaks.json` | Bundled peak dataset |

Heading scrolls the scene horizontally; pitch (accelerometer tilt) moves the horizon
vertically. Each peak is placed at its compass bearing, with the marker height set by
its elevation angle above the horizon.

## Adding peaks

Append objects to `data/peaks.json`:

```json
{ "name": "Mt. Example", "lat": 47.0, "lon": -121.0, "elevation": 2500 }
```

`elevation` is in metres. The current set covers notable named WA + OR summits above
5000 ft (~1524 m).
