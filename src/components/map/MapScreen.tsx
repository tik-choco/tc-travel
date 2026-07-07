// The map tab's orchestrator: it picks the renderer and wires the globe's
// tap callbacks to the screens that live in OTHER modules.
//   - WebGL present  → the 3D area-accurate globe (GlobeMapLazy). Its photo and
//     country taps come back here as onOpenPhoto/onOpenCountry, and we mount the
//     album PhotoViewer and the sub-national drill-down (Japan's bespoke map, or
//     the generic SubnationalMap for US/KR/…) in response.
//   - No WebGL       → the original SVG WorldMap (self-contained: its own FAB,
//     stat card, and Japan drill-down), so low-end / no-GL devices still work.
// The globe deliberately imports neither the viewer nor the drill-down (they
// were built concurrently), so this thin layer is the single place they meet.
import { useMemo, useState } from "preact/hooks";
import type { AlbumPhoto, Member } from "../../lib/types";
import { useMembers } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { useAlbumPhotos, removeAlbumPhoto } from "../../lib/memories";
import { WorldMap } from "./WorldMap";
import { JapanMap } from "./JapanMap";
import { BragCard } from "./BragCard";
import { PhotoViewer } from "../album/PhotoViewer";
import { supportsWebGL } from "./globe/supportsWebgl";
import { GlobeMapLazy } from "./globe/GlobeMapLazy";
import { SubnationalMap } from "./subnational/SubnationalMap";
import { subnationalEntry, SUBNATIONAL_COUNTRY_CODES } from "./subnational/registry";

export function MapScreen() {
  // Probe once per mount — WebGL availability is a fixed property of the device.
  const webgl = useMemo(() => supportsWebGL(), []);
  const albumPhotos = useAlbumPhotos();
  const members = useMembers();
  const [profile] = useProfile();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [drillCountry, setDrillCountry] = useState<string | null>(null);
  const [bragOpen, setBragOpen] = useState(false);

  // Fold the local profile in as a synthetic member so a SOLO photo (whose `by`
  // is the local profile id, absent from the room's member map) still reads as
  // "you" in the viewer — mirrors AlbumScreen's solo handling.
  const memberById = useMemo(() => {
    const map = new Map<string, Member>(members.map((m) => [m.id, m]));
    if (!map.has(profile.id)) {
      map.set(profile.id, {
        id: profile.id,
        name: profile.name,
        color: profile.color,
        avatarEmoji: profile.avatarEmoji,
        joinedAt: 0,
      });
    }
    return map;
  }, [members, profile.id, profile.name, profile.color, profile.avatarEmoji]);

  // All hooks are above this guard so hook order stays stable across renders
  // (webgl is invariant per mount, but keeping the return here is the safe form).
  if (!webgl) return <WorldMap />;

  const handleOpenPhoto = (photo: AlbumPhoto) => {
    const idx = albumPhotos.findIndex((p) => p.id === photo.id && p.source === photo.source);
    if (idx >= 0) setViewerIndex(idx);
  };

  const handleOpenCountry = (code: string) => {
    const entry = subnationalEntry(code);
    if (entry?.hasData) setDrillCountry(entry.code);
  };

  const drillEntry = drillCountry ? subnationalEntry(drillCountry) : undefined;

  return (
    <>
      <GlobeMapLazy
        onOpenPhoto={handleOpenPhoto}
        onOpenCountry={handleOpenCountry}
        drillDownCodes={SUBNATIONAL_COUNTRY_CODES as string[]}
      />

      {viewerIndex !== null && albumPhotos[viewerIndex] && (
        <PhotoViewer
          photos={albumPhotos}
          index={viewerIndex}
          memberById={memberById}
          ownId={profile.id}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
          onDelete={(photo) => {
            removeAlbumPhoto(photo);
            setViewerIndex(null);
          }}
        />
      )}

      {/* Sub-national drill-down: Japan keeps its bespoke collection map (with a
          brag card); every other country uses the generic SubnationalMap. */}
      {drillEntry?.kind === "japan" && (
        <JapanMap onClose={() => setDrillCountry(null)} onBrag={() => setBragOpen(true)} />
      )}
      {drillEntry?.kind === "generic" && drillEntry.hasData && drillCountry && (
        <SubnationalMap countryCode={drillCountry} onClose={() => setDrillCountry(null)} />
      )}
      {bragOpen && <BragCard onClose={() => setBragOpen(false)} />}
    </>
  );
}
