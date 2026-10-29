import duckdb, json, re, sys, os, csv, math, collections
sys.path.insert( 0, os.path.dirname( os.path.abspath( __file__ ) ) )
from groups import GROUPS, group, group_from_name
from chains import chain_set, norm

STOP = set( "the and of for with inc llc co restaurant restaurants food foods cafe caf bar grill grille kitchen house place eatery shop store company center".split() )
WORD = re.compile( r"[a-z]{3,}" )

con = duckdb.connect()
con.create_function( "grp", lambda label, name: ( lambda g: group_from_name( name ) if g == 0 else g )( group( label or "" ) ), [ str, str ], int )
con.create_function( "inferred", lambda label: group( label or "" ) == 0, [ str ], bool )
con.execute( """
    CREATE TABLE r AS
    SELECT name, round( lat, 5 ) lat, round( lng, 5 ) lng, address, locality, region,
           CASE WHEN regexp_matches( postcode, '^\\d{5}' ) THEN postcode[1:5] ELSE '' END z,
           grp( cats[1], name ) g, inferred( cats[1] ) AND grp( cats[1], name ) <> 0 AS i
    FROM 'data/us_restaurants.parquet'
    WHERE lat BETWEEN -15 AND 72 AND lng BETWEEN -180 AND -64
""" )
rows = con.execute( "SELECT * FROM r" ).fetchall()
chains, _ = chain_set( [ r[0] for r in rows ] )

def cell( lat, lng, z = 8 ):
    n = 2 ** z
    x = int( ( lng + 180 ) / 360 * n )
    y = int( ( 1 - math.log( math.tan( math.radians( lat ) ) + 1 / math.cos( math.radians( lat ) ) ) / math.pi ) / 2 * n )
    return x, y

fc = open( "data/clusters.geojsonl", "w" )
fp = open( "data/points.geojsonl", "w" )
zips = {}
cells = {}
national = collections.Counter()
totals = [ 0 ] * len( GROUPS )
chain_total = 0
for name, lat, lng, addr, city, region, z, g, inf in rows:
    k = 1 if norm( name ) in chains else 0
    chain_total += k
    totals[ g ] += 1
    geom = { "type": "Point", "coordinates": [ lng, lat ] }
    cp = { "g": g, f"c{g}": 1 }
    if k: cp[ "k" ] = 1
    fc.write( json.dumps( { "type": "Feature", "geometry": geom, "properties": cp }, separators=( ",", ":" ) ) + "\n" )
    a = ", ".join( [ s for s in [ addr, city, region ] if s ] )
    pp = { "n": name or "", "a": a, "z": z, "g": g }
    if k: pp[ "k" ] = 1
    if inf: pp[ "i" ] = 1
    fp.write( json.dumps( { "type": "Feature", "geometry": geom, "properties": pp }, separators=( ",", ":" ) ) + "\n" )
    if z:
        zr = zips.setdefault( z, { "c": [ 0 ] * len( GROUPS ), "k": 0, "lng": [], "lat": [], "city": collections.Counter(), "st": collections.Counter() } )
        zr[ "c" ][ g ] += 1; zr[ "k" ] += k
        zr[ "lng" ].append( lng ); zr[ "lat" ].append( lat )
        if city: zr[ "city" ][ city ] += 1
        if region: zr[ "st" ][ region ] += 1
    words = set( w for w in WORD.findall( ( name or "" ).lower() ) if w not in STOP )
    national.update( words )
    cells.setdefault( cell( lat, lng ), collections.Counter() ).update( words )
fc.close(); fp.close()

def q( a, p ):
    i = ( len( a ) - 1 ) * p; lo = math.floor( i ); hi = math.ceil( i )
    return a[ lo ] + ( a[ hi ] - a[ lo ] ) * ( i - lo )
pop = { r[ "zcta5" ]: int( r[ "totalpopulation" ] ) for r in csv.DictReader( open( "census/places.csv" ) ) if r[ "totalpopulation" ] }
out = {}
for z, zr in zips.items():
    lngs = sorted( zr[ "lng" ] ); lats = sorted( zr[ "lat" ] )
    t = sum( zr[ "c" ] )
    out[ z ] = [ round( q( lngs, 0.5 ), 4 ), round( q( lats, 0.5 ), 4 ),
        [ round( q( lngs, 0.03 ), 4 ), round( q( lats, 0.03 ), 4 ), round( q( lngs, 0.97 ), 4 ), round( q( lats, 0.97 ), 4 ) ],
        t, zr[ "c" ], zr[ "city" ].most_common( 1 )[0][0] if zr[ "city" ] else "", zr[ "st" ].most_common( 1 )[0][0] if zr[ "st" ] else "",
        pop.get( z, 0 ), zr[ "k" ] ]
top_words = dict( national.most_common( 4000 ) )
empty = { z: p for z, p in pop.items() if z not in out and p >= 500 }
json.dump( { "groups": GROUPS, "totals": totals, "chains": chain_total, "words": top_words, "empty": empty, "zips": out }, open( "data/zips.json", "w" ), separators=( ",", ":" ) )

with open( "data/words.geojsonl", "w" ) as fw:
    n = 2 ** 8
    for ( x, y ), cnt in cells.items():
        lng = ( x + 0.5 ) / n * 360 - 180
        lat = math.degrees( math.atan( math.sinh( math.pi * ( 1 - 2 * ( y + 0.5 ) / n ) ) ) )
        top = { w: c for w, c in cnt.most_common( 60 ) if w in top_words }
        fw.write( json.dumps( { "type": "Feature", "geometry": { "type": "Point", "coordinates": [ round( lng, 4 ), round( lat, 4 ) ] }, "properties": { "w": json.dumps( top, separators=( ",", ":" ) ), "n": sum( cnt.values() ) } }, separators=( ",", ":" ) ) + "\n" )
print( len( rows ), "features", len( out ), "zips", chain_total, "chain locations", len( cells ), "word cells" )
