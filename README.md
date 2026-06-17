# Oakwood Chess — 3D Chess with AI & Online Play

A self-contained 3D chess game:
- **3D board & pieces** rendered with Three.js (procedurally generated — no external model files).
- **Full rules engine** via chess.js (legal moves, check/checkmate/stalemate, castling, en passant, promotion, draw detection).
- **AI opponent** for either or both sides, levels 1–10, running in a background Web Worker (minimax + alpha-beta pruning) so the page never freezes while it thinks.
- **Online multiplayer with a room code** — two devices connect directly to each other over WebRTC (via the free PeerJS broker for the initial handshake). There is no game server of ours involved; once connected, moves travel straight between the two browsers.

## Running it

Browsers block ES module imports and WebRTC features when a page is opened directly as a `file://` URL, so you need to **serve the `game/` folder over HTTP**. Pick whichever is easiest:

**Quick local test (same computer / same Wi-Fi):**
```bash
cd game
python3 -m http.server 8080
```
Then open `http://localhost:8080` on this computer, or `http://<your-computer's-LAN-IP>:8080` from a phone on the same Wi-Fi network.

**To actually play between two different phones on different networks**, the page needs to be reachable on the public internet. The easiest free options:
- **GitHub Pages** — push the `game/` folder to a GitHub repo and enable Pages in the repo settings.
- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop the `game/` folder onto their web dashboard (all have free static-hosting tiers, no account needed for a one-off drop on Netlify).

Once hosted, open the URL on both phones (or send the link to the other player) and use "Create room" / "Join" inside the app.

## How to play

- **Move a piece**: tap it, then tap a glowing destination square. Gold dots are quiet moves, gold rings are captures, and the king's square glows red when in check.
- **Camera**: drag to orbit the board, pinch (or scroll) to zoom.
- **AI**: in the "Players" panel, flip the "AI" switch on either side and pick a level from 1 (relaxed, occasionally blunders) to 10 (searches deeper, plays solidly). Turn AI on for both sides to watch them play each other.
- **Online play**: one player taps "Create room" and reads the 6-character code aloud (or sends it); the other taps "Join", types the code, and the board syncs. The host always plays White, the guest plays Black. AI is automatically disabled for both sides while an online game is active.
- **Clock**: pick a time control from the dropdown, or leave it on "Unlimited".

## Project structure

```
game/
  index.html            entry point
  css/style.css          all styling
  js/
    main.js               app wiring: game state, UI, turn flow
    board3d.js             Three.js scene, board, animation, input
    pieceFactory.js         procedural piece geometry
    ai.worker.js            chess AI (runs in a Web Worker)
    multiplayer.js          PeerJS room-code wrapper
    sound.js                tiny WebAudio sound effects
    vendor/                 bundled third-party libraries (three.js, chess.js,
                             peerjs, OrbitControls) — no CDN required at runtime
```

## Notes & limitations

- This is an original implementation built for this request — it is not a copy of any commercial chess app, so the piece artwork, colors, and exact menu layout are different from any reference image.
- The online connection uses PeerJS's public signalling server only to introduce the two browsers to each other; if a network's firewall blocks WebRTC entirely (some corporate/school networks do), the connection may fail — most home and mobile networks work fine.
- The AI is a from-scratch minimax engine, not a chess engine like Stockfish — level 10 plays solid club-level chess but is not super-human.
