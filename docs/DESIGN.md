# tc-travel — Design Document

**Concept:** "Chronicle of Encounters" (出会いの年代記) — a fantasy-adventure-styled app for
recording real-world meetups: take AR group photos with VRM avatars, share them P2P (no server),
keep a travel diary, and fill in a fog-of-war world map with the places and people you've met.

Target: mobile-first (PC also works). Global audience → i18n is mandatory.
Stack: Vite + Preact + TypeScript, mistlib (Rust wasm, vendored) for P2P, yjs for CRDT sync.

## Core retention loop (game design)

The world map is the heart of the app. It works like an RPG world map:

1. Every country starts **shrouded in fog** (dark parchment, no detail).
2. Recording an encounter (photo / diary / pin) in a country **lifts the fog** — the country is
   revealed in warm parchment colors with a satisfying animation.
3. An **exploration percentage** ("World Explored: 12%") and per-continent progress push the
   collection urge.
4. **Adventurer rank** (Adventurer Card): level computed from XP. XP sources: new country revealed
   (large), new companion met (large), photo taken (small), diary entry written (small),
   consecutive-day usage streak (small).
5. **Achievements** (badges with fantasy names): e.g. "First Steps" (first encounter),
   "Fellowship of Five" (5 companions), "Continental Drifter" (3 continents), "Cartographer"
   (10 countries), "Chronicler" (10 diary entries), "Portrait of Legends" (first AR group photo).
6. **Chronicle** (journey timeline): all events aggregated in chronological order like a quest log.

Everything is *derived* from the synced data — no separate gamification state to corrupt
(achievements and XP are pure functions of the store).

## Data model (yjs)

One Y.Doc per **room** (= one meetup/party). Plus one local-only "personal" Y.Doc that aggregates
the user's own journey across all rooms (map progress, XP are personal, computed from all rooms
the user has joined + personal records).

Room doc (`travel:<roomId>`):
- `meta` (Y.Map): name, createdAt, emoji/banner
- `members` (Y.Map<memberId, Member>): { id, name, color, avatarEmoji, joinedAt }
- `photos` (Y.Array<Photo>): { id, by, at, caption, geo?: {lat,lng,countryCode}, data: Uint8Array (JPEG ≤ ~200KB, max 1280px) }
- `diary` (Y.Array<DiaryEntry>): { id, by, at, title, text, mood, geo? }
- `pins` (Y.Array<EncounterPin>): { id, by, at, lat, lng, countryCode, title, companions: string[], note }

Local personal store (localStorage/IndexedDB via y-indexeddb-like persistence or plain JSON):
- profile: { id, name, color, avatarEmoji, language }
- joinedRooms: [{ roomId, name, lastOpened }]
- streak: { lastActiveDay, count }

Photos are stored as compressed JPEG bytes inside the Y.Doc (meetup scale: dozens of photos, fine).
Compression: canvas resize to max 1280px, quality 0.8, target ≤ 200KB.

## Modules

```
src/
  lib/
    mistlib.ts      — wasm init + provider (follow tc-note pattern; see §mistlib)
    collab.ts       — room lifecycle: create/join/leave, Y.Doc wiring, awareness/presence
    store.ts        — typed accessors over Y.Doc (photos/diary/pins/members) + hooks
    personal.ts     — local profile, joined rooms, streak
    gamification.ts — XP/level/achievements derivation (pure functions + tests)
    geo.ts          — country lookup from lat/lng (point-in-polygon over world-atlas topojson)
    photo.ts        — capture/import/compress helpers
    qr.ts           — QR generation (qrcode) + scanning (BarcodeDetector, jsQR fallback)
    i18n.ts         — i18n runtime (tc-note pattern)
  locales/          — en.ts ja.ts zh.ts ko.ts es.ts fr.ts de.ts pt.ts
  components/
    shell/          — App shell: bottom tab bar (Map / Album / Diary / Camera / Profile), room switcher
    room/           — Join/Create screens, QR share & scan modal
    map/            — WorldMap (fog-of-war SVG), pin placement, country reveal animation
    album/          — photo grid, photo viewer, capture/import
    diary/          — entry list, editor
    ar/             — ARCamera: getUserMedia + three.js VRM overlay + composite capture
    guild/          — Adventurer Card (rank, XP, achievements), Chronicle timeline
  styles/           — theme.css (fantasy design tokens), per-feature css
```

## Fantasy UI theme

