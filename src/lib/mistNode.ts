// mistlib-wasm supports exactly one active MistNode per page — note storage
// (storage_add/storage_get) and real-time collab rooms are not independent
// subsystems, they're both facets of the same underlying P2P engine (the
// wasm side wires up its content store as part of node startup). Two
// independent `new MistNode(...).init()` calls race for that single slot;
// whichever inits second throws "mistlib-wasm supports one active MistNode
// per page; call leaveRoom() before initializing another node." Both photo
// storage (store.ts) and collab rooms (collab.ts) must go through this one
// shared instance instead. Adapted from tc-note's src/lib/mistNode.ts.
import { MistNode, storage_get } from "../vendor/mistlib/wrappers/web/index.js";

const NODE_ID_KEY = "tc-travel:nodeId";
// Family-wide shared pointer (see docs/INTEGRATION.md): a plain CID string
// for a small identity record whose `.did` field, once adopted, lets every
// app in the family converge on the same mist nodeId. tc-travel only ever
// reads this pointer — lazily, after its own node is already initialized
// (see adoptSharedFamilyDid below) — and never writes it.
const SHARED_DID_IDENTITY_CID_KEY = "tc-shared-did-identity-cid-v1";

function loadOrCreateNodeId(): string {
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

export type NodeEventHandler = (
  eventType: number,
  fromId: string,
  payload: unknown,
  roomId?: string,
) => void;

// mistlib's wrapper exposes only one onEvent slot per node (registering a
// handler replaces whatever was there before), but this page's single node
// is shared by multiple independent consumers — collab.ts for Yjs sync/
// awareness, and the AI companion client, each in their own room. This
// fan-out dispatcher lets every consumer register independently; it's
// wired to the node's real onEvent slot exactly once, at node creation
// (see ensureMistNode below), and never touched again.
const eventHandlers = new Set<NodeEventHandler>();

/** Registers a handler for all node events; returns an unsubscribe function. Safe to call before the node exists — the actual wiring happens once, at creation, and handlers registered earlier are picked up then. */
export function addNodeEventHandler(handler: NodeEventHandler): () => void {
  eventHandlers.add(handler);
  return () => {
    eventHandlers.delete(handler);
  };
}

/** @internal The actual fan-out, factored out so tests can exercise it directly without spinning up a real (wasm) MistNode — production code only reaches this via the node.onEvent wiring in ensureMistNode below. Not part of this module's public contract. */
export function dispatchNodeEvent(eventType: number, fromId: string, payload: unknown, roomId?: string): void {
  for (const handler of eventHandlers) {
    try {
      handler(eventType, fromId, payload, roomId);
    } catch (e) {
      console.warn("tc-travel: node event handler failed", e);
    }
  }
}

// Resolves once the page's single MistNode is ready to use. Creates it on
// first call, wiring the fan-out dispatcher above into the node's onEvent
// slot at that point — `_onEvent` is instance state, so this wiring lives
// on for the node's whole lifetime, surviving any later re-init. collab.ts
// now leaves rooms via a room-scoped leaveRoom(roomId), which keeps the
// node initialized, but an unscoped leaveRoom() (the "leave everything"
// form) still fully decommissions it — this guard re-initializes on the
// next call if that ever happens.
export async function ensureMistNode(): Promise<InstanceType<typeof MistNode>> {
  // `initialized` is a real runtime property the vendor JS wrapper sets
  // (flipped back to false by leaveRoom()) but it isn't part of the
  // vendored .d.ts's public surface — hence the cast rather than a type
  // error, since that .d.ts is regenerated upstream and not ours to extend.
  if (node && (node as unknown as { initialized: boolean }).initialized) return node;
  if (!initPromise) {
    initPromise = (async () => {
      if (!node) {
        node = new MistNode(getPageNodeId());
        node.onEvent(dispatchNodeEvent);
      }
      await node.init();
      adoptSharedFamilyDid(); // fire-and-forget, never blocks or throws
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

// Lazily adopts the family-wide DID identity (if another app on this origin
// has published one) by persisting it as tc-travel's own nodeId for the
// NEXT session — this never re-initializes the node that's already running,
// since mistlib-wasm supports only one active node per page and racing a
// second init against it would throw. Best-effort: any failure just leaves
// the existing nodeId in place.
function adoptSharedFamilyDid(): void {
  void (async () => {
    try {
      if (getPageNodeId().startsWith("did:")) return; // already on the family DID
      const cid = localStorage.getItem(SHARED_DID_IDENTITY_CID_KEY)?.trim();
      if (!cid) return;
      const raw = await storage_get(cid);
      const text = new TextDecoder().decode(new Uint8Array(raw));
      const parsed = JSON.parse(text) as { did?: unknown } | null;
      const did = parsed?.did;
      if (typeof did !== "string" || !did.startsWith("did:")) return;
      localStorage.setItem(NODE_ID_KEY, did);
    } catch (error) {
      console.warn("tc-travel: failed to adopt shared family DID identity", error);
    }
  })();
}
