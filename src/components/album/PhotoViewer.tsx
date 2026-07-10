import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight, Download, LoaderCircle, MapPin, Sparkles, Trash2, X } from "lucide-preact";
import { useAlbumPhotoUrl } from "../../lib/memories";
import { countryName } from "../../lib/geo";
import { getLanguage, useT } from "../../lib/i18n";
import type { AlbumPhoto, Member } from "../../lib/types";
import { Avatar } from "../common/Avatar";
import {
  clamp,
  clampZoom,
  DOUBLE_TAP_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  PAN_ACTIVE_SCALE,
  pinchMetrics,
  WHEEL_ZOOM_IN,
  WHEEL_ZOOM_OUT,
  ZOOM_IDENTITY,
  zoomTowardPoint,
  type ZoomState,
} from "./photoZoom";

interface PhotoViewerProps {
  photos: AlbumPhoto[];
  index: number;
  memberById: Map<string, Member>;
  ownId: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onDelete: (photo: AlbumPhoto) => void;
}

const SWIPE_THRESHOLD = 40;
const DOUBLE_TAP_MS = 300;
const TAP_MOVEMENT_PX = 12;

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
  const url = useAlbumPhotoUrl(photo);
  const canZoom = Boolean(url);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const imageWrapRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_IDENTITY);
  const zoomRef = useRef(zoom);
  const pinchRef = useRef<{ distance: number; center: { x: number; y: number }; zoom: ZoomState } | null>(null);
  const panRef = useRef<{ x: number; y: number; zoom: ZoomState } | null>(null);
  const mousePanRef = useRef<{ x: number; y: number; zoom: ZoomState } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  zoomRef.current = zoom;

  // Reset zoom/pan when navigating to a different photo (this component
  // instance is reused across index changes).
  useEffect(() => {
    setZoom(ZOOM_IDENTITY);
    pinchRef.current = null;
    panRef.current = null;
    mousePanRef.current = null;
    lastTapRef.current = null;
  }, [photo?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (zoomRef.current.scale > PAN_ACTIVE_SCALE) return;
      if (e.key === "ArrowLeft") {
        if (index > 0) onIndexChange(index - 1);
      } else if (e.key === "ArrowRight") {
        if (index < photos.length - 1) onIndexChange(index + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [index, photos.length, onClose, onIndexChange]);

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

  const containerRect = () => {
    const el = imageWrapRef.current;
    return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  };

  const zoomToward = (nextScale: number, point: { x: number; y: number }) => {
    setZoom(zoomTowardPoint(zoomRef.current, clamp(nextScale, MIN_SCALE, MAX_SCALE), point, containerRect()));
  };

  const toggleZoomToward = (point: { x: number; y: number }) => {
    if (!canZoom) return;
    zoomToward(zoomRef.current.scale > PAN_ACTIVE_SCALE ? MIN_SCALE : DOUBLE_TAP_SCALE, point);
  };

  const handleWheel = (e: WheelEvent) => {
    if (!canZoom || (!e.ctrlKey && !e.metaKey)) return;
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(delta) < 1) return;
    e.preventDefault();
    zoomToward(zoomRef.current.scale * (delta > 0 ? WHEEL_ZOOM_OUT : WHEEL_ZOOM_IN), { x: e.clientX, y: e.clientY });
  };

  const handleDoubleClick = (e: MouseEvent) => {
    toggleZoomToward({ x: e.clientX, y: e.clientY });
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || !canZoom || zoomRef.current.scale <= PAN_ACTIVE_SCALE) return;
    e.preventDefault();
    mousePanRef.current = { x: e.clientX, y: e.clientY, zoom: zoomRef.current };
  };
  const handleMouseMove = (e: MouseEvent) => {
    if (!mousePanRef.current) return;
    e.preventDefault();
    const rect = containerRect();
    setZoom(
      clampZoom(
        {
          scale: mousePanRef.current.zoom.scale,
          x: mousePanRef.current.zoom.x + e.clientX - mousePanRef.current.x,
          y: mousePanRef.current.zoom.y + e.clientY - mousePanRef.current.y,
        },
        rect.width,
        rect.height,
      ),
    );
  };
  const clearMousePan = () => {
    mousePanRef.current = null;
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (canZoom && e.touches.length >= 2) {
      const pinch = pinchMetrics(e.touches);
      pinchRef.current = pinch ? { ...pinch, zoom: zoomRef.current } : null;
      panRef.current = null;
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    const touch = e.touches[0];
    if (canZoom && zoomRef.current.scale > PAN_ACTIVE_SCALE && touch) {
      panRef.current = { x: touch.clientX, y: touch.clientY, zoom: zoomRef.current };
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    touchStartX.current = touch?.clientX ?? null;
    touchStartY.current = touch?.clientY ?? null;
  };
  const handleTouchMove = (e: TouchEvent) => {
    if (!canZoom) return;
    const rect = containerRect();
    if (e.touches.length >= 2 && pinchRef.current) {
      const pinch = pinchMetrics(e.touches);
      if (!pinch) return;
      e.preventDefault();
      const nextScale = clamp(pinchRef.current.zoom.scale * (pinch.distance / pinchRef.current.distance), MIN_SCALE, MAX_SCALE);
      setZoom(
        clampZoom(
          {
            scale: nextScale,
            x: pinchRef.current.zoom.x + (pinch.center.x - pinchRef.current.center.x),
            y: pinchRef.current.zoom.y + (pinch.center.y - pinchRef.current.center.y),
          },
          rect.width,
          rect.height,
        ),
      );
      return;
    }
    const touch = e.touches[0];
    if (touch && panRef.current && zoomRef.current.scale > PAN_ACTIVE_SCALE) {
      e.preventDefault();
      setZoom(
        clampZoom(
          {
            scale: zoomRef.current.scale,
            x: panRef.current.zoom.x + touch.clientX - panRef.current.x,
            y: panRef.current.zoom.y + touch.clientY - panRef.current.y,
          },
          rect.width,
          rect.height,
        ),
      );
    }
  };
  const handleTouchEnd = (e: TouchEvent) => {
    if (pinchRef.current) {
      if (e.touches.length < 2) pinchRef.current = null;
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        panRef.current = touch ? { x: touch.clientX, y: touch.clientY, zoom: zoomRef.current } : null;
      }
      if (zoomRef.current.scale <= PAN_ACTIVE_SCALE) setZoom(ZOOM_IDENTITY);
      return;
    }
    if (panRef.current) {
      if (e.touches.length === 0) panRef.current = null;
      if (zoomRef.current.scale <= PAN_ACTIVE_SCALE) setZoom(ZOOM_IDENTITY);
      return;
    }
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (startX === null) return;
    const touch = e.changedTouches[0];
    const endX = touch?.clientX ?? startX;
    const endY = touch?.clientY ?? startY ?? endX;
    const movement = Math.hypot(endX - startX, endY - (startY ?? endY));
    if (canZoom && movement < TAP_MOVEMENT_PX) {
      const now = Date.now();
      const last = lastTapRef.current;
      if (last && now - last.time < DOUBLE_TAP_MS && Math.hypot(endX - last.x, endY - last.y) < TAP_MOVEMENT_PX * 2) {
        lastTapRef.current = null;
        toggleZoomToward({ x: endX, y: endY });
        return;
      }
      lastTapRef.current = { time: now, x: endX, y: endY };
      return;
    }
    lastTapRef.current = null;
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
    if (window.confirm(t("album.confirmDelete"))) onDelete(photo);
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
        <div
          class={`viewer-image-wrap${canZoom ? " zoomable" : ""}`}
          ref={imageWrapRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={clearMousePan}
          onMouseLeave={clearMousePan}
          onDblClick={handleDoubleClick}
        >
          {url ? (
            <img
              src={url}
              alt=""
              style={{
                transform: canZoom ? `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` : undefined,
                transition: pinchRef.current || panRef.current || mousePanRef.current ? "none" : undefined,
              }}
            />
          ) : (
            <LoaderCircle class="spin" size={32} color="var(--on-surface)" />
          )}
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
