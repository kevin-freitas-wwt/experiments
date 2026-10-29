#!/usr/bin/env bash
# Rebuild Platemap data. Needs: python3 + duckdb + pyshp, tippecanoe + tile-join on PATH. Run from a scratch dir.
set -euo pipefail
HERE=$( cd "$( dirname "$0" )" && pwd )
R=${RELEASE:-2025-01-10}
mkdir -p data
curl -sS "https://data.source.coop/fused/fsq-os-places/?list-type=2&prefix=$R/places/" \
    | grep -o '<Key>[^<]*\.parquet</Key>' | sed 's#<Key>#https://data.source.coop/fused/#; s#</Key>##' > data/files.txt
mkdir -p census
curl -sSL "https://data.cdc.gov/resource/c7b2-4ecy.csv?\$select=zcta5,totalpopulation&\$limit=50000" -o census/places.csv
curl -sSL -o census/zcta.zip "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip"
( cd census && unzip -oq zcta.zip )
python3 -I "$HERE/extract.py"
python3 -I "$HERE/prep.py"
python3 -I - <<'PY'
w = open( "data/points_w.geojsonl", "w" ); e = open( "data/points_e.geojsonl", "w" )
for line in open( "data/points.geojsonl" ):
    lng = float( line.split( '"coordinates":[', 1 )[1].split( ",", 1 )[0] )
    ( w if lng < -90 else e ).write( line )
PY
ACC="$( for i in $( seq 0 25 ); do printf -- "--accumulate-attribute=c$i:sum "; done ) --accumulate-attribute=k:sum"
tippecanoe -q -P -o data/clusters.mbtiles -l clusters -Z0 -z11 -r1 --cluster-distance=64 $ACC --force data/clusters.geojsonl
tippecanoe -q -P -o data/zippoints.mbtiles -l zippoints -Z9 -z9 -r1 --no-feature-limit --no-tile-size-limit -y z -y g --force data/points.geojsonl
tippecanoe -q -P -o data/heat.mbtiles -l heat -Z0 -z11 -r1 --cluster-distance=10 $ACC --no-tile-size-limit --force data/clusters.geojsonl
tile-join -q -o data/overview.pmtiles --force --no-tile-size-limit data/clusters.mbtiles data/zippoints.mbtiles
tile-join -q -o data/heat.pmtiles --force --no-tile-size-limit data/heat.mbtiles
for h in w e; do
    tippecanoe -q -P -o data/points_$h.mbtiles -l points -Z12 -z12 -r1 --no-feature-limit --no-tile-size-limit --force data/points_$h.geojsonl
    tile-join -q -o data/points_$h.pmtiles --force --no-tile-size-limit data/points_$h.mbtiles
done
python3 -I - <<'PY'
import shapefile, json
r = shapefile.Reader( "census/cb_2020_us_zcta520_500k.shp" )
fields = [ f[0] for f in r.fields[1:] ]
with open( "data/zcta.geojsonl", "w" ) as out:
    for sr in r.iterShapeRecords():
        z = dict( zip( fields, sr.record ) )[ "ZCTA5CE20" ]
        out.write( json.dumps( { "type": "Feature", "id": int( z ), "geometry": sr.shape.__geo_interface__, "properties": { "z": z } }, separators=( ",", ":" ) ) + "\n" )
PY
tippecanoe -q -P -o data/words.mbtiles -l words -Z4 -z8 -r1 --no-feature-limit --no-tile-size-limit --force data/words.geojsonl
tile-join -q -o data/words.pmtiles --force --no-tile-size-limit data/words.mbtiles
tippecanoe -q -P -o data/zcta_lo.mbtiles -l zcta -Z3 -z5 --drop-smallest-as-needed --simplification=10 --detect-shared-borders --force data/zcta.geojsonl
tippecanoe -q -P -o data/zcta_hi.mbtiles -l zcta -Z6 -z9 --no-feature-limit --no-tile-size-limit --simplification=10 --detect-shared-borders --force data/zcta.geojsonl
tile-join -q -o data/zcta.pmtiles --force --no-tile-size-limit data/zcta_lo.mbtiles data/zcta_hi.mbtiles
echo "copy data/overview.pmtiles data/words.pmtiles data/zcta.pmtiles data/heat.pmtiles data/points_{w,e}.pmtiles data/zips.json into Platemap/data/"
