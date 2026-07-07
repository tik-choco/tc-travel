import "./guild.i18n";
import { MessageCircle } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { useSession } from "../../lib/store";
import { guildChatUrl } from "../../lib/family/guildChatLink";

/** One-click hand-off to the family chat app's room for this party — solo
 *  travelers have no party to chat with, so this renders nothing outside a
 *  room (see docs/family-chat interop note in guildChatLink.ts). Opens in a
 *  new tab: navigating away in this tab would tear down the P2P session. */
export function GuildChatLink() {
  const t = useT();
  const session = useSession();
  if (!session) return null;

  const url = guildChatUrl(session.roomId, session.meta.name);

  return (
    <section class="panel guild-chat-panel">
      <h2 class="title-ornate guild-section-title">{t("guildChat.title")}</h2>
      <p class="guild-chat-desc">{t("guildChat.description")}</p>
      <a class="btn btn-primary btn-block guild-chat-btn" href={url} target="_blank" rel="noopener noreferrer">
        <MessageCircle size={16} aria-hidden="true" />
        {t("guildChat.open")}
      </a>
    </section>
  );
}
