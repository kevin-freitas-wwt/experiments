/* Main entry point — wires filters, unit toggle, GPS, and submit */

let displayCelsius = true;
let nearMeActive = false;

function detectUseFahrenheit() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        const fahrenheitZones = new Set([
            'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
            'America/Phoenix','America/Anchorage','America/Adak','America/Boise',
            'America/Detroit','America/Menominee',
            'America/Indiana/Indianapolis','America/Indiana/Knox','America/Indiana/Marengo',
            'America/Indiana/Petersburg','America/Indiana/Tell_City','America/Indiana/Vevay',
            'America/Indiana/Vincennes','America/Indiana/Winamac',
            'America/Kentucky/Louisville','America/Kentucky/Monticello',
            'America/North_Dakota/Beulah','America/North_Dakota/Center','America/North_Dakota/New_Salem',
            'America/Nome','America/Sitka','America/Yakutat','America/Metlakatla',
            'Pacific/Honolulu','Pacific/Pago_Pago','America/Puerto_Rico','America/St_Thomas',
            'America/Nassau','America/Cayman',
            'Pacific/Palau','Pacific/Pohnpei','Pacific/Chuuk','Pacific/Kosrae',
            'Pacific/Majuro','Pacific/Kwajalein'
        ]);
        return fahrenheitZones.has( tz );
    } catch ( _e ) {
        return false;
    }
}

let currentFilters = {
    types: ['lake', 'river', 'ocean', 'pond', 'stream'],
    source: 'all',
    dateFrom: '',
    dateTo: '',
    tempMin: -10,
    tempMax: 50,
    nearLat: undefined,
    nearLng: undefined,
    nearRadius: undefined
};

async function applyFilters() {
    const readings = await apiGetReadings( currentFilters );
    updateMapMarkers( readings, displayCelsius );
    document.getElementById( 'reading-count' ).textContent = readings.length;
}

function debounce( fn, delay ) {
    let timer;
    return ( ...args ) => {
        clearTimeout( timer );
        timer = setTimeout( () => fn( ...args ), delay );
    };
}

/* ── Location search (geocoding) ────────────────────────────── */

function bindSearchEvents() {
    const input = document.getElementById( 'input-search' );
    const clearBtn = document.getElementById( 'btn-clear-search' );

    input.addEventListener( 'input', debounce( () => {
        const q = input.value.trim();
        clearBtn.hidden = !q;
        if ( q.length < 2 ) { hideSuggestions(); return; }
        fetchSuggestions( q );
    }, 350 ) );

    clearBtn.addEventListener( 'click', () => {
        input.value = '';
        clearBtn.hidden = true;
        hideSuggestions();
        input.focus();
    });

    input.addEventListener( 'keydown', ( e ) => {
        if ( e.key === 'Escape' ) { hideSuggestions(); input.blur(); }
    });

    document.addEventListener( 'click', ( e ) => {
        if ( !e.target.closest( '.search-group' ) ) hideSuggestions();
    });
}

