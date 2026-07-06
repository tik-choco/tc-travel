// mistlib-wasm supports exactly one active MistNode per page — note storage
// (storage_add/storage_get) and real-time collab rooms are not independent
// subsystems, they're both facets of the same underlying P2P engine (the
// wasm side wires up its content store as part of node startup). Two
// independent `new MistNode(...).init()` calls race for that single slot;
// whichever inits second throws "mistlib-wasm supports one active MistNode
// per page; call leaveRoom() before initializing another node." Both photo
// storage (store.ts) and collab rooms (collab.ts) must go through this one
// shared instance instead. Adapted from tc-note's src/lib/mistNode.ts.
import { MistNode } from "../vendor/mistlib/wrappers/web/index.js";

const NODE_ID_KEY = "tc-travel:nodeId";
// Shared DID identity key from the tik-choco family convention (tc-storage's
// crypto/didIdentity.ts) — read-only here, never written by tc-travel. When
// present (e.g. a tc-storage tab has run on this origin) its `did` doubles as
// this participant's mist nodeId and export originNode, per docs/INTEGRATION.md.
const SHARED_DID_IDENTITY_KEY = "tc-storage-did-identity-v1";

/** Defensive read: any parse failure or shape mismatch falls back to null so
 *  callers always have the plain uuid nodeId as a safety net. */
function readSharedDid(): string | null {
  try {
    const raw = localStorage.getItem(SHARED_DID_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { did?: unknown } | null;
    const did = parsed?.did;
    return typeof did === "string" && did.startsWith("did:") ? did : null;
  } catch {
    return null;
  }
}

function loadOrCreateNodeId(): string {
  const sharedDid = readSharedDid();
  if (sharedDid) return sharedDid;
  let id = localStorage.getItem(NODE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(NODE_ID_KEY, id);
  }
  return id;
}

// Computed lazily (not at module load) so importing this module has no
// side effect on environments without `localStorage` (e.g. vitest's default
// node test environment).
let pageNodeId: string | null = null;
function getPageNodeId(): string {
  if (!pageNodeId) pageNodeId = loadOrCreateNodeId();
  return pageNodeId;
}

let node: InstanceType<typeof MistNode> | null = null;
let initPromise: Promise<InstanceType<typeof MistNode>> | null = null;

// Resolves once the page's single MistNode is ready to use. Creates it on
// first call; re-initializes it if a previous collab session's leaveRoom()
// tore it down — mistlib-wasm's leaveRoom() fully decommissions the node,
// so the next consumer (storage or a fresh room join) needs to bring it
// back up.
export async function ensureMistNode(): Promise<InstanceType<typeof MistNode>> {
  // `initialized` is a real runtime property the vendor JS wrapper sets
  // (flipped back to false by leaveRoom()) but it isn't part of the
  // vendored .d.ts's public surface — hence the cast rather than a type
  // error, since that .d.ts is regenerated upstream and not ours to extend.
  if (node && (node as unknown as { initialized: boolean }).initialized) return node;
  if (!initPromise) {
    initPromise = (async () => {
      if (!node) node = new MistNode(getPageNodeId());
      await node.init();
      return node;
    })();
    initPromise.finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

// The page's single MistNode's own id — used as this participant's identity
// in collab room presence (see collab.ts's awareness `peerId`).
export function currentNodeId(): string {
  return getPageNodeId();
}
