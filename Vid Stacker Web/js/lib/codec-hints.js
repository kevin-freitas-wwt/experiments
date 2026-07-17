// Human-readable codec support messaging, shared by the pre-flight check
// (drop-zone.js, before the user commits to trimming/stacking) and the
// extraction-time check (extractor.js, as a fallback in case a codec passes
// isConfigSupported but the browser still can't produce frames).

const CODEC_FAMILIES = [
    { prefix: 'avc1', name: 'H.264' },
    { prefix: 'hev1', name: 'HEVC (H.265)' },
    { prefix: 'hvc1', name: 'HEVC (H.265)' },
    { prefix: 'vp09', name: 'VP9' },
    { prefix: 'vp8',  name: 'VP8' },
    { prefix: 'av01', name: 'AV1' }
]

const REENCODE_CMD = 'ffmpeg -i input.mov -c:v libx264 -crf 18 -c:a copy output.mp4'

function codecFamilyName( codec ) {
    const found = CODEC_FAMILIES.find( f => codec.startsWith( f.prefix ) )
    return found ? found.name : 'an uncommon codec'
}

function detectBrowser() {
    const ua = navigator.userAgent
    if (/Firefox\//.test( ua )) return 'Firefox'
    if (/Edg\//.test( ua )) return 'Edge'
    if (/Chrome\//.test( ua ) && !/Edg\//.test( ua )) return 'Chrome'
    if (/Safari\//.test( ua ) && !/Chrome\//.test( ua )) return 'Safari'
    return 'your browser'
}

// Builds a plain-language message for an unsupported codec — no codec/profile
// strings, just what it is and what to try instead.
export function unsupportedCodecMessage( codec ) {
    const family  = codecFamilyName( codec )
    const browser = detectBrowser()

    if (family === 'HEVC (H.265)') {
        return `This video is encoded in HEVC (H.265), which ${browser} can't decode. HEVC support is largely limited to Safari and to Chrome on macOS/Linux — it doesn't work in Firefox or Edge. Try opening the file in Safari, or re-encode it to H.264 (works everywhere): ${REENCODE_CMD}`
    }
    return `This video's format isn't supported by ${browser}. Try opening it in Chrome, Edge, or Safari, or re-encode it to H.264 (works everywhere): ${REENCODE_CMD}`
}

// Pre-flight check: ask the browser directly whether it can decode this
// codec/resolution before the user spends time trimming a clip that will
// fail at Stack time. Returns { supported: true } when unknown/unsure —
// callers should only ever treat this as a way to catch known failures
// early, not as a guarantee of success.
export async function checkCodecSupport( codec, codedWidth, codedHeight ) {
    if (!codec) return { supported: true }

    if (!('VideoDecoder' in globalThis)) {
        return {
            supported: false,
            message: `Your browser doesn't support the WebCodecs API needed to read video frames. Try Chrome, Edge, or Safari.`
        }
    }

    try {
        const { supported } = await VideoDecoder.isConfigSupported({ codec, codedWidth, codedHeight })
        if (supported) return { supported: true }
        return { supported: false, message: unsupportedCodecMessage( codec ) }
    } catch {
        // Malformed/unrecognized codec string — don't block on it, the
        // extraction-time check will catch a real failure with the same
        // friendly message.
        return { supported: true }
    }
}
