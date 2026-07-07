import { LoaderCircle, Sparkles } from "lucide-preact";
import { useAlbumPhotoUrl } from "../../lib/memories";
import { useT } from "../../lib/i18n";
import type { AlbumPhoto } from "../../lib/types";

interface PhotoThumbProps {
  photo: AlbumPhoto;
  index: number;
  onOpen: () => void;
}

/** One grid cell. Its own component because useAlbumPhotoUrl is a hook and
 * can't be called from inside a .map() callback on the parent. It resolves the
 * bytes from whichever home the photo lives in (room mist cid / local IDB). */
export function PhotoThumb({ photo, index, onOpen }: PhotoThumbProps) {
  const t = useT();
  const url = useAlbumPhotoUrl(photo);

  return (
    <button
      type="button"
      class="photo-thumb"
      onClick={onOpen}
      aria-label={t("album.photoAlt", { index: index + 1 })}
    >
      {url ? (
        <img src={url} alt="" loading="lazy" />
      ) : (
        <div class="photo-thumb-loading">
          <LoaderCircle class="spin" size={20} />
        </div>
      )}
      {photo.arShot && (
        <span class="photo-ar-badge" title={t("album.arBadge")} aria-label={t("album.arBadge")}>
          <Sparkles size={11} />
        </span>
      )}
    </button>
  );
}
