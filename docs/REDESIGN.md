# tc-travel UI/UX Redesign Contract — "Modern Material, Avatar-first"

This document is the binding contract for the 2026-07 redesign. All implementation
agents follow it exactly. It supersedes the "Fantasy UI theme" section of DESIGN.md
for visuals; data model / P2P architecture in DESIGN.md is unchanged unless stated here.

> **Addendum — 2026-07 "warm M3 Expressive" evolution.** Two things below have
> since evolved and this addendum, not the original text, is authoritative where
> they differ:
>
> 1. **Theme is warm-light-default, not dark-only.** The parchment/travel-journal
>    identity was *kept*, not dropped: `:root` is a warm cozy LIGHT palette and
>    dark is a toggle (`[data-theme="dark"]`) + an OS-`auto` fallback. The two
>    dark blocks in theme.css are byte-identical by necessity — keep them in sync.
>    The emotional north star is 愛着 (attachment): modern ≠ cold. "Modern" here
>    means **M3 Expressive done in warm tones**, not a white admin dashboard.
> 2. **An M3 Expressive token layer was added** (all additive — every token below
>    still works):
>    - Motion: `--ease-standard`, `--ease-emphasized`, `--ease-emphasized-decel`,
>      `--ease-emphasized-accel`, `--ease-spring` (overshoot), and durations
>      `--dur-fast` 120ms / `--dur-medium` 220ms / `--dur-slow` 380ms.
>    - State layers (as percentages, drop into `color-mix()`): `--state-hover` 8%,
>      `--state-focus` 10%, `--state-press` 12%.
>    - Elevation: `--shadow-1..5` (4–5 lift FAB press / sheets / dialogs).
>    - Fluid type: `--text-display/-headline` (clamp-based), `--text-title/-body/
>      -label`; utility classes `.title-ornate` (fluid headline) and NEW
>      `.display-title`.
>    - Shared primitives (`.btn`, `.chip`, `.list-item`, `.fab`, `.input`, tab-bar
>      indicator) use these tokens: state-layer hover/press + springy press
>      micro-motion, every one with a `prefers-reduced-motion` opt-out.
>    - Bottom sheets rise with emphasized-decelerate + `--shadow-5`; the scrim
>      fades in.
>    - Font stack extended with `"Noto Sans KR"`, `"Noto Sans SC"` for worldwide
>      CJK coverage; CJK tracking resets now cover `.title-ornate`/`.display-title`
>      as well as `.section-title`.

> **Addendum — 2026-07-07 "Avatar hub / capture split".** The single `camera`
> tab (`src/components/ar/ARCameraScreen.tsx`) that mixed avatar management with
> the live camera feed has been split into two concerns:
>
> 1. **Avatar hub — `src/components/avatar/AvatarScreen.tsx`** (+ `AvatarScreenLazy`,
>    `avatar.css`, `avatar.i18n.ts`). The companion's room: a three.js stage over a
>    *warm, cozy* backdrop (`.avatar-stage-backdrop`, token-driven, NOT the cold
>    camera look) — NO `getUserMedia`, ever. Owns summon/replace (device + Drive
>    chooser), remove, set-as-profile-portrait, and the talk panel. Reuses the
>    `../ar/` scene/VRM/gesture modules across the folder boundary. Its hero CTA
>    ("AR撮影") opens the capture overlay.
> 2. **Capture overlay — `src/components/ar/ARCameraScreen.tsx`** is now a
>    capture-only fullscreen overlay (`{ onClose }`, `.ar-capture` fixed at
>    `z-index: 95`, above the tab bar). Keeps the camera feed, facing flip, AR
>    composite shutter, save-to-device, camera-error virtual-stage fallback, and
>    **all** the room group-photo logic (remote companions + 10Hz pose broadcast +
>    initial slot offset — pose-sync semantics unchanged, only relocated). It reads
>    the stored VRM on mount and shows the placeholder golem if none.
>
> **Tab rename + reorder.** The `camera` tab id is now `avatar` (icon unchanged:
> `UserRound`). New priority orders:
> - `SOLO_TABS = ["home", "avatar", "map", "album", "diary", "guild"]`
> - `ROOM_TABS = ["map", "avatar", "album", "diary", "post", "guild"]` (room
>   landing stays `map`).
>
> i18n split: hub-only keys moved to `avatar.*` (`avatar.i18n.ts`); capture +
> talk-panel keys stay `ar.*` (`ar.i18n.ts`).

