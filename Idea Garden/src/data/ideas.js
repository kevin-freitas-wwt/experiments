const UNSPLASH = "https://images.unsplash.com/photo-";
const PARAMS = "?w=640&h=384&fit=crop&q=80&auto=format";

// Unsplash photo IDs used as stand-in card art until real imagery is supplied.
function img( id ) {
    return UNSPLASH + id + PARAMS;
}

export const ideas = [
    {
        id: 'seed-of-doubt',
        title: 'Seed Of Doubt',
        text: 'A question you never asked aloud. Plant it anyway and see what unfamiliar thing pushes through the soil.',
        hue: 12,
        image: img( '1444392061186-9fc38f84f726' )
    },
    {
        id: 'unfinished-melody',
        title: 'Unfinished Melody',
        text: 'Four bars hummed in a parking lot. The rest of the song is still waiting for you to come back.',
        hue: 45,
        image: img( '1469474968028-56623f02e42e' )
    },
    {
        id: 'compost-of-failures',
        title: 'Compost Of Failures',
        text: 'Every abandoned draft rots into richer ground. What grows next is fed by what you let go.',
        hue: 88,
        image: img( '1465146344425-f00d5f5c8f07' )
    },
    {
        id: 'tender-shoots',
        title: 'Tender Shoots',
        text: 'A half-formed thought, pale and uncertain. Shield it from judgment until it is strong enough to stand.',
        hue: 130,
        image: img( '1416879595882-3373a0480b5b' )
    },
    {
        id: 'curiosity-vine',
        title: 'Curiosity Vine',
        text: 'It climbs wherever you let your attention wander, reaching for the next bright window of wonder.',
        hue: 168,
        image: img( '1502082553048-f009c37129b9' )
    },
    {
        id: 'dormant-bulb',
        title: 'Dormant Bulb',
        text: 'An idea sleeping underground through your busy season. Trust that spring will remember to wake it.',
        hue: 205,
        image: img( '1485470733090-0aae1788d5af' )
    },
    {
        id: 'wild-tangent',
        title: 'Wild Tangent',
        text: 'The detour that became the whole point. Let the strange branch grow toward its own odd sun.',
        hue: 250,
        image: img( '1441974231531-c6227db76b6e' )
    },
    {
        id: 'pressed-flower',
        title: 'Pressed Flower',
        text: 'A thought worth revisiting, kept between pages. Open the book later and it still holds its color.',
        hue: 295,
        image: img( '1490750967868-88aa4486c946' )
    },
    {
        id: 'late-bloom',
        title: 'Late Bloom',
        text: 'The project you set aside is opening now, in its own time, more vivid for having made you wait.',
        hue: 335,
        image: img( '1447752875215-b2761acb3c5d' )
    }
];
