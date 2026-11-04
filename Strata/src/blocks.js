export const AIR = 0, STONE = 1, DIRT = 2, GRASS = 3, SAND = 4, WATER = 5,
    SNOW = 6, LOG = 7, LEAF = 8, NEEDLE = 9, GRAVEL = 10, TUNDRA = 11, CLAY = 12,
    ICE = 13, BASALT = 14, LAVA = 15, RUST = 16, CLOUD = 17,
    PLATE = 18, PANEL = 19, FLOOR = 20, GLASS = 21, LIGHT = 22, CORE = 23, DOOR = 24;

export const CHUNK = 16, HEIGHT = 256, SEA = 46;

export const PALETTE = {
    [ STONE ]:  [ 0x8a, 0x86, 0x7c ],
    [ DIRT ]:   [ 0x7d, 0x5e, 0x44 ],
    [ GRASS ]:  [ 0x6d, 0x8c, 0x4e ],
    [ SAND ]:   [ 0xe0, 0xcb, 0x98 ],
    [ WATER ]:  [ 0x2d, 0x4e, 0x80 ],
    [ SNOW ]:   [ 0xf2, 0xef, 0xe5 ],
    [ LOG ]:    [ 0x55, 0x3d, 0x2c ],
    [ LEAF ]:   [ 0x55, 0x7d, 0x45 ],
    [ NEEDLE ]: [ 0x2f, 0x55, 0x45 ],
    [ GRAVEL ]: [ 0x9a, 0x94, 0x88 ],
    [ TUNDRA ]: [ 0x9a, 0xa0, 0x6a ],
    [ CLAY ]:   [ 0xb4, 0x6a, 0x4a ],
    [ ICE ]:    [ 0xbf, 0xdc, 0xea ],
    [ BASALT ]: [ 0x3a, 0x34, 0x36 ],
    [ LAVA ]:   [ 0xf0, 0x6a, 0x22 ],
    [ RUST ]:   [ 0x8a, 0x4e, 0x3a ],
    [ CLOUD ]:  [ 0xf0, 0xe3, 0xcb ],
    [ PLATE ]:  [ 0xb9, 0xbc, 0xc2 ],
    [ PANEL ]:  [ 0x3a, 0x41, 0x50 ],
    [ FLOOR ]:  [ 0x6b, 0x6f, 0x78 ],
    [ GLASS ]:  [ 0x9c, 0xc8, 0xe8 ],
    [ LIGHT ]:  [ 0xff, 0xf4, 0xd6 ],
    [ CORE ]:   [ 0xff, 0x9a, 0x3a ],
    [ DOOR ]:   [ 0xe0, 0x6a, 0x2a ],
};

export const BIOMES = [ 'open sea', 'shore', 'plains', 'forest', 'dry basin', 'tundra', 'taiga', 'highlands', 'snowfield', 'ember field', 'ice sheet', 'lava sea', 'frozen sea', 'cloud deck', 'interior', 'barren highlands' ];

export function isSolid( b ) {
    return b !== AIR && b !== WATER && b !== LAVA;
}

export function isLiquid( b ) {
    return b === WATER || b === LAVA;
}

export function isOpaque( b ) {
    return isSolid( b ) && b !== GLASS;
}

export function spawnOf( seed ) {
    const x = ( ( seed * 7919 + 1234 ) % 24000 ) - 12000, z = ( ( seed * 104729 + 4321 ) % 24000 ) - 12000;
    return { x: Math.floor( x / 16 ) * 16 + 8, z: Math.floor( z / 16 ) * 16 + 8 };
}
