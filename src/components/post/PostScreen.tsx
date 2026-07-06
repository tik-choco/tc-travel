import { useState } from "preact/hooks";
import { Contact, QrCode } from "lucide-preact";
import { removeCard, useCards } from "../../lib/cards";
import { getLanguage, useT } from "../../lib/i18n";
import { CardExchange } from "./CardExchange";
import { CardView } from "./CardView";
import type { Card } from "../../lib/types";
import "./post.i18n";
import "./post.css";

/** The card book (名刺帳): every card here was received by physically scanning
 *  its owner's screen (see CardExchange), so the collection doubles as a
 *  record of real-world meetings. Local-only — no room or session required. */
export function PostScreen() {
  const t = useT();
  const cards = useCards();
  const [exchanging, setExchanging] = useState(false);
  const [viewing, setViewing] = useState<Card | null>(null);

  const dateFmt = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium" });

  return (
    <div class="screen post-screen">
      <h1 class="title-ornate">{t("post.title")}</h1>

      {cards.length === 0 ? (
        <div class="empty-state">
          <div class="empty-state-icon">
            <Contact size={28} />
          </div>
          <p class="empty-state-title">{t("post.emptyTitle")}</p>
          <p class="empty-state-hint">{t("post.emptyState")}</p>
          <button type="button" class="btn btn-primary" onClick={() => setExchanging(true)}>
            <QrCode size={18} /> {t("post.exchange")}
          </button>
        </div>
      ) : (
        <>
          <p class="post-count">{t("post.cardCount", { count: cards.length })}</p>
          <ul class="post-list">
            {cards.map((card) => (
              <li key={card.id}>
                <button type="button" class="list-item post-card" onClick={() => setViewing(card)}>
                  <span class="avatar post-card-avatar" style={`border-color: ${card.color}`} aria-hidden="true">
                    {card.avatarEmoji}
                  </span>
                  <span class="list-item-body">
                    <span class="list-item-title">{card.name}</span>
                    {card.message !== "" && <span class="list-item-sub">{card.message}</span>}
                  </span>
                  {card.receivedAt !== undefined && (
                    <span class="list-item-trailing post-card-date">
                      {dateFmt.format(new Date(card.receivedAt))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" class="fab" onClick={() => setExchanging(true)}>
        <QrCode size={22} />
        <span class="fab-label">{t("post.exchange")}</span>
      </button>

      {exchanging && <CardExchange onClose={() => setExchanging(false)} />}

      {viewing && (
        <CardView
          card={viewing}
          onClose={() => setViewing(null)}
          onRemove={() => {
            removeCard(viewing.id);
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}
