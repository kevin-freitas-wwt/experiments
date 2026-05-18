export const BLEND_MODES = [
    { value: 'normal',      label: 'Normal',             group: 'Basic' },
    { value: 'average',     label: 'Average',            group: 'Basic' },
    { value: 'lighten',     label: 'Lighten',            group: 'Lighten' },
    { value: 'screen',      label: 'Screen',             group: 'Lighten' },
    { value: 'colorDodge',  label: 'Color Dodge',        group: 'Lighten' },
    { value: 'linearDodge', label: 'Linear Dodge (Add)', group: 'Lighten' },
    { value: 'darken',      label: 'Darken',             group: 'Darken' },
    { value: 'multiply',    label: 'Multiply',           group: 'Darken' },
    { value: 'colorBurn',   label: 'Color Burn',         group: 'Darken' },
    { value: 'linearBurn',  label: 'Linear Burn',        group: 'Darken' },
    { value: 'overlay',     label: 'Overlay',            group: 'Contrast' },
    { value: 'softLight',   label: 'Soft Light',         group: 'Contrast' },
    { value: 'hardLight',   label: 'Hard Light',         group: 'Contrast' },
    { value: 'difference',  label: 'Difference',         group: 'Inversion' },
    { value: 'exclusion',   label: 'Exclusion',          group: 'Inversion' },
    { value: 'divide',      label: 'Divide',             group: 'Inversion' }
]

export function getBlendGlsl( mode ) {
    switch (mode) {
        case 'normal':
            return `vec3 blend( vec3 base, vec3 src ) { return src; }`

        case 'average':
            return `vec3 blend( vec3 base, vec3 src ) { return (base + src) * 0.5; }`

        case 'multiply':
            return `vec3 blend( vec3 base, vec3 src ) { return base * src; }`

        case 'screen':
            return `vec3 blend( vec3 base, vec3 src ) { return 1.0 - (1.0 - base) * (1.0 - src); }`

        case 'overlay':
            return `
float overlayChannel( float b, float s ) {
    return b < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
}
vec3 blend( vec3 base, vec3 src ) {
    return vec3(
        overlayChannel( base.r, src.r ),
        overlayChannel( base.g, src.g ),
        overlayChannel( base.b, src.b )
    );
}`

        case 'softLight':
            return `
float softLightChannel( float b, float s ) {
    if (s <= 0.5) {
        return b - (1.0 - 2.0 * s) * b * (1.0 - b);
    } else {
        float d = b <= 0.25
            ? ((16.0 * b - 12.0) * b + 4.0) * b
            : sqrt( b );
        return b + (2.0 * s - 1.0) * (d - b);
    }
}
vec3 blend( vec3 base, vec3 src ) {
    return vec3(
        softLightChannel( base.r, src.r ),
        softLightChannel( base.g, src.g ),
        softLightChannel( base.b, src.b )
    );
}`

        case 'hardLight':
            return `
float hardLightChannel( float b, float s ) {
    return s < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
}
vec3 blend( vec3 base, vec3 src ) {
    return vec3(
        hardLightChannel( base.r, src.r ),
        hardLightChannel( base.g, src.g ),
        hardLightChannel( base.b, src.b )
    );
}`

        case 'colorDodge':
            return `
float colorDodgeChannel( float b, float s ) {
    return s >= 1.0 ? 1.0 : min( 1.0, b / (1.0 - s) );
}
vec3 blend( vec3 base, vec3 src ) {
    return vec3(
        colorDodgeChannel( base.r, src.r ),
        colorDodgeChannel( base.g, src.g ),
        colorDodgeChannel( base.b, src.b )
    );
}`

        case 'colorBurn':
            return `
float colorBurnChannel( float b, float s ) {
    return s <= 0.0 ? 0.0 : max( 0.0, 1.0 - (1.0 - b) / s );
}
vec3 blend( vec3 base, vec3 src ) {
    return vec3(
        colorBurnChannel( base.r, src.r ),
        colorBurnChannel( base.g, src.g ),
        colorBurnChannel( base.b, src.b )
    );
}`

        case 'linearDodge':
            return `vec3 blend( vec3 base, vec3 src ) { return min( base + src, vec3(1.0) ); }`

        case 'linearBurn':
            return `vec3 blend( vec3 base, vec3 src ) { return max( base + src - 1.0, vec3(0.0) ); }`

        case 'darken':
            return `vec3 blend( vec3 base, vec3 src ) { return min( base, src ); }`

        case 'lighten':
            return `vec3 blend( vec3 base, vec3 src ) { return max( base, src ); }`

        case 'difference':
            return `vec3 blend( vec3 base, vec3 src ) { return abs( base - src ); }`

        case 'exclusion':
            return `vec3 blend( vec3 base, vec3 src ) { return base + src - 2.0 * base * src; }`

        case 'divide':
            return `
float divideChannel( float b, float s ) {
    return s == 0.0 ? 1.0 : min( b / s, 1.0 );
}
vec3 blend( vec3 base, vec3 src ) {
    return vec3(
        divideChannel( base.r, src.r ),
        divideChannel( base.g, src.g ),
        divideChannel( base.b, src.b )
    );
}`
    }
}
