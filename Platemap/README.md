# Platemap

1.45 million US restaurants on one map, filterable by cuisine (26 groups) and by ZIP code. Static site, no build step, no API keys.

## How the scale is handled

- `data/overview.pmtiles` holds two layers: `clusters` (zoom 0 to 11, tippecanoe clusters with a per-cuisine count baked into each circle as `c0`..`c25`, so a cuisine filter re-sizes circles instead of refetching) and `zippoints` (one layer at zoom 9 with only `z` and `g`, used when a ZIP is selected at any zoom).
- `data/heat.pmtiles` is 10 px clusters with the same per-cuisine counts, feeding the heatmap toggle at zoom 0 to 11; the heatmap uses the raw points above that.
- `data/points_w.pmtiles` and `data/points_e.pmtiles` hold every restaurant once at zoom 12 (split at 90°W to stay under file-size limits); MapLibre overzooms them for street level.
- Toggle: `#view=heat` swaps circles and dots for a MapLibre heatmap layer; the cuisine filter still applies through `heatmap-weight`.
- `data/zips.json` has per-ZIP totals by cuisine, a median center, a percentile-trimmed bounding box and the modal city/state, which drives the search and the rail counts.

## Rebuilding the data

Source is Foursquare Open Source Places (Apache 2.0) via the Fused GeoParquet mirror on source.coop, release 2025-01-10 (the 2025-02-06 mirror is missing the Bay Area partition). Steps: DuckDB filter `country = 'US'`, `date_closed IS NULL`, category under `Dining and Drinking > Restaurant`; map categories to groups; tippecanoe for the three tilesets; `tile-join` to PMTiles. `tools/build.sh` runs the whole pipeline (`extract.py`, `groups.py`, `prep.py`).

Attribution: see `data/NOTICE.txt`.
