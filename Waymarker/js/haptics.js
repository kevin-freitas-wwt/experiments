// A short haptic "bump". Uses the Vibration API on Android; on iOS Safari (which
// has no Vibration API) it falls back to toggling a hidden `switch` checkbox,
// which fires a subtle system haptic on iOS 17.4+.

let iosToggle = null;

function getIosToggle() {
    if ( !iosToggle ) {
        const label = document.createElement( "label" );
        label.setAttribute( "aria-hidden", "true" );
        label.style.cssText = "opacity: 0; pointer-events: none; position: fixed; left: 0; bottom: 0;";
        iosToggle = document.createElement( "input" );
        iosToggle.type = "checkbox";
        iosToggle.tabIndex = -1;
        iosToggle.setAttribute( "switch", "" );
        label.appendChild( iosToggle );
        document.body.appendChild( label );
    }
    return iosToggle;
}

export function bump() {
    if ( navigator.vibrate && navigator.vibrate( 12 ) ) {
        return;
    }
    getIosToggle().click();
}
