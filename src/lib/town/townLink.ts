// Cross-app hand-off (P0-4, docs/MARKETING.md loop C): opens tc-town — the
// family's character workshop app — in a new tab from the companion
// empty-state cross-sell card in AvatarScreen. Same-origin sibling-subpath
// convention (see docs/INTEGRATION.md and ../family/guildChatLink.ts, the
// chat app's equivalent hand-off); this is a plain link, not a data hand-off,
// so unlike characterIndex.ts it doesn't touch the shared bus at all.
const TOWN_APP_PATH = "../tc-town/";

/** URL for tc-town's own root, meant to be opened via target="_blank". */
export function townAppUrl(): string {
  return TOWN_APP_PATH;
}