- Palette: dark leather/ink background (#1a1208, #2b1d0e), parchment surfaces (#f0e2c4, #e8d5a8),
  gold accents (#c9a227, #e8c547), deep red wax-seal accents (#8c2f28).
- Typography: serif display for headings (Georgia/Iowan/'Times New Roman' stack — no external
  fonts), system sans for body. Ornamental borders via CSS (double borders, corner flourishes
  with pseudo-elements), subtle paper texture via CSS gradients/noise (no external images).
- Components framed as: map = "World Atlas", album = "Memory Grimoire", diary = "Traveler's
  Journal", camera = "Summoning Circle" (AR), profile = "Adventurer Card".
- Buttons look like embossed leather/brass. Tab bar icons: lucide-preact.
- Dark theme by default (fits fantasy + AR camera); must look good on OLED mobile.
- Safe-area insets (viewport-fit=cover) respected; all tap targets ≥ 44px.

## i18n

- Follow tc-note's `src/lib/i18n.ts` pattern (module-level store + hook).
- 8 launch languages: en (fallback), ja, zh, ko, es, fr, de, pt.
- Auto-detect from navigator.language, persist override in profile.
- ALL user-facing strings go through `t()` — no hardcoded literals in components.
- Locale files are typed: `export const en = { ... } satisfies Translation` and other locales
  are `Translation` (keys enforced).

## QR room sharing

- Room link format: `<origin><base>#/join/<roomId>` — QR encodes the full URL so any phone
  camera app can open it; in-app scanner extracts roomId.
- Scanner: prefer native `BarcodeDetector` (Chrome/Android), fallback to jsQR over canvas frames
  (iOS Safari).

## AR VRM group photo

- `getUserMedia({ video: { facingMode: 'environment' } })` as background `<video>`.
- three.js scene with transparent WebGL canvas overlaid; VRM loaded via @pixiv/three-vrm
  (GLTFLoader + VRMLoaderPlugin — copy pattern from tc-vrm-viewer).
- User can load a .vrm file (file input, stored in OPFS/IndexedDB for reuse); default fallback
  is a built-in simple mascot (procedural three.js placeholder) so the feature works with zero setup.
- Gestures: one-finger drag = move model, two-finger pinch = scale, two-finger rotate = Y-rotate.
- Capture: draw video frame + WebGL canvas onto an offscreen canvas → JPEG → album (photo.ts).
- No WebXR dependency (iOS Safari lacks it) — "AR" is camera-compositing, which works everywhere.

## mistlib integration (patterns confirmed from tc-note/tc-chat)

- Vendored at `src/vendor/mistlib/{pkg/, wrappers/web/}` (already built). Import from
  `../vendor/mistlib/wrappers/web/index.js`. No vite wasm plugin needed.
- **Singleton constraint:** exactly ONE `MistNode` per page. Copy tc-note's
  `src/lib/mistNode.ts` lazy-singleton (`ensureMistNode()`, nodeId = `crypto.randomUUID()`
  persisted in localStorage). All subsystems funnel through it. `leaveRoom()` decommissions
  the node — next consumer must re-init.
- **yjs bridge:** copy tc-note's `src/lib/collab.ts` `CollabSession` pattern: mistlib is a raw
  byte pipe (`onEvent`/`sendMessage`); y-protocols sync + awareness are multiplexed with a
  1-byte varuint prefix (`MSG_SYNC=0`, `MSG_AWARENESS=1`). On `EVENT_PEER_CONNECTED`: send
  syncStep1 + full awareness to that peer. Use `LOCAL_ORIGIN`/`REMOTE_ORIGIN` Symbol
  transaction origins — never rebroadcast applied-remote updates (echo-loop bug with 3+ peers).
- roomId validation: `/^[A-Za-z0-9_-]{1,128}$/` before `joinRoom()`. Generate as
  `crypto.randomUUID()` (dashes allowed by the regex).
- **Photos over P2P:** `storage_add(name, bytes) → cid` (content-addressed, network-retrievable),
  `storage_get(cid) → bytes`. Y.Doc stores only metadata + cid; bytes live in mist storage.
  Keep an in-memory cid→ObjectURL cache; `storage_get` retried with backoff (peer may not be
  reachable yet right after joining).
- Presence: yjs awareness carries `{ peerId, name, color, avatarEmoji }`.
- Reference files (read before implementing):
  - `../tc-note/src/lib/mistNode.ts` (singleton)
  - `../tc-note/src/lib/collab.ts` (yjs bridge — adapt, don't invent)
  - `../tc-note/src/lib/mistlib.ts` (storage usage)
  - `src/vendor/mistlib/wrappers/web/index.d.ts` (API surface)
  - `../tc-vrm-viewer/src/viewer/vrmLoader.ts` (VRM loading)
  - `../tc-home/src/components/QRPanel.tsx` (QR render)

## Contracts (authored by orchestrator — do not change signatures)

- `src/lib/types.ts` — all shared data types (Member, Photo, DiaryEntry, EncounterPin, …).
- `src/lib/i18n.ts` — i18n runtime with side-effect registration: each feature ships its own
  `<feature>.i18n.ts` calling `registerTranslations({...})` at import time; components use
  `useT()` / `t(key, params?)`. 8 languages: en ja zh ko es fr de pt (en = fallback).
- Screen components (default-less named exports, no props — they use hooks):
  - `src/components/map/WorldMap.tsx` → `WorldMap`
  - `src/components/album/AlbumScreen.tsx` → `AlbumScreen`
  - `src/components/diary/DiaryScreen.tsx` → `DiaryScreen`
  - `src/components/ar/ARCameraScreen.tsx` → `ARCameraScreen`
  - `src/components/guild/GuildScreen.tsx` → `GuildScreen`
- Shell (owns `app.tsx`, tab bar, room screens) imports exactly those five.
- Feature agents own their directory only; cross-cutting state comes from `src/lib/*` hooks.

### lib API contract (core agent implements EXACTLY these exports)

```ts
// collab.ts + store.ts (store re-exports room lifecycle for UI convenience)
useSession(): { roomId: string; meta: RoomMeta; connected: boolean } | null;
createRoom(name: string, emoji: string): Promise<string>; // generates roomId, joins, seeds meta+member
joinRoom(roomId: string): Promise<void>;                  // validates id, joins, registers member
leaveRoom(): Promise<void>;
useMembers(): Member[];                                    // members map + live awareness merge
usePhotos(): Photo[];                                      // sorted newest first
addPhoto(bytes: Uint8Array, meta: Omit<Photo, "id" | "cid" | "by" | "at">): Promise<void>;
removePhoto(id: string): void;
usePhotoUrl(photo: Photo | null): string | null;           // cid → ObjectURL (cached, retried)
useDiary(): DiaryEntry[];
addDiaryEntry(e: Omit<DiaryEntry, "id" | "by" | "at">): void;
updateDiaryEntry(id: string, patch: Partial<Pick<DiaryEntry, "title" | "text" | "mood">>): void;
removeDiaryEntry(id: string): void;
usePins(): EncounterPin[];
addPin(p: Omit<EncounterPin, "id" | "by" | "at">): void;
removePin(id: string): void;

// personal.ts (localStorage only; journey = local mirror of everything seen in rooms,
// merged idempotently by id on every doc change — cross-room aggregation without
// needing to be in more than one room at a time, since MistNode is one-room-per-page)
useProfile(): [Profile, (patch: Partial<Profile>) => void];
useJoinedRooms(): JoinedRoom[];
useJourney(): { pins: EncounterPin[]; photos: Omit<Photo, "cid">[]; diary: Omit<DiaryEntry, "text">[]; streakDays: number; roomCount: number };
touchStreak(): void; // call on app start

// gamification.ts (pure; unit-tested)
computeStats(j: ReturnType<typeof useJourney> extends infer J ? J : never): JourneyStats;
computeRank(stats: JourneyStats): RankInfo; // XP: country 100, companion 40, pin 20, arPhoto 15, photo 5, diary 10, streakDay 5
ACHIEVEMENTS: AchievementDef[]; // ≥ 12 achievements

// geo.ts
loadWorld(): Promise<{ features: CountryFeature[] }>; // world-atlas countries-110m via topojson-client
lookupCountry(lat: number, lng: number): Promise<string>; // ISO alpha-2 lowercase, "" if ocean
countryName(code: string, lang: Language): string; // Intl.DisplayNames with fallback to code
numericToAlpha2(numericId: string): string; // world-atlas uses ISO numeric ids

// photo.ts
compressImage(src: Blob | HTMLCanvasElement, maxDim?: number, quality?: number):
  Promise<{ bytes: Uint8Array; width: number; height: number }>;

// qr.ts
renderQr(canvas: HTMLCanvasElement, text: string): Promise<void>;
buildJoinUrl(roomId: string): string;        // `${origin}${base}#/join/${roomId}`
parseJoinInput(text: string): string | null; // accepts full URL or bare roomId
startQrScan(video: HTMLVideoElement, onResult: (text: string) => void): () => void;
  // BarcodeDetector when available, else jsQR on canvas frames; returns stop()
```

### CSS design tokens (defined in `src/styles/theme.css` by shell agent; features must use them)

```
--bg / --bg-raised          dark leather background (#171008 / #241708)
--parchment / --parchment-2 light panel fills (#f0e2c4 / #e3d0a5)
--ink / --ink-soft          text on parchment (#2b1d0e / #5a452a)
--text / --text-soft        text on dark bg (#f0e2c4 / #b09a6e)
--gold / --gold-bright      accents (#c9a227 / #e8c547)
--seal                      wax-seal red (#8c2f28)
--font-display              serif display stack (Georgia, 'Iowan Old Style', 'Times New Roman', serif)
--radius / --radius-lg      6px / 12px
--tabbar-h                  bottom tab bar height incl. safe-area
Classes: .panel (parchment card w/ ornate double border), .btn / .btn-primary (embossed),
.screen (scrollable page under tab bar), .title-ornate (heading with flourishes)
```

## Build/verify

- `npm run build` = `tsc -b && vite build` must pass.
- Unit tests (vitest): gamification.ts, geo.ts (country lookup), qr payload parse, photo compress mock.