async function fetchSuggestions( query ) {
    const box = document.getElementById( 'search-suggestions' );
    box.hidden = false;
    box.innerHTML = '<div class="search-suggestion-message">Searching…</div>';

    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent( query )}&format=json&limit=5&accept-language=en`;
        const res = await fetch( url );
        if ( !res.ok ) throw new Error();
        const results = await res.json();

        if ( !results.length ) {
            box.innerHTML = '<div class="search-suggestion-message">No results found.</div>';
            return;
        }

        box.innerHTML = '';
        results.forEach( ( r ) => {
            const parts = r.display_name.split( ', ' );
            const name = parts[0];
            const context = parts.slice( 1 ).join( ', ' );
            const item = document.createElement( 'div' );
            item.className = 'search-suggestion';
            item.innerHTML = `<span class="suggestion-name">${escapeHtml( name )}</span>` +
                             `<span class="suggestion-context">${escapeHtml( context )}</span>`;
            item.addEventListener( 'click', () => {
                document.getElementById( 'input-search' ).value = name;
                document.getElementById( 'btn-clear-search' ).hidden = false;
                hideSuggestions();
                const [south, north, west, east] = r.boundingbox.map( Number );
                leafletMap.fitBounds( [[south, west], [north, east]], {
                    padding: [40, 40],
                    maxZoom: 14,
                    animate: true,
                    duration: 0.8
                });
            });
            box.appendChild( item );
        });
    } catch ( _e ) {
        hideSuggestions();
    }
}

function hideSuggestions() {
    const box = document.getElementById( 'search-suggestions' );
    box.hidden = true;
    box.innerHTML = '';
}

/* ── Filters ────────────────────────────────────────────────── */

function bindFilterEvents() {

    document.querySelectorAll( 'input[name="type"]' ).forEach( ( cb ) => {
        cb.addEventListener( 'change', () => {
            currentFilters.types = Array.from(
                document.querySelectorAll( 'input[name="type"]:checked' )
            ).map( ( el ) => el.value );
            applyFilters();
        });
    });

    document.querySelectorAll( 'input[name="source"]' ).forEach( ( rb ) => {
        rb.addEventListener( 'change', () => {
            currentFilters.source = rb.value;
            applyFilters();
        });
    });

    document.getElementById( 'filter-date-from' ).addEventListener( 'change', ( e ) => {
        currentFilters.dateFrom = e.target.value;
        applyFilters();
    });

    document.getElementById( 'filter-date-to' ).addEventListener( 'change', ( e ) => {
        currentFilters.dateTo = e.target.value;
        applyFilters();
    });

    const tempMin = document.getElementById( 'filter-temp-min' );
    const tempMax = document.getElementById( 'filter-temp-max' );

    tempMin.addEventListener( 'input', debounce( () => {
        currentFilters.tempMin = parseFloat( tempMin.value ) || -10;
        applyFilters();
    }, 300 ) );

    tempMax.addEventListener( 'input', debounce( () => {
        currentFilters.tempMax = parseFloat( tempMax.value ) || 50;
        applyFilters();
    }, 300 ) );

    document.getElementById( 'btn-reset-filters' ).addEventListener( 'click', resetFilters );
}

function resetFilters() {
    currentFilters = {
        types: ['lake', 'river', 'ocean', 'pond', 'stream'],
        source: 'all',
        dateFrom: '',
        dateTo: '',
        tempMin: -10,
        tempMax: 50,
        nearLat: undefined,
        nearLng: undefined,
        nearRadius: undefined
    };
    document.querySelectorAll( 'input[name="type"]' ).forEach( ( cb ) => { cb.checked = true; });
    document.querySelector( 'input[name="source"][value="all"]' ).checked = true;
    document.getElementById( 'filter-date-from' ).value = '';
    document.getElementById( 'filter-date-to' ).value = '';
    document.getElementById( 'filter-temp-min' ).value = '-10';
    document.getElementById( 'filter-temp-max' ).value = '50';

    nearMeActive = false;
    const gpsBtn = document.getElementById( 'btn-gps' );
    gpsBtn.classList.remove( 'locating' );
    gpsBtn.querySelector( 'span, text' );

    applyFilters();
}

/* ── Unit toggle ────────────────────────────────────────────── */

function bindUnitToggle() {
    const btn = document.getElementById( 'btn-unit-toggle' );
    btn.addEventListener( 'click', () => {
        displayCelsius = !displayCelsius;
        btn.classList.toggle( 'active-f', !displayCelsius );
        btn.title = displayCelsius ? 'Switch to Fahrenheit' : 'Switch to Celsius';

        document.getElementById( 'filter-unit-label' ).textContent = displayCelsius ? '(°C)' : '(°F)';

        apiGetReadings( currentFilters ).then( ( readings ) => updateMarkersUnit( readings, displayCelsius ) );
    });
}

/* ── Near Me GPS ────────────────────────────────────────────── */

function bindGpsButton() {
    const btn = document.getElementById( 'btn-gps' );

    btn.addEventListener( 'click', () => {
        if ( nearMeActive ) {
            nearMeActive = false;
            currentFilters.nearLat = undefined;
            currentFilters.nearLng = undefined;
            currentFilters.nearRadius = undefined;
            btn.classList.remove( 'locating' );
            applyFilters();
            return;
        }

        if ( !navigator.geolocation ) {
            alert( 'Geolocation is not supported by your browser.' );
            return;
        }

        btn.classList.add( 'locating' );

        navigator.geolocation.getCurrentPosition(
            ( pos ) => {
                nearMeActive = true;
                currentFilters.nearLat = pos.coords.latitude;
                currentFilters.nearLng = pos.coords.longitude;
                currentFilters.nearRadius = 2000;
                showUserLocation( pos.coords.latitude, pos.coords.longitude );
                applyFilters();
                btn.classList.remove( 'locating' );
            },
            ( err ) => {
                btn.classList.remove( 'locating' );
                alert( 'Could not get your location: ' + err.message );
            },
            { timeout: 10000 }
        );
    });
}

/* ── Sidebar hamburger ──────────────────────────────────────── */

function bindHamburger() {
    const btn = document.getElementById( 'btn-hamburger' );
    const overlay = document.getElementById( 'sidebar-overlay' );

    btn.addEventListener( 'click', () => {
        document.body.classList.toggle( 'sidebar-open' );
    });

    overlay.addEventListener( 'click', () => {
        document.body.classList.remove( 'sidebar-open' );
    });
}

/* ── Open submit modal ──────────────────────────────────────── */

function bindSubmitButtons() {
    document.getElementById( 'btn-open-submit' ).addEventListener( 'click', openModal );
    document.getElementById( 'fab-submit' ).addEventListener( 'click', openModal );
}

/* ── Init ───────────────────────────────────────────────────── */

document.addEventListener( 'DOMContentLoaded', () => {
    if ( detectUseFahrenheit() ) {
        displayCelsius = false;
        document.getElementById( 'btn-unit-toggle' ).classList.add( 'active-f' );
        document.getElementById( 'filter-unit-label' ).textContent = '(°F)';
        updateLegendUnit( false );
    }

    initMap();
    applyFilters();

    bindSearchEvents();
    bindFilterEvents();
    bindUnitToggle();
    bindGpsButton();
    bindHamburger();
    bindSubmitButtons();

    initSubmitForm( () => {
        applyFilters();
    });
});
