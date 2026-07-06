import "./room.i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import { X } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { renderQr, buildJoinUrl, parseJoinInput, startQrScan } from "../../lib/qr";
import { joinRoom } from "../../lib/store";

interface Props {
  roomId: string;
  onClose: () => void;
  /** Opens directly on the Scan tab (used by the Home "scan QR" button). */
  initialTab?: "show" | "scan";
}

export function QrModal({ roomId, onClose, initialTab = "show" }: Props) {
  const t = useT();
  const canShow = roomId !== "";
  const [tab, setTab] = useState<"show" | "scan">(canShow ? initialTab : "scan");
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanError, setScanError] = useState(false);

  const joinUrl = canShow ? buildJoinUrl(roomId) : "";

  useEffect(() => {
    if (tab !== "show" || !canvasRef.current) return;
    renderQr(canvasRef.current, joinUrl).catch((err) => {
      console.error("tc-travel: renderQr failed", err);
    });
  }, [tab, joinUrl]);

  useEffect(() => {
    if (tab !== "scan" || !videoRef.current) return;
    setScanError(false);
    const video = videoRef.current;
    let stopped = false;
    let stream: MediaStream | null = null;
    let stop: (() => void) | undefined;

    // startQrScan() only reads frames off an already-playing video — the
    // camera stream is this component's responsibility to acquire/release.
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
          const id = parseJoinInput(text);
          if (id) void joinRoom(id).then(onClose);
        });
      })
      .catch((err) => {
        console.error("tc-travel: QR scan camera failed", err);
        if (!stopped) setScanError(true);
      });

    return () => {
      stopped = true;
      stop?.();
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
    // Intentionally re-runs only when switching to/from the scan tab, not on
    // every onClose identity change — the closure's behavior is stable either way.
  }, [tab]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("tc-travel: clipboard write failed", err);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({ url: joinUrl });
    } catch (err) {
      console.error("tc-travel: native share failed", err);
    }
  };

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal-card panel" onClick={(e) => e.stopPropagation()}>
        <div class="qr-modal-body">
          <div class="qr-modal-close">
            <button type="button" class="btn btn-icon" aria-label={t("qr.close")} onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          </div>
          <p class="title-ornate">{t("qr.title")}</p>

          {canShow && (
            <div class="qr-tabs">
              <button
                type="button"
                class={`btn${tab === "show" ? " btn-primary" : ""}`}
                onClick={() => setTab("show")}
              >
                {t("qr.tabShow")}
              </button>
              <button
                type="button"
                class={`btn${tab === "scan" ? " btn-primary" : ""}`}
                onClick={() => setTab("scan")}
              >
                {t("qr.tabScan")}
              </button>
            </div>
          )}

          {tab === "show" ? (
            <>
              <div class="qr-canvas-wrap">
                <canvas ref={canvasRef} />
              </div>
              <div class="qr-actions">
                <button type="button" class="btn" onClick={handleCopy}>
                  {copied ? t("qr.copied") : t("qr.copyLink")}
                </button>
                {typeof navigator.share === "function" && (
                  <button type="button" class="btn btn-primary" onClick={handleShare}>
                    {t("qr.share")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <video ref={videoRef} class="qr-scan-video" muted playsInline autoPlay />
              <p style={{ textAlign: "center", marginTop: "0.5rem", color: "var(--ink-soft)" }}>
                {t("qr.scanHint")}
              </p>
              {scanError && <p class="qr-scan-error">{t("qr.cameraError")}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