## Goals

1. **Modern Material Design 3, dark-first.** Drop the parchment/gold fantasy skin.
   The audience is metaverse users (VRChat etc.) — sleek dark surfaces, one vivid
   violet primary, generous rounded corners, quiet elevation. No serif fonts, no
   ornamental borders, no emoji-as-chrome.
2. **Clear flows (動線).** Every screen answers "what do I do next" — scan-first
   home, one FAB per tab for the primary action, empty states that teach + CTA.
3. **Avatar-first identity.** Users love their avatars. A real avatar image
   (VRM portrait or uploaded picture) replaces the emoji everywhere it matters, and
   is shared P2P so party members see each other's avatars.

The fantasy *flavor is kept in the writing only* (rank names, achievement titles,
"chronicle" wording stay). The chrome becomes modern Material.

## Design system (src/styles/theme.css — already rewritten by the orchestrator)

Dark-only (color-scheme: dark). Tokens (use ONLY these, never raw hex in feature CSS):

- Surfaces: `--surface-dim` (page bg), `--surface`, `--surface-container-low`,
  `--surface-container`, `--surface-container-high`, `--surface-container-highest`
- Content: `--on-surface`, `--on-surface-variant`, `--outline`, `--outline-variant`
- Accent: `--primary`, `--on-primary`, `--primary-container`, `--on-primary-container`
- Support: `--secondary` (teal, connectivity/success-adjacent), `--tertiary`
  (warm pink, XP/achievements), `--error`, `--on-error`, `--success`
- Shape: `--radius-sm` 8px, `--radius` 12px, `--radius-lg` 16px, `--radius-xl` 28px,
  `--radius-full` 999px
- Legacy aliases (`--gold`, `--parchment`, `--ink`, `--seal`, `--bg`, `--text`, …)
  are mapped onto the new tokens so unmigrated CSS degrades gracefully — **migrate
  your feature CSS off them anyway.**

Shared classes (same names as before, restyled — plus new ones):

- `.panel` → MD3 filled card (surface-container, radius-lg, no border tricks).
  `.panel-tight` still smaller padding.
- `.btn` (tonal), `.btn-primary` (filled), `.btn-ghost` (text), `.btn-outlined`
  (NEW), `.btn-danger`, `.btn-block`, `.btn-icon` (round icon button), plus state
  layers on hover/active. Pill-shaped (radius-full).
- `.fab` (NEW) — fixed bottom-right floating action button above the nav bar
  (uses `--fab-bottom`), primary-container colored, radius 16, icon + optional
  `.fab-label` text for extended FAB.
- `.screen`, `.field`, `.input` (filled text field look), `.chip`
  (assist/filter chip, pill), `.chip-color`, `.avatar` (+ NEW `.avatar-img`,
  sizes `.avatar-sm/.avatar-lg/.avatar-xl`), `.status-dot`, `.modal-backdrop`,
  `.modal-card` (bottom sheet with drag-handle bar via `.sheet-handle`).
- NEW `.list-item` — MD3 list row (leading avatar/icon, `.list-item-body` with
  `.list-item-title`/`.list-item-sub`, trailing element). Use for rooms, members,
  diary entries, chronicle.
- NEW `.empty-state` — centered icon (`.empty-state-icon`), title, one-line hint,
  CTA button slot. EVERY list screen must render this when empty.
- NEW `.section-title` — small uppercase label for grouping; `.title-ornate` is
  now a plain modern headline (kept for compat, no ornaments).
