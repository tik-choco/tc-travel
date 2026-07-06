import { useMemo, useState } from "preact/hooks";
import { ImageOff, Plus, ScrollText } from "lucide-preact";
import { useSession, useMembers, usePhotos, removePhoto } from "../../lib/store";
import { useProfile } from "../../lib/personal";
import { useT } from "../../lib/i18n";
import { PhotoThumb } from "./PhotoThumb";
import { PhotoViewer } from "./PhotoViewer";
import { AddPhotoSheet } from "./AddPhotoSheet";
import "./album.i18n";
import "./album.css";

export function AlbumScreen() {
  const t = useT();
  const session = useSession();
  const photos = usePhotos();
  const members = useMembers();
  const [profile] = useProfile();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  if (!session) {
    return (
      <div class="screen album-screen">
        <div class="panel album-empty">
          <ScrollText size={40} />
          <p>{t("album.needSession")}</p>
        </div>
      </div>
    );
  }

  return (
    <div class="screen album-screen">
      <header class="album-header">
        <h1 class="title-ornate">{t("album.title")}</h1>
        <button type="button" class="btn btn-primary album-add-btn" onClick={() => setAddOpen(true)}>
          <Plus size={18} /> {t("album.addPhoto")}
        </button>
      </header>

      {photos.length === 0 ? (
        <div class="panel album-empty">
          <ImageOff size={40} />
          <p>{t("album.emptyState")}</p>
        </div>
      ) : (
        <div class="album-grid">
          {photos.map((photo, i) => (
            <PhotoThumb key={photo.id} photo={photo} index={i} onOpen={() => setViewerIndex(i)} />
          ))}
        </div>
      )}

      {addOpen && <AddPhotoSheet onClose={() => setAddOpen(false)} />}

      {viewerIndex !== null && photos[viewerIndex] && (
        <PhotoViewer
          photos={photos}
          index={viewerIndex}
          memberById={memberById}
          ownId={profile.id}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
          onDelete={(id) => {
            removePhoto(id);
            setViewerIndex(null);
          }}
        />
      )}
    </div>
  );
}
