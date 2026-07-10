import { exportPhotoToDrive, isPhotoExported } from "../../lib/drive/export";
import { renderCardImage } from "./cardImageCanvas";

export interface CardForExport {
  id: string;
  name: string;
  avatarEmoji: string;
  color: string;
  message: string;
  at: number;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function cardExportId(cardId: string): string {
  return `card-${cardId}`;
}

export function isCardExported(cardId: string): boolean {
  return isPhotoExported(cardExportId(cardId));
}

function cardFileBase(card: CardForExport): string {
  const d = new Date(card.at);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const cleanName = card.name.trim().replace(/\s+/g, "") || "card";
  return `card_${cleanName}_${stamp}`;
}

export async function saveCardToDrive(card: CardForExport, metOnLabel?: string): Promise<void> {
  const blob = await renderCardImage({
    name: card.name,
    avatarEmoji: card.avatarEmoji,
    color: card.color,
    message: card.message,
    metOnLabel,
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await exportPhotoToDrive({
    photoId: cardExportId(card.id),
    bytes,
    caption: cardFileBase(card),
    at: card.at,
  });
}
