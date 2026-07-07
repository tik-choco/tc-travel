// The "bring your solo memories into the party" moment. Mounted by the
// orchestrator right after a join, and ONLY when hasLocalMemories() is true —
// so the sheet always has something warm to offer. Sharing copies (never
// moves: clearAfter stays false) the solo pins/diary/photos into the room via
// shareSoloMemoriesToRoom, so the traveller's own map keeps every memory even
// if they later leave the party.
import "./solo.i18n";
import "./solo.css";
import { useMemo, useState } from "preact/hooks";
import { BookOpen, Camera, Heart, LoaderCircle, MapPin, PartyPopper, Sparkles } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { localSnapshot } from "../../lib/local/localMemories";
import { shareSoloMemoriesToRoom, type SoloShareResult } from "../../lib/memories";

// offer → sharing → done, with a gentle "failed" detour when nothing landed
// (connection dropped mid-share). Local copies are untouched in every phase.
type Phase = "offer" | "sharing" | "done" | "failed";

export function SoloShareSheet(props: {
  onClose: () => void;
  onShared?: (result: { pins: number; diary: number; photos: number }) => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("offer");
  const [shared, setShared] = useState<SoloShareResult | null>(null);

  // Read once on mount: the sheet describes the memories that existed at the
  // join moment; live-updating counts mid-dialog would shift underfoot.
  const counts = useMemo(() => {
    const snap = localSnapshot();
    return { pins: snap.pins.length, diary: snap.diary.length, photos: snap.photos.length };
  }, []);

  const handleShare = async () => {
    if (phase === "sharing") return;
    setPhase("sharing");
    try {
      const result = await shareSoloMemoriesToRoom({ clearAfter: false });
      if (result.pins + result.diary + result.photos === 0) {
        // The sheet only mounts with memories to share, so zero landed means
        // the room wasn't reachable — a gentle retry, never a loss.
        setPhase("failed");
        return;
      }
      setShared(result);
      setPhase("done");
      props.onShared?.(result);
    } catch {
      setPhase("failed");
    }
  };

  // Count chips, reused for the offer (what you carry) and the confirmation
  // (what arrived). Zero-count kinds are simply not mentioned.
  const countChips = (c: { pins: number; diary: number; photos: number }) => (
    <div class="solo-share-counts">
      {c.pins > 0 && (
        <span class="solo-share-stat solo-share-stat-pins">
          <MapPin size={15} aria-hidden="true" />
          {t("solo.sharePlaces", { n: c.pins })}
        </span>
      )}
      {c.diary > 0 && (
        <span class="solo-share-stat solo-share-stat-diary">
          <BookOpen size={15} aria-hidden="true" />
          {t("solo.sharePages", { n: c.diary })}
        </span>
      )}
      {c.photos > 0 && (
        <span class="solo-share-stat solo-share-stat-photos">
          <Camera size={15} aria-hidden="true" />
          {t("solo.sharePhotos", { n: c.photos })}
        </span>
      )}
    </div>
  );

  return (
    <div
      class="modal-backdrop"
      onClick={() => {
        // Don't let a stray backdrop tap cancel an in-flight share.
        if (phase !== "sharing") props.onClose();
      }}
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t("solo.shareTitle")}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="sheet-handle" />
        <div class="sheet-body" aria-live="polite">
          {phase === "offer" && (
            <>
              <p class="title-ornate">
                <Sparkles aria-hidden="true" size={20} />
                {t("solo.shareTitle")}
              </p>
              <p class="solo-share-lead">{t("solo.shareLead")}</p>
              {countChips(counts)}
              <div class="solo-share-actions">
                <button type="button" class="btn btn-primary btn-block" onClick={() => void handleShare()}>
                  {t("solo.shareConfirm")}
                </button>
                <button type="button" class="btn btn-ghost btn-block" onClick={props.onClose}>
                  {t("solo.shareKeep")}
                </button>
              </div>
            </>
          )}

          {phase === "sharing" && (
            <div class="solo-share-busy">
              <span class="solo-share-spinner" aria-hidden="true">
                <LoaderCircle size={28} />
              </span>
              <p>{t("solo.shareBusy")}</p>
            </div>
          )}

          {phase === "done" && shared && (
            <div class="solo-share-done soft-pop">
              <span class="solo-share-done-icon gold-shimmer" aria-hidden="true">
                <PartyPopper size={30} />
                <i class="solo-share-twinkle solo-share-twinkle-1">✦</i>
                <i class="solo-share-twinkle solo-share-twinkle-2">✦</i>
                <i class="solo-share-twinkle solo-share-twinkle-3">✦</i>
              </span>
              <p class="solo-share-done-title">{t("solo.shareDoneTitle")}</p>
              <p class="solo-share-done-detail">
                {t("solo.shareDoneDetail", { total: shared.pins + shared.diary + shared.photos })}
              </p>
              {countChips(shared)}
              <button type="button" class="btn btn-primary btn-block" onClick={props.onClose}>
                {t("solo.shareDoneClose")}
              </button>
            </div>
          )}

          {phase === "failed" && (
            <div class="solo-share-fail soft-pop">
              <span class="solo-share-fail-icon" aria-hidden="true">
                <Heart size={26} />
              </span>
              <p class="solo-share-fail-title">{t("solo.shareFailTitle")}</p>
              <p class="solo-share-fail-detail">{t("solo.shareFailDetail")}</p>
              <div class="solo-share-actions solo-share-fail-actions">
                <button type="button" class="btn btn-tonal btn-block" onClick={() => void handleShare()}>
                  {t("solo.shareRetry")}
                </button>
                <button type="button" class="btn btn-ghost btn-block" onClick={props.onClose}>
                  {t("solo.shareLater")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
