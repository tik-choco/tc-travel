import "./post.i18n";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Check, Download, Share, Sparkles, X } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { getProfile, useProfile } from "../../lib/personal";
import { renderQr, startQrScan } from "../../lib/qr";
import { encodeCard, parseCard } from "../../lib/cardQr";
import { addReceivedCard } from "../../lib/cards";
import { Avatar } from "../common/Avatar";
import type { Card } from "../../lib/types";

interface Props {
  onClose: () => void;
}

/** The face-to-face exchange sheet: "My card" shows your card as a QR for the
 *  other person to scan; "Scan" points your camera at theirs. The QR is the
 *  whole delivery mechanism — a card can only ever cross between two phones
 *  that are physically together. */
export function CardExchange({ onClose }: Props) {
  const t = useT();
  const [profile, updateProfile] = useProfile();
  const [tab, setTab] = useState<"show" | "scan">("show");
  const [received, setReceived] = useState<Omit<Card, "receivedAt"> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanError, setScanError] = useState(false);
  const [copied, setCopied] = useState(false);

  const message = profile.cardMessage ?? "";

  // Minted per content change, not per render — `at` would otherwise bust the
  // memo every render and re-draw the QR continuously.
  const encoded = useMemo(
    () =>
      encodeCard({
        id: profile.id,
        name: profile.name,
        avatarEmoji: profile.avatarEmoji,
        color: profile.color,
        message,
        at: Date.now(),
      }),
    [profile.id, profile.name, profile.avatarEmoji, profile.color, message],
  );

  useEffect(() => {
    if (tab !== "show" || !canvasRef.current) return;
    renderQr(canvasRef.current, encoded).catch((err) => {
      console.error("tc-travel: renderQr failed", err);
    });
  }, [tab, encoded]);

  // Native share sheet when available; a browser that advertises share but
  // fails on plain text (or lacks it entirely) falls back to the clipboard,
  // same degrade path as bragCardCanvas's image share.
  const handleShareCard = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: t("post.exchangeTitle"), text: encoded });
        return;
      } catch (err) {
        if ((err as DOMException | null)?.name === "AbortError") return;
        console.error("tc-travel: card share failed", err);
      }
    }
    try {
      await navigator.clipboard.writeText(encoded);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("tc-travel: clipboard write failed", err);
    }
  };

  const handleSaveQr = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tc-travel-card-qr.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  // Camera runs only while actually scanning — receiving a card swaps the
  // video out for the confirmation, and this effect's cleanup releases the
  // stream (same acquisition/cleanup shape as room/QrModal.tsx).
  const scanning = tab === "scan" && received === null;
  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    setScanError(false);
    const video = videoRef.current;
    let stopped = false;
    let stream: MediaStream | null = null;
    let stop: (() => void) | undefined;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        return video.play().catch(() => undefined);
      })
      .then(() => {
        if (stopped) return;
        stop = startQrScan(video, (text) => {
          if (stopped) return;
          const card = parseCard(text);
          // Non-card QRs (e.g. a room invite) and your own card are silently
          // ignored — the loop just keeps scanning.
          if (!card || card.id === getProfile().id) return;
          stopped = true; // one card per scan session; further frames are stale
          addReceivedCard(card);
          setReceived(card);
        });
      })
      .catch((err) => {
        console.error("tc-travel: card scan camera failed", err);
        if (!stopped) setScanError(true);
      });

    return () => {
      stopped = true;
      stop?.();
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [scanning]);

  // Scanned/received cards only ever carry an emoji (the QR payload can't
  // carry an image) — this stays emoji-based. The own-card face below is the
  // one place that can show a real photo, via the shared <Avatar>.
  const cardFace = (card: Omit<Card, "receivedAt">, extraClass = "") => (
    <div class={`card-face${extraClass ? ` ${extraClass}` : ""}`} style={`--card-color: ${card.color}`}>
      <span class="avatar avatar-lg" aria-hidden="true">
        {card.avatarEmoji}
      </span>
      <span class="card-face-name">{card.name}</span>
      {card.message !== "" && <p class="card-face-message">{card.message}</p>}
    </div>
  );

  const ownCardFace = (
    <div class="card-face" style={`--card-color: ${profile.color}`}>
      <Avatar self size="lg" />
      <span class="card-face-name">{profile.name}</span>
      {message !== "" && <p class="card-face-message">{message}</p>}
    </div>
  );

  return (
    <div class="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("post.exchangeTitle")}>
      <div class="modal-card" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <div class="qr-modal-header">
          <p class="title-ornate">{t("post.exchangeTitle")}</p>
          <button type="button" class="btn btn-icon" aria-label={t("post.close")} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>

        <div class="qr-tabs">
          <button
            type="button"
            class={`btn${tab === "show" ? " btn-primary" : ""}`}
            onClick={() => setTab("show")}
          >
            {t("post.showMyCard")}
          </button>
          <button
            type="button"
            class={`btn${tab === "scan" ? " btn-primary" : ""}`}
            onClick={() => setTab("scan")}
          >
            {t("post.scan")}
          </button>
        </div>

        {tab === "show" ? (
          <div class="qr-modal-body">
            <div class="qr-tile">
              <canvas ref={canvasRef} />
            </div>
            {ownCardFace}
            <div class="field card-message-field">
              <span class="settings-label">{t("post.myMessage")}</span>
              <textarea
                class="input card-message-input"
                maxLength={300}
                placeholder={t("post.myMessagePlaceholder")}
                aria-label={t("post.myMessage")}
                value={message}
                onInput={(e) => updateProfile({ cardMessage: (e.target as HTMLTextAreaElement).value })}
              />
            </div>
            <div class="qr-actions">
              <button type="button" class="btn btn-outlined" onClick={handleShareCard}>
                {copied ? <Check aria-hidden="true" /> : <Share aria-hidden="true" />}
                {copied ? t("post.copied") : t("post.share")}
              </button>
              <button type="button" class="btn btn-outlined" onClick={handleSaveQr}>
                <Download aria-hidden="true" />
                {t("post.saveQr")}
              </button>
            </div>
            <p class="qr-scan-hint">{t("post.showHint")}</p>
          </div>
        ) : received ? (
          <div class="qr-modal-body card-received">
            {cardFace(received, "card-received-fx")}
            <p class="card-received-title">
              <Sparkles size={18} aria-hidden="true" /> {t("post.received", { name: received.name })}
            </p>
            <p class="card-received-nudge">{t("post.showYoursNudge")}</p>
            <div class="qr-actions">
              <button type="button" class="btn btn-outlined" onClick={() => setReceived(null)}>
                {t("post.scanAnother")}
              </button>
              <button
                type="button"
                class="btn btn-primary"
                onClick={() => {
                  setReceived(null);
                  setTab("show");
                }}
              >
                {t("post.showMyCard")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div class="qr-scan-frame">
              <video ref={videoRef} class="qr-scan-video" muted playsInline autoPlay />
              <div class="qr-scan-guides" aria-hidden="true">
                <span class="qr-scan-corner qr-scan-corner-tl" />
                <span class="qr-scan-corner qr-scan-corner-tr" />
                <span class="qr-scan-corner qr-scan-corner-bl" />
                <span class="qr-scan-corner qr-scan-corner-br" />
              </div>
            </div>
            <div class="qr-modal-body qr-scan-footer">
              <p class="qr-scan-hint">{t("post.scanHint")}</p>
              {scanError && <p class="qr-scan-error">{t("post.cameraError")}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
