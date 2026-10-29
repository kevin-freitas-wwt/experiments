import re, collections

GENERIC = set( "cafe diner grill pizza pizzeria bakery deli kitchen bistro tavern pub saloon lounge express buffet steakhouse seafood bbq barbecue sushi taqueria cantina bar eatery grille".split() )

def norm( n ):
    n = ( n or "" ).lower()
    n = re.sub( r"[’`]", "'", n )
    n = re.sub( r"\s*[#(\-–|]\s*\d.*$", "", n )
    n = re.sub( r"[^a-z0-9& ]", "", n )
    n = re.sub( r"\b(the|restaurant|restaurants|inc|llc|co)\b", "", n )
    return re.sub( r"\s+", " ", n ).strip()

def chain_set( names ):
    c = collections.Counter( norm( n ) for n in names )
    out = set()
    for k, v in c.items():
        if not k or len( k ) < 4: continue
        words = k.split()
        if len( words ) == 1 and ( k in GENERIC or v < 150 ): continue
        if len( words ) > 1 and all( w in GENERIC for w in words ): continue
        if v >= 40: out.add( k )
    return out, c
