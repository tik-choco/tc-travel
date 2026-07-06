// The local keepsake card collection (名刺帳) — cards received by scanning
// someone's screen face-to-face (see cardQr.ts). Deliberately localStorage-only
// and independent of any room: a card is a personal memento of a real-world
// meeting, not shared state, and there is intentionally NO remote delivery
// path. Mirrors personal.ts's cache + listeners + hook pattern.
import { useEffect, useState } from "preact/hooks";
import { getProfile } from "./personal";
import type { Card } from "./types";

const CARDS_KEY = "tc-travel:cards";

function loadCards(): Card[] {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    return raw ? (JSON.parse(raw) as Card[]) : [];
  } catch {
    return [];
  }
}

let cachedCards: Card[] | null = null;
const cardListeners = new Set<() => void>();

function saveCards(cards: Card[]): void {
  cachedCards = cards;
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
  cardListeners.forEach((fn) => fn());
}

/** Pure merge (unit-testable without localStorage): dedupe by sender id.
 *  Rescanning someone refreshes their card's content but keeps the EARLIEST
 *  receivedAt — "met on" stays the day you first met, which is the point of
 *  the keepsake. Returns a new list, newest-first by receivedAt. */
export function upsertCard(list: Card[], incoming: Card): Card[] {
  const existing = list.find((c) => c.id === incoming.id);
  const merged = { ...incoming };
  const earliest = Math.min(existing?.receivedAt ?? Infinity, incoming.receivedAt ?? Infinity);
  if (Number.isFinite(earliest)) merged.receivedAt = earliest;
  return [merged, ...list.filter((c) => c.id !== incoming.id)].sort(
    (a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0),
  );
}

/** Non-hook accessor for use outside components (CardExchange's scan callback). */
export function getCards(): Card[] {
  if (!cachedCards) cachedCards = loadCards();
  return cachedCards;
}

export function useCards(): Card[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    cardListeners.add(fn);
    return () => {
      cardListeners.delete(fn);
    };
  }, []);
  return getCards();
}

/** Files a freshly scanned card into the collection, stamping receivedAt now.
 *  Your own card is ignored — scanning your own screen (e.g. in a mirror or
 *  a photo) must not collect yourself. */
export function addReceivedCard(card: Omit<Card, "receivedAt">): void {
  if (card.id === getProfile().id) return;
  saveCards(upsertCard(getCards(), { ...card, receivedAt: Date.now() }));
}

export function removeCard(id: string): void {
  saveCards(getCards().filter((c) => c.id !== id));
}