- Motion: `.fog-reveal` and `.gold-shimmer` still exist (renamed visuals, subtler).
  Respect `prefers-reduced-motion`.

Typography: system-ui stack, headings 600–700 weight, tight letter-spacing.
Icons: lucide-preact only, default 20–24px.

## Avatar identity (shared contract)

Type changes (done by orchestrator in src/lib/types.ts):

```ts
interface Profile { …; avatarImage?: string }  // small square JPEG data URL (≤256px)
interface Member  { …; avatarCid?: string }    // mist storage cid of that JPEG
```

New module `src/lib/avatar.ts` (Agent B) — exact API others compile against:

```ts
/** Compress any image blob to a ≤256px cover-cropped square JPEG data URL and
 *  persist it as profile.avatarImage. If a room session is live, also upload the
 *  bytes to mist storage and set members[profile.id].avatarCid. */
export async function setProfileAvatar(source: Blob): Promise<void>;
export function clearProfileAvatar(): void;
/** ObjectURL/dataURL for a member's avatar image, resolving avatarCid from mist
 *  storage with an in-memory cache (mirror the usePhotoUrl pattern in store.ts);
 *  for the local member, short-circuit to profile.avatarImage. Null → caller
 *  falls back to avatarEmoji. */
export function useMemberAvatarUrl(member: Pick<Member, "id" | "avatarCid"> | null): string | null;
```

New component `src/components/common/Avatar.tsx` (Agent B):

```tsx
export function Avatar(props: {
  member?: Member | null;      // renders image via useMemberAvatarUrl, else emoji
  self?: boolean;              // render the local profile (avatarImage/emoji)
  size?: "sm" | "md" | "lg" | "xl"; // default "md"
  ringColor?: string;          // member color ring; omit for plain outline
}): JSX.Element
```

Plumbing (Agent B): store.ts writes `avatarCid` into the member record on
create/join (uploading profile.avatarImage bytes via the same storage API photos
use) and re-uploads when the profile avatar changes while in a room;
collab.ts `CollabUser`/`AwarenessState`/`PeerInfo` gain optional `avatarCid`
passed through awareness; the `useMembers` overlay merges it.

Everyone else: **always render people with `<Avatar>`**, never raw avatarEmoji.

## Flow spec per area

### Shell (Agent A — owns shell/*, room/*, app.tsx, app.css, index.css, common.i18n.ts)
- **Header** → MD3 top app bar on `--surface`: room emoji+name, small connection
  chip (dot + "接続中" text via existing keys), member avatar stack (Avatar
  components, overlapping); tapping the stack opens a bottom sheet listing all
  members (`.list-item` rows: Avatar, name, "you" badge for self). Share (QR) as
  a prominent tinted icon button; leave action moves into an overflow position or
  stays as icon with the existing confirm dialog restyled as a bottom sheet.
- **TabBar** → MD3 navigation bar: active tab gets a pill "active indicator"
  behind the icon, label always visible. Tab id `camera` KEEPS its id but its
  label/icon change to the avatar concept: label key stays `tab.camera`, update
  its translations in common.i18n.ts to "Avatar/アバター/…" (all 8 langs) and use
  a person-ish lucide icon (e.g. `UserRound` or keep Camera — choose `UserRound`).
- **Home** (room/Home.tsx) — redesign hierarchy for the meetup moment:
  1. Compact hero: `<Avatar self size="lg">` + greeting with profile name
     (new room.i18n keys), subtle rank line is optional.
  2. Two large primary action cards side by side: **Scan QR to join** (opens
     QrModal scan tab — this is THE meetup action) and **Create party**.
     Create opens a bottom sheet with the name/emoji form (no always-visible form).
  3. "Your parties" as `.list-item` rows (emoji, name, last-opened date, chevron);
     tap row = enter. Empty → `.empty-state` explaining create-or-scan.
  4. Join-by-text (paste link/id) as a small secondary row under the actions.
