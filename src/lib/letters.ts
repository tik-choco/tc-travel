// Pure helpers for the postal feature — no Yjs/DOM so they stay unit-testable.
// The Y.Doc side (useLetters/sendLetter/markLetterRead/removeLetter) lives in
// store.ts alongside the other room collections.
import type { Letter } from "./types";

export interface LetterPartition {
  /** Letters addressed to the viewer, in input order. */
  inbox: Letter[];
  /** Letters written by the viewer, in input order. */
  sent: Letter[];
  /** Inbox letters not yet opened by the viewer. */
  unreadCount: number;
}

/** Splits a room's letters into the viewer's inbox and sent piles, preserving
 *  input order. Letters between other members are excluded from both; a
 *  self-addressed letter appears in both. */
export function partitionLetters(letters: Letter[], myId: string): LetterPartition {
  const inbox: Letter[] = [];
  const sent: Letter[] = [];
  let unreadCount = 0;
  for (const letter of letters) {
    if (letter.to === myId) {
      inbox.push(letter);
      if (!letter.read) unreadCount++;
    }
    if (letter.from === myId) sent.push(letter);
  }
  return { inbox, sent, unreadCount };
}
