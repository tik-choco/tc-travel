# tc-travel — Chronicle of Encounters

A serverless P2P app for recording real-world meetups and travels. Take AR group photos with
your VRM companion, share them with your party over P2P (no server, powered by mistlib), keep
a travel journal, and gradually lift the fog from a fantasy world map with every encounter.

- **World Atlas** — a fog-of-war world map. Countries are revealed when you record an
  encounter, photo, or diary entry there; watch your exploration percentage grow
- **Memory Grimoire** — the shared photo album. Capture or import photos; they are compressed
  and shared peer-to-peer via mist content-addressed storage
- **Traveler's Journal** — a quest-log style diary with moods and optional geotags
- **Summoning Circle** — overlay a VRM avatar on the live camera and take composite group
  photos (no WebXR required — works on iOS Safari too)
- **Adventurer Card** — adventurer rank, XP, achievement badges, and a chronicle timeline, all
  derived purely from your synced journey data
- Share rooms via QR code or `#/join/<roomId>` links; 8 languages (en/ja/zh/ko/es/fr/de/pt)

## Setup

```bash
cp .env.example .env   # set MISTLIB_REPO / MISTLIB_REF
npm install
npm run dev            # predev fetches mistlib and builds the wasm into src/vendor
```

Requirements: Node.js, plus Rust and wasm-pack (to build mistlib).

```bash
npm run build   # tsc -b && vite build
npm test        # vitest (pure-function tests: gamification / geo / qr)
```

## Architecture

See [docs/DESIGN.md](docs/DESIGN.md) for the full design. Highlights:

- **P2P**: mistlib (Rust→wasm, vendored at `src/vendor/mistlib`) is a raw byte pipe; y-protocols
  sync/awareness are multiplexed over it with a 1-byte prefix (`src/lib/collab.ts`, following
  the tc-note pattern). The MistNode is a per-page singleton (`src/lib/mistNode.ts`).
- **Data**: one Y.Doc per room (meta / members / photos / diary / pins). Photo bytes live in
  mist content-addressed storage (cid); the Y.Doc carries metadata only.
- **Journey mirror**: cross-room personal records (map progress, XP inputs) are a local mirror
  built by idempotently merging everything seen while in a room into localStorage
  (`src/lib/personal.ts`) — the map keeps filling in even under the one-room-at-a-time
  MistNode constraint.
- **i18n**: decentralized registration — each feature ships its own `*.i18n.ts` calling
  `registerTranslations()` (`src/lib/i18n.ts`); shared strings live in `src/lib/common.i18n.ts`.
- **AR**: a transparent three.js WebGL canvas over the camera `<video>`, composited onto an
  offscreen canvas at capture time. three + @pixiv/three-vrm load lazily when the AR tab is
  first opened (`ARCameraLazy`).