- **ProfileSetup** — modern onboarding card: name field, avatar picker offering
  (a) upload image (`<input type=file accept="image/*">` → `setProfileAvatar`)
  shown as a big tappable Avatar preview with a camera badge, and (b) emoji
  fallback grid (existing choices) + color picker. Copy mentions VRM portrait can
  be captured later on the Avatar tab (new i18n key).
- QrModal: restyle as bottom sheet, big QR, room link copy button with copied
  feedback; scan tab full-bleed video with corner guides. Keep logic as-is.

### Map + Album (Agent C — owns map/*, album/*)
- WorldMap: keep SVG map; modernize chrome — stats (visited count / %) as chips
  or a compact card overlaying top; FAB "add encounter" (MapPin icon) replaces
  any inline add button; EncounterSheet → bottom sheet styling, `.list-item`s,
  companions chips; pins keep member colors. Empty (no pins) → `.empty-state`
  overlay hint "record your first encounter".
- Album: photo grid with radius-sm thumbnails and tighter gaps; FAB "add photo";
  AddPhotoSheet → bottom sheet; PhotoViewer: dark immersive, caption + `<Avatar
  member>` + name of the photographer; AR shots get a small badge. Empty state
  with CTA to FAB/AR tab.

### Diary + Guild (Agent D — owns diary/*, guild/*)
- Diary: entries as `.list-item`-style cards (mood as a small chip, date, first
  line); FAB "write entry" opens editor as full bottom sheet; reader modernized.
  Empty state CTA.
- Guild: GuildCard becomes avatar-centric — large `<Avatar self size="xl">` at
  top, name, rank title + level, XP progress bar (rounded, `--primary`),
  stats as MD3 grid; AchievementsGrid: locked = outline + low opacity, unlocked =
  primary-container tiles; Chronicle as `.list-item` timeline; SettingsSection:
  language select styled, plus "change avatar image" (file input →
  `setProfileAvatar`) and "remove avatar image" (`clearProfileAvatar`).

### Avatar tab (Agent E — owns ar/*)
- Reframe from "camera tool" to **your avatar's home**:
  - No VRM loaded → welcoming empty-state hero: "召喚しよう" copy → load .vrm
    button (existing file input) + note it stays on-device.
  - VRM loaded → the 3D view is home base; control cluster: [AR photo] primary
    FAB-style shutter (existing composite capture), [Set as profile portrait]
    (NEW — render the current VRM view/head framing to an offscreen canvas,
    crop square, `canvas.toBlob` → `setProfileAvatar`; add ar.i18n keys + a
    success toast/snackbar-ish confirmation), [replace VRM], [remove VRM].
  - Restyle overlays/buttons to MD3 (`.btn-icon`, scrims, bottom control bar).
- Keep gestures, golem placeholder, IndexedDB persistence, lazy loading intact.

## Ownership map (STRICT — do not touch files outside your list)

| Agent | Files |
|---|---|
| A shell-room | src/components/shell/*, src/components/room/*, src/app.tsx, src/app.css, src/index.css, src/lib/common.i18n.ts |
| B avatar-lib | src/lib/avatar.ts (new), src/components/common/* (new), src/lib/store.ts, src/lib/collab.ts, src/lib/personal.ts |
| C map-album | src/components/map/*, src/components/album/* |
| D diary-guild | src/components/diary/*, src/components/guild/* |
| E avatar-hub | src/components/ar/* |

Orchestrator owns: src/lib/types.ts, src/styles/theme.css, docs/*.

## Rules

- i18n: every new user-visible string goes through `useT()` with entries for ALL
  8 languages in your feature's `*.i18n.ts` (common.i18n.ts only for Agent A).
- No new dependencies. No React/MUI packages — Material 3 is implemented with
  the theme.css tokens/classes.
- Keep all existing lib APIs working; `npm test` (vitest) must stay green.
- Accessibility: keep aria labels, 44px min tap targets, `:focus-visible` rings,
  `prefers-reduced-motion` respected.
- Mobile-first (~390px), still fine at desktop widths (max-width containers).
