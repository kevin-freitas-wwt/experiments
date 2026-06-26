const PALETTE = [ "#c45", "#e94", "#ed0", "#5b5", "#2cb", "#09c", "#817", "#a35", "#9d5", "#36b", "#639", "#c66", "#27c", "#aaa" ];

const DATASETS = [
    {
        id: "teams",
        title: "Team movement",
        caption: "Tracks are teams at a company, members are employees. Teams have a lifespan (Data Platform spins up in 2018, Design Systems in 2019, and Growth is folded into other teams in a 2023 reorg); tenures running past a team's life are clamped to it. Node height is the team's headcount, and someone can sit on two teams at once.",
        start: 2016,
        end: 2026,
        tracks: [
            { id: "platform", name: "Platform", start: 2016, end: 2026, location: { city: "San Francisco", state: "CA", country: "USA" } },
            { id: "mobile", name: "Mobile", start: 2016, end: 2026, location: { city: "Austin", state: "TX", country: "USA" } },
            { id: "infra", name: "Infrastructure", start: 2016, end: 2026, location: { city: "Dublin", state: "Leinster", country: "Ireland" } },
            { id: "growth", name: "Growth", start: 2017, end: 2023, location: { city: "New York", state: "NY", country: "USA" } },
            { id: "data", name: "Data Platform", start: 2018, end: 2026, location: { city: "Denver", state: "CO", country: "USA" } },
            { id: "design", name: "Design Systems", start: 2019, end: 2026, location: { city: "Berlin", state: "Berlin", country: "Germany" } }
        ],
        members: [
            { name: "Maya Chen", tenures: [ { track: "platform", start: 2016, end: 2020 }, { track: "infra", start: 2020, end: 2026 } ] },
            { name: "Jordan Ellis", tenures: [ { track: "platform", start: 2016, end: 2019 }, { track: "growth", start: 2019, end: 2023 }, { track: "data", start: 2023, end: 2026 } ] },
            { name: "Sofia Marino", tenures: [ { track: "mobile", start: 2016, end: 2022 }, { track: "design", start: 2019, end: 2024 }, { track: "platform", start: 2024, end: 2026 } ] },
            { name: "Liam Park", tenures: [ { track: "infra", start: 2016, end: 2021 }, { track: "platform", start: 2021, end: 2026 } ] },
            { name: "Priya Nair", tenures: [ { track: "growth", start: 2017, end: 2023 }, { track: "mobile", start: 2023, end: 2026 } ] },
            { name: "Diego Santos", tenures: [ { track: "data", start: 2018, end: 2024 }, { track: "infra", start: 2022, end: 2026 } ] },
            { name: "Ava Koch", tenures: [ { track: "design", start: 2019, end: 2026 } ] },
            { name: "Noah Reed", tenures: [ { track: "platform", start: 2016, end: 2018 }, { track: "mobile", start: 2018, end: 2025 }, { track: "growth", start: 2021, end: 2023 }, { track: "data", start: 2025, end: 2026 } ] },
            { name: "Hana Sato", tenures: [ { track: "infra", start: 2016, end: 2019 }, { track: "data", start: 2018, end: 2026 } ] },
            { name: "Omar Haddad", tenures: [ { track: "growth", start: 2017, end: 2023 }, { track: "platform", start: 2023, end: 2026 } ] }
        ]
    }
];

DATASETS.forEach( ( d ) => d.tracks.forEach( ( t, i ) => ( t.color = PALETTE[ i % PALETTE.length ] ) ) );
