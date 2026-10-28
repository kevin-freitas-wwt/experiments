import duckdb, json, os, sys
sys.path.insert( 0, os.path.dirname( __file__ ) )
from groups import GROUPS, group, group_from_name

con = duckdb.connect()
def grp( label, name ):
    g = group( label or "" )
    return group_from_name( name ) if g == 0 else g
con.create_function( "grp", grp, [ str, str ], int )
con.execute( """
    CREATE TABLE r AS
    SELECT name, round( lat, 5 ) lat, round( lng, 5 ) lng, address, locality, region,
           CASE WHEN regexp_matches( postcode, '^\\d{5}' ) THEN postcode[1:5] ELSE '' END z,
           grp( cats[1], name ) g
    FROM 'data/us_restaurants.parquet'
    WHERE lat BETWEEN -15 AND 72 AND lng BETWEEN -180 AND -64
""" )

fc = open( "data/clusters.geojsonl", "w" )
fp = open( "data/points.geojsonl", "w" )
n = 0
for name, lat, lng, addr, city, region, z, g in con.execute( "SELECT * FROM r" ).fetchall():
    geom = { "type": "Point", "coordinates": [ lng, lat ] }
    fc.write( json.dumps( { "type": "Feature", "geometry": geom, "properties": { "g": g, f"c{g}": 1 } }, separators=( ",", ":" ) ) + "\n" )
    a = ", ".join( [ s for s in [ addr, city, region ] if s ] )
    fp.write( json.dumps( { "type": "Feature", "geometry": geom, "properties": { "n": name or "", "a": a, "z": z, "g": g } }, separators=( ",", ":" ) ) + "\n" )
    n += 1
fc.close(); fp.close()

# Per-ZIP stats. Center is the median point; bbox trims the 3% tails so stray geocodes don't stretch it.
zips = {}
for z, cx, cy, w, s, e, nn, t, city, st in con.execute( """
    SELECT z, round( median( lng ), 4 ), round( median( lat ), 4 ),
           round( quantile_cont( lng, 0.03 ), 4 ), round( quantile_cont( lat, 0.03 ), 4 ),
           round( quantile_cont( lng, 0.97 ), 4 ), round( quantile_cont( lat, 0.97 ), 4 ),
           count(*), mode( locality ) FILTER ( locality IS NOT NULL ), mode( region ) FILTER ( region IS NOT NULL )
    FROM r WHERE z <> '' GROUP BY z
""" ).fetchall():
    zips[ z ] = [ cx, cy, [ w, s, e, nn ], t, [ 0 ] * len( GROUPS ), city or "", st or "" ]
for z, g, c in con.execute( "SELECT z, g, count(*) FROM r WHERE z <> '' GROUP BY 1, 2" ).fetchall():
    zips[ z ][4][ g ] = c
totals = [ 0 ] * len( GROUPS )
for g, c in con.execute( "SELECT g, count(*) FROM r GROUP BY 1" ).fetchall():
    totals[ g ] = c
import csv
pop = { r[ "zcta5" ]: int( r[ "totalpopulation" ] ) for r in csv.DictReader( open( "census/places.csv" ) ) if r[ "totalpopulation" ] }
for z, r in zips.items():
    r.append( pop.get( z, 0 ) )
json.dump( { "groups": GROUPS, "totals": totals, "zips": zips }, open( "data/zips.json", "w" ), separators=( ",", ":" ) )
print( n, "features", len( zips ), "zips", sum( totals ) )
