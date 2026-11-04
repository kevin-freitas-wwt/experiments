# Vendored third-party files

| File | Project | Version | License |
| --- | --- | --- | --- |
| `three-0.187.0/three.module.js` (+ `three.core.js`) | [three.js](https://github.com/mrdoob/three.js) | 0.187.0 | MIT (`LICENSE-three.txt`) |
| `trystero-0.26.0-nostr.js` | [Trystero](https://github.com/dmotz/trystero), Nostr strategy, bundled with `@trystero-p2p/core`, `@trystero-p2p/nostr` and `@noble/secp256k1` | 0.26.0 | MIT (`LICENSE-trystero.txt`); @noble/secp256k1 MIT |
| `fonts/shippori-mincho-*.woff2` | Shippori Mincho by FONTDASU | v17 (Google Fonts build) | SIL OFL 1.1 |
| `fonts/ibm-plex-*.woff2` | IBM Plex by IBM | Mono v20, Sans v23 (Google Fonts builds) | SIL OFL 1.1 |

Trystero still talks to public Nostr relays and STUN servers at runtime; that is what Scatter is for. Nothing else in Strata or Scatter leaves the browser.
