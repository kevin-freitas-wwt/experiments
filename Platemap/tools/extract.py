import duckdb, sys
files=open('data/files.txt').read().split()
con=duckdb.connect(); con.execute("INSTALL httpfs; LOAD httpfs; SET threads=8; SET http_retries=5; SET http_timeout=120000;")
lst="[" + ",".join(f"'{f}'" for f in files) + "]"
con.execute(f"""
COPY (
  SELECT fsq_place_id AS id, name, latitude AS lat, longitude AS lng, address, locality, region, postcode,
         list_filter(fsq_category_labels, lambda x: x LIKE 'Dining and Drinking > Restaurant%') AS cats
  FROM read_parquet({lst}, union_by_name=true)
  WHERE country='US' AND date_closed IS NULL AND latitude IS NOT NULL
    AND len(list_filter(fsq_category_labels, lambda x: x LIKE 'Dining and Drinking > Restaurant%'))>0
) TO 'data/us_restaurants.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")
print(con.execute("SELECT count(*) FROM 'data/us_restaurants.parquet'").fetchall())
