# Platemap

1.45 million US restaurants on one map, filterable by cuisine (26 groups) and by ZIP code. Three views: counts (clusters and dots), heat (density, rescaled to what is on screen), and per capita (ZIP choropleth: restaurants per 10k residents, or a cuisine's share versus the national average). Compare two cuisines or two ZIPs, drop a pin for a radius report, find food deserts, color by chain vs. independent, read the words that are over-represented in restaurant names wherever you are, and save a share card. Static site, no build step, no API keys.

## How the scale is handled

- `data/overview.pmtiles` holds two layers: `clusters` (zoom 0 to 11, tippecanoe clusters with a per-cuisine count baked into each circle as `c0`..`c25`, so a cuisine filter re-sizes circles instead of refetching) and `zippoints` (one layer at zoom 9 with only `z` and `g`, used when a ZIP is selected at any zoom).
- `data/heat.pmtiles` is 10 px clusters with the same per-cuisine counts, feeding the heatmap toggle at zoom 0 to 11; the heatmap uses the raw points above that.
- `data/points_w.pmtiles` and `data/points_e.pmtiles` hold every restaurant once at zoom 12 (split at 90°W to stay under file-size limits); MapLibre overzooms them for street level.
- Toggle: `#view=heat` swaps circles and dots for a MapLibre heatmap layer; the cuisine filter still applies through `heatmap-weight`.
- `data/zcta.pmtiles` is Census 2020 ZCTA (ZIP Code Tabulation Area) polygons, zoom 3 to 9, with the ZIP as feature id so per-capita values attach via feature-state at runtime (no data baked into the tiles). Also draws the selected ZIP outline and makes ZIPs clickable.
- `data/words.pmtiles` is one point per z8 tile cell with the top 60 restaurant-name words and counts (`w`, JSON). The "In the names here" strip sums the cells on screen and ranks words by lift against the national word frequencies in `zips.json` (`words`); above zoom 12 it reads the rendered points instead.
- Radius report: `#pin=lng,lat&r=1|3|5`. Reads every z12 point tile the ring touches straight from the archive (`PMTiles.getZxy` + `@mapbox/vector-tile`), so the count is exact regardless of viewport. Nearest of each cuisine, over-representation vs. the US, and the cuisines absent from the ring.
- Chains: a normalized name (`tools/chains.py`) seen 40+ times (single words need 150+ and not a generic food word). Points carry `k=1`; clusters accumulate `k`. 1,213 chains, 302k locations, 20.8% of the data.
- Inferred cuisines carry `i=1` on points; the popup says "guessed from name" and offers a prefilled GitHub issue.
- `data/zips.json` has per-ZIP totals by cuisine, a median center, a percentile-trimmed bounding box, the modal city/state, ACS population (CDC PLACES 2023 release) and chain count; `empty` lists populated ZCTAs with no restaurants at all, which drives the search, the rail counts and the per-capita view.
- Food deserts (per-capita lens): bottom 10% of ZIPs with 1,000+ residents by restaurants per resident, or, with a cuisine selected, ZIPs with 2,000+ residents and none of it.
- Per capita: with no cuisine selected, restaurants per 10,000 residents (ZIPs under 500 residents hidden). With a cuisine selected, the location quotient: local share divided by national share, on a log scale, red above average and blue below (ZIPs under 20 restaurants hidden). In compare, the share of A among A+B.
- "Unspecified" is Foursquare's bare "Restaurant" category. About a quarter of those are recovered by keyword rules on the name (`tools/groups.py`, `NAME_RULES`); the rest sit at the bottom of the rail.
- ZCTAs are not ZIPs: a few restaurants with a given postcode fall outside that ZCTA's polygon. Expected.

## Rebuilding the data

Source is Foursquare Open Source Places (Apache 2.0) via the Fused GeoParquet mirror on source.coop, release 2025-01-10 (the 2025-02-06 mirror is missing the Bay Area partition). Steps: DuckDB filter `country = 'US'`, `date_closed IS NULL`, category under `Dining and Drinking > Restaurant`; map categories to groups; tippecanoe for the three tilesets; `tile-join` to PMTiles. `tools/build.sh` runs the whole pipeline (`extract.py`, `groups.py`, `chains.py`, `prep.py`), including the Census ZCTA shapefile and CDC PLACES population pull.

Attribution: see `data/NOTICE.txt`.
