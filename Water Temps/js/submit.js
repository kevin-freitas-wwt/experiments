/* Submit form: EXIF extraction from photo, map location picker, localStorage email */

let selectedPhotoData = null;
let formLat = null;
let formLng = null;

function initSubmitForm( onSubmitSuccess ) {
    const form = document.getElementById( 'form-submit' );
    const overlay = document.getElementById( 'modal-overlay' );

    initPhotoUpload();
    initTypePills();

    window.onFormLocationDrag = ( lat, lng ) => setFormLocation( lat, lng );

    form.addEventListener( 'submit', ( e ) => {
        e.preventDefault();
        if ( validateForm( form ) ) submitReading( form, onSubmitSuccess );
    });

    document.getElementById( 'btn-cancel-submit' ).addEventListener( 'click', closeModal );
    document.getElementById( 'btn-modal-close' ).addEventListener( 'click', closeModal );
    document.getElementById( 'btn-submit-another' ).addEventListener( 'click', resetForm );

    overlay.addEventListener( 'click', ( e ) => {
        if ( e.target === overlay ) closeModal();
    });

    document.addEventListener( 'keydown', ( e ) => {
        if ( e.key === 'Escape' && !overlay.hidden ) closeModal();
    });
}

function openModal() {
    document.getElementById( 'modal-overlay' ).hidden = false;
    document.body.style.overflow = 'hidden';

    setDefaultDate();

    const savedEmail = localStorage.getItem( 'wt_email' );
    if ( savedEmail ) document.getElementById( 'f-email' ).value = savedEmail;

    const unit = ( typeof displayCelsius !== 'undefined' && !displayCelsius ) ? 'F' : 'C';
    document.querySelector( `input[name="tempUnit"][value="${unit}"]` ).checked = true;

    setTimeout( () => {
        initFormMap( ( lat, lng ) => setFormLocation( lat, lng ) );
    }, 80 );
}

function closeModal() {
    document.getElementById( 'modal-overlay' ).hidden = true;
    document.body.style.overflow = '';
}

function resetForm() {
    const form = document.getElementById( 'form-submit' );
    form.reset();
    form.hidden = false;
    document.getElementById( 'submit-success' ).hidden = true;
    clearFormErrors( form );
    clearLocation();
    resetTypePills();
    resetPhotoUpload();
    selectedPhotoData = null;
    setDefaultDate();
    const savedEmail = localStorage.getItem( 'wt_email' );
    if ( savedEmail ) document.getElementById( 'f-email' ).value = savedEmail;
}

/* ── Location ───────────────────────────────────────────────── */

function setFormLocation( lat, lng, panTo = false ) {
    formLat = lat;
    formLng = lng;
    document.getElementById( 'f-lat' ).value = lat.toFixed( 5 );
    document.getElementById( 'f-lng' ).value = lng.toFixed( 5 );
    setFormMapPin( lat, lng );
    if ( panTo ) {
        formMap.setView( [lat, lng], Math.max( formMap.getZoom(), 8 ), { animate: true });
    }
    document.getElementById( 'location-hint' ).hidden = true;
    const display = document.getElementById( 'location-coords-display' );
    display.textContent = formatCoords( lat, lng );
    display.hidden = false;
}

function clearLocation() {
    formLat = null;
    formLng = null;
    document.getElementById( 'f-lat' ).value = '';
    document.getElementById( 'f-lng' ).value = '';
    clearFormMapPin();
    document.getElementById( 'location-hint' ).hidden = false;
    document.getElementById( 'location-coords-display' ).hidden = true;
}

function formatCoords( lat, lng ) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lng >= 0 ? 'E' : 'W';
    return `${Math.abs( lat ).toFixed( 4 )}°${ns}, ${Math.abs( lng ).toFixed( 4 )}°${ew}`;
}

/* ── Type pills ─────────────────────────────────────────────── */

function initTypePills() {
    document.querySelectorAll( '.type-pill' ).forEach( ( btn ) => {
        btn.addEventListener( 'click', () => {
            document.querySelectorAll( '.type-pill' ).forEach( ( b ) => b.classList.remove( 'selected' ) );
            btn.classList.add( 'selected' );
            document.getElementById( 'f-water-type' ).value = btn.dataset.value;
        });
    });
}

function resetTypePills() {
    document.querySelectorAll( '.type-pill' ).forEach( ( b ) => b.classList.remove( 'selected' ) );
    document.getElementById( 'f-water-type' ).value = '';
}

/* ── Validation ─────────────────────────────────────────────── */

function validateForm( form ) {
    clearFormErrors( form );
    let valid = true;

    if ( !form.type.value ) {
        showError( 'err-water-type', 'Please select a water type.' );
        valid = false;
    }

    const temp = form.temp.value;
    if ( temp === '' || isNaN( parseFloat( temp ) ) ) {
        showError( 'err-temp', 'Please enter a temperature.' );
        valid = false;
    } else {
        const c = form.tempUnit.value === 'F' ? fToC( parseFloat( temp ) ) : parseFloat( temp );
        if ( c < -10 || c > 50 ) {
            showError( 'err-temp', 'Temperature out of range (−10 to 50°C).' );
            valid = false;
        }
    }

    if ( !form.date.value ) {
        showError( 'err-date', 'Please select a date and time.' );
        valid = false;
    }

    if ( !formLat || !formLng ) {
        showError( 'err-location', 'Please click the map to set a location.' );
        valid = false;
    }

    const email = form.email.value.trim();
    if ( !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( email ) ) {
        showError( 'err-email', 'Please enter a valid email address.' );
        valid = false;
    }

    return valid;
}

