#!/usr/bin/env bash
# Rebuild Platemap data. Needs: python3 + duckdb, tippecanoe + tile-join on PATH. Run from a scratch dir.
set -euo pipefail
HERE=$( cd "$( dirname "$0" )" && pwd )
R=${RELEASE:-2025-01-10}
mkdir -p data
curl -sS "https://data.source.coop/fused/fsq-os-places/?list-type=2&prefix=$R/places/" \
    | grep -o '<Key>[^<]*\.parquet</Key>' | sed 's#<Key>#https://data.source.coop/fused/#; s#</Key>##' > data/files.txt
python3 -I "$HERE/extract.py"
python3 -I "$HERE/prep.py"
python3 -I - <<'PY'
w = open( "data/points_w.geojsonl", "w" ); e = open( "data/points_e.geojsonl", "w" )
for line in open( "data/points.geojsonl" ):
    lng = float( line.split( '"coordinates":[', 1 )[1].split( ",", 1 )[0] )
    ( w if lng < -90 else e ).write( line )
PY
ACC=$( for i in $( seq 0 25 ); do printf -- "--accumulate-attribute=c$i:sum "; done )
tippecanoe -q -P -o data/clusters.mbtiles -l clusters -Z0 -z11 -r1 --cluster-distance=64 $ACC --force data/clusters.geojsonl
tippecanoe -q -P -o data/zippoints.mbtiles -l zippoints -Z9 -z9 -r1 --no-feature-limit --no-tile-size-limit -y z -y g --force data/points.geojsonl
tile-join -q -o data/overview.pmtiles --force --no-tile-size-limit data/clusters.mbtiles data/zippoints.mbtiles
for h in w e; do
    tippecanoe -q -P -o data/points_$h.mbtiles -l points -Z12 -z12 -r1 --no-feature-limit --no-tile-size-limit --force data/points_$h.geojsonl
    tile-join -q -o data/points_$h.pmtiles --force --no-tile-size-limit data/points_$h.mbtiles
done
echo "copy data/overview.pmtiles data/points_{w,e}.pmtiles data/zips.json into Platemap/data/"
