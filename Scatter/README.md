# Scatter

A storage system with no server. Files are erasure-coded into one shard per browser in a shared vault; any *k* of *n* shards rebuild the file, so browsers can close and the file survives. No shard is ever held anywhere but in a browser.

Live: https://kevin-freitas-wwt.github.io/experiments/Scatter/

## The honest constraint

Browsers cannot accept inbound connections and cannot discover one another, so some rendezvous is unavoidable. Scatter uses the smallest one available: public Nostr relays carry an AES-GCM-encrypted WebRTC (Web Real-Time Communication) handshake, and nothing else. Once two browsers are connected, every byte of data moves directly between them over DTLS (Datagram Transport Layer Security). The relays never see file names, sizes or contents, and the vault name never leaves the browser in the clear (it is hashed into the room id and used as the encryption password).

Tabs in the same browser also find each other over BroadcastChannel, so the demo works with the network unplugged. One caveat: tabs in one browser share one disk. Scatter gives each tab its own node id and discards a node's shards once it has been quiet for twenty seconds, which lets you rehearse node loss on a single machine, but real independence means separate browsers or devices.

## Using it

1. Open the page; it joins a random vault and puts the name in the URL. Share that URL, or use *open a second peer*.
2. Drop a file. It is split *k*-of-*n* where *n* is the number of peers online and *k* follows the *tolerate losing* slider. Shard *i* goes to peer *i*.
3. Close tabs. Each file shows which shards still have an online holder and whether it is still recoverable.
4. **Fetch** pulls any *k* shards, decodes, verifies the SHA-256 and downloads. **Repair** decodes, rebuilds the missing shards and hands them to peers that hold none. **Forget** deletes the manifest and shards everywhere.

## Pieces

| File | Role |
| --- | --- |
| `rs.js` | Reed–Solomon over GF(256): systematic Vandermonde generator, encode, decode, single-shard rebuild |
| `store.js` | IndexedDB (Indexed Database): manifests per vault, shards per node, heartbeat and purge |
| `net.js` | peer table over two transports: Trystero (Nostr strategy) and BroadcastChannel; one `send()` picks the path per peer |
| `app.js` | protocol (`state`, `have`, `manifest`, `shard`, `get`, `forget`), distribution, fetch, repair, UI |

No build step. Trystero is vendored (`../vendor/trystero-0.26.0-nostr.js`, a single-file bundle); if that import fails the page falls back to local tabs only. The only things that leave the browser are the Nostr relay handshakes and STUN lookups.

## Limits

Demo cap of 32 MB per file. Erasure coding runs on the main thread (about 100 MB/s). Manifests are replicated to every peer; shard inventories are gossiped, not proven. Nothing stops a malicious peer in your vault from lying about what it holds; the vault name is the only secret.
