import { useRef } from "preact/hooks";
import { ChevronLeft, ChevronRight, Download, LoaderCircle, MapPin, Sparkles, Trash2, X } from "lucide-preact";
import { usePhotoUrl } from "../../lib/store";
import { countryName } from "../../lib/geo";
import { getLanguage, useT } from "../../lib/i18n";
import type { Member, Photo } from "../../lib/types";
import { Avatar } from "../common/Avatar";

interface PhotoViewerProps {
  photos: Photo[];
  index: number;
  memberById: Map<string, Member>;
  ownId: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onDelete: (id: string) => void;
}

const SWIPE_THRESHOLD = 40;

/** Full-screen photo viewer with swipe/arrow navigation. Read-only caption —
 * the lib contract has no updatePhoto, so caption editing only happens at
 * add-time (see AddPhotoSheet). */
export function PhotoViewer({
  photos,
  index,
  memberById,
  ownId,
  onClose,
  onIndexChange,
  onDelete,
}: PhotoViewerProps) {
  const t = useT();
  const photo = photos[index];
  const url = usePhotoUrl(photo);
  const touchStartX = useRef<number | null>(null);

  if (!photo) return null;

  const author = memberById.get(photo.by);
  const authorName = author?.name ?? t("album.fellowTraveler");
  const dateLabel = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(photo.at),
  );
  const locationLabel = photo.geo?.countryCode ? countryName(photo.geo.countryCode, getLanguage()) : null;
  const isOwn = photo.by === ownId;

  const goPrev = () => {
    if (index > 0) onIndexChange(index - 1);
  };
  const goNext = () => {
    if (index < photos.length - 1) onIndexChange(index + 1);
  };

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: TouchEvent) => {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? startX;
    const delta = endX - startX;
    if (delta > SWIPE_THRESHOLD) goPrev();
    else if (delta < -SWIPE_THRESHOLD) goNext();
  };

  const handleDownload = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${photo.id}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDelete = () => {
    if (window.confirm(t("album.confirmDelete"))) onDelete(photo.id);
  };

  return (
    <div class="viewer-backdrop" role="dialog" aria-modal="true">
      <div class="viewer-topbar">
        <button type="button" class="viewer-icon-btn" onClick={onClose} aria-label={t("album.close")}>
          <X size={24} />
        </button>
      </div>
      <div class="viewer-stage">
        <button
          type="button"
          class="viewer-nav-btn"
          onClick={goPrev}
          disabled={index === 0}
          aria-label={t("album.prev")}
        >
          <ChevronLeft size={28} />
        </button>
        <div class="viewer-image-wrap" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {url ? <img src={url} alt="" /> : <LoaderCircle class="spin" size={32} color="var(--on-surface)" />}
        </div>
        <button
          type="button"
          class="viewer-nav-btn"
          onClick={goNext}
          disabled={index === photos.length - 1}
          aria-label={t("album.next")}
        >
          <ChevronRight size={28} />
        </button>
      </div>
      <div class="viewer-info">
        <span class="viewer-author">
          <Avatar member={author ?? null} size="sm" ringColor={author?.color} />
          {authorName}
          {photo.arShot && (
            <span class="viewer-ar-badge">
              <Sparkles size={11} /> {t("album.arBadge")}
            </span>
          )}
        </span>
        <span class="viewer-meta">
          <span>{dateLabel}</span>
          {locationLabel && (
            <span>
              <MapPin size={12} style={{ verticalAlign: "-2px" }} /> {locationLabel}
            </span>
          )}
        </span>
        {photo.caption && <span class="viewer-caption">{photo.caption}</span>}
        <span class="viewer-actions">
          <button type="button" class="btn btn-tonal" onClick={handleDownload} disabled={!url}>
            <Download size={16} /> {t("album.download")}
          </button>
          {isOwn && (
            <button type="button" class="btn btn-danger" onClick={handleDelete}>
              <Trash2 size={16} /> {t("album.delete")}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