function showError( id, message ) {
    const el = document.getElementById( id );
    if ( el ) el.textContent = message;
}

function clearFormErrors( form ) {
    form.querySelectorAll( '.field-error' ).forEach( ( el ) => { el.textContent = ''; });
}

/* ── Submit ─────────────────────────────────────────────────── */

function submitReading( form, onSubmitSuccess ) {
    const btn = document.getElementById( 'btn-submit-form' );
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    localStorage.setItem( 'wt_email', form.email.value.trim() );

    const rawTemp = parseFloat( form.temp.value );
    const tempC = form.tempUnit.value === 'F' ? fToC( rawTemp ) : rawTemp;

    const reading = {
        id: 'local-' + Date.now(),
        waterBody: null,
        type: form.type.value,
        lat: formLat,
        lng: formLng,
        tempC: Math.round( tempC * 10 ) / 10,
        date: form.date.value,
        source: 'citizen',
        email: maskEmail( form.email.value.trim() ),
        notes: form.notes.value.trim() || null,
        photoUrl: selectedPhotoData || null
    };

    apiAddReading( reading ).then( ( saved ) => {
        onSubmitSuccess( saved );
        form.hidden = true;
        document.getElementById( 'submit-success' ).hidden = false;
        btn.disabled = false;
        btn.textContent = 'Submit Reading';
    }).catch( () => {
        btn.disabled = false;
        btn.textContent = 'Submit Reading';
        showError( 'err-email', 'Submission failed — please try again.' );
    });
}

function setDefaultDate() {
    const d = document.getElementById( 'f-date' );
    if ( !d.value ) {
        const now = new Date();
        now.setMinutes( now.getMinutes() - now.getTimezoneOffset() );
        d.value = now.toISOString().slice( 0, 16 );
    }
}

/* ── Photo upload + EXIF extraction ─────────────────────────── */

function initPhotoUpload() {
    const area = document.getElementById( 'photo-upload-area' );
    const input = document.getElementById( 'f-photo' );

    area.addEventListener( 'dragover', ( e ) => {
        e.preventDefault();
        area.classList.add( 'drag-over' );
    });
    area.addEventListener( 'dragleave', () => area.classList.remove( 'drag-over' ) );
    area.addEventListener( 'drop', ( e ) => {
        e.preventDefault();
        area.classList.remove( 'drag-over' );
        const file = e.dataTransfer.files[0];
        if ( file && file.type.startsWith( 'image/' ) ) loadPhotoFile( file );
    });
    input.addEventListener( 'change', () => {
        if ( input.files[0] ) loadPhotoFile( input.files[0] );
    });
    document.getElementById( 'btn-photo-remove' ).addEventListener( 'click', ( e ) => {
        e.stopPropagation();
        resetPhotoUpload();
    });
}

async function loadPhotoFile( file ) {
    console.log( '[photo] file chosen:', file.name, file.type, file.size + 'b' );

    const reader = new FileReader();
    reader.onload = ( e ) => {
        selectedPhotoData = e.target.result;
        document.getElementById( 'photo-preview' ).src = selectedPhotoData;
        document.getElementById( 'photo-placeholder' ).hidden = true;
        document.getElementById( 'photo-preview-wrap' ).hidden = false;
        console.log( '[photo] preview rendered' );
    };
    reader.readAsDataURL( file );

    if ( typeof exifr === 'undefined' ) {
        console.warn( '[exif] exifr not loaded — skipping EXIF extraction' );
        return;
    }
    console.log( '[exif] exifr available, parsing…' );

    try {
        const tags = await exifr.parse( file );
        console.log( '[exif] raw parse result:', tags );

        if ( !tags ) {
            console.log( '[exif] no tags found in photo' );
            return;
        }

        if ( tags.DateTimeOriginal ) {
            const dt = new Date( tags.DateTimeOriginal );
            const pad = ( n ) => String( n ).padStart( 2, '0' );
            const local = `${dt.getFullYear()}-${pad( dt.getMonth() + 1 )}-${pad( dt.getDate() )}T${pad( dt.getHours() )}:${pad( dt.getMinutes() )}`;
            document.getElementById( 'f-date' ).value = local;
            console.log( '[exif] date set to', local );
        } else {
            console.log( '[exif] no DateTimeOriginal tag' );
        }

        if ( tags.latitude != null && tags.longitude != null ) {
            console.log( '[exif] GPS found:', tags.latitude, tags.longitude );
            setFormLocation( tags.latitude, tags.longitude, true );
        } else {
            console.log( '[exif] no GPS tags' );
        }
    } catch ( err ) {
        console.error( '[exif] parse error:', err );
    }
}

function resetPhotoUpload() {
    selectedPhotoData = null;
    document.getElementById( 'f-photo' ).value = '';
    document.getElementById( 'photo-preview' ).src = '';
    document.getElementById( 'photo-placeholder' ).hidden = false;
    document.getElementById( 'photo-preview-wrap' ).hidden = true;
}
