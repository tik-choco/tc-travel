// Cross-app VRM adoption for the tik-choco family. A VRM you already have in
// the family (e.g. loaded in tc-vrm-viewer and kept in the shared tc-storage
// drive) can appear in tc-travel WITHOUT re-uploading. This only reads the
// neutral `drive-index` shared bus via drive/reader.ts — publish-don't-peek:
// it never touches another app's private storage by name. See docs/INTEGRATION.md.
import { listDriveFiles, loadDriveFileBytes, type DriveFileEntry } from "./drive/reader";
import { loadVrmBytes, saveVrmBytes } from "../components/ar/vrmStorage";
import { setMemberVrmBytes } from "./store";

export type { DriveFileEntry };

// Auto-adopt runs at most once per device so that removing the VRM later never
// silently re-adopts it. The flag is only set once we've actually had a family
// VRM to consider (or a local one already exists) — otherwise a VRM shared into
// the family *after* the first visit can still be adopted on a later visit.
const AUTO_ADOPT_FLAG = "tc-travel:familyVrmAdoptChecked";

/** VRM files shared into the family drive (tc-storage) that this device can load. */
export async function listFamilyVrms(): Promise<DriveFileEntry[]> {
  return listDriveFiles({ extensions: [".vrm"] });
}

/** Loads a family VRM's bytes, saves it as the local companion, and (when in a
 *  room) publishes it to the party. Returns the bytes so the caller can render. */
export async function importFamilyVrm(entry: DriveFileEntry): Promise<Uint8Array> {
  const bytes = await loadDriveFileBytes(entry);
  await saveVrmBytes(bytes);
  void setMemberVrmBytes(bytes).catch((err) => console.error("tc-travel: publish adopted VRM failed", err));
  return bytes;
}

function markChecked(): void {
  try {
    localStorage.setItem(AUTO_ADOPT_FLAG, "1");
  } catch {
    // storage unavailable — auto-adopt simply won't be remembered; harmless.
  }
}

/** First-run convenience so a family VRM "just works": if this device has no
 *  local VRM yet but the family already shares one, adopt the first available.
 *  Returns true if a VRM was adopted (the caller should re-read vrmStorage). */
export async function maybeAdoptFamilyVrm(): Promise<boolean> {
  try {
    if (localStorage.getItem(AUTO_ADOPT_FLAG)) return false;
  } catch {
    return false;
  }
  let local: Uint8Array | null = null;
  try {
    local = await loadVrmBytes();
  } catch {
    // IndexedDB unavailable — don't risk clobbering; skip adoption.
    return false;
  }
  if (local) {
    markChecked(); // a VRM is already set; don't auto-adopt over it, ever
    return false;
  }
  const vrms = await listFamilyVrms();
  if (vrms.length === 0) return false; // nothing to adopt yet — leave the flag unset for a later visit
  markChecked();
  try {
    await importFamilyVrm(vrms[0]);
    return true;
  } catch (err) {
    console.error("tc-travel: family VRM auto-adopt failed", err);
    return false;
  }
}
