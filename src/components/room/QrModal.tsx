import "./room.i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import { X, Copy, Check, Share, MessageCircle } from "lucide-preact";
import { useT } from "../../lib/i18n";
import { renderQr, buildJoinUrl, parseJoinInput, startQrScan } from "../../lib/qr";
import { joinRoom, useSession } from "../../lib/store";
import { guildChatUrl } from "../../lib/family/guildChatLink";

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

  // Only meaningful when this modal represents the currently-joined room (not
  // the solo/Home "scan a friend's invite" invocation, which passes roomId="").
  // Gives the invite text a party name to reference, and lets the group-chat
  // hand-off below reuse the exact room id/name pair the party already agreed on.
  const session = useSession();
  const inRoomSession = canShow && session && session.roomId === roomId ? session : null;
  const roomName = inRoomSession?.meta.name ?? "";
  const inviteText = roomName ? t("qr.inviteTextNamed", { name: roomName }) : t("qr.inviteText");

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
      // Carries the invitation's context (what this is, whose party) along
      // with the bare link — a URL alone means nothing dropped into a LINE/X
      // thread without the surrounding chat for context.
      await navigator.clipboard.writeText(`${inviteText}\n${joinUrl}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("tc-travel: clipboard write failed", err);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({ title: t("qr.title"), text: inviteText, url: joinUrl });
    } catch (err) {
      console.error("tc-travel: native share failed", err);
    }
  };

  const handleOpenGroupChat = () => {
    // New tab: this tab owns the live P2P session, and navigating away here
    // would tear it down (see GuildChatLink.tsx, which hands off the same way).
    window.open(guildChatUrl(roomId, roomName), "_blank", "noopener,noreferrer");
  };

  return (
    <div class="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("qr.title")}>
      <div class="modal-card" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <div class="qr-modal-header">
          <p class="title-ornate">{t("qr.title")}</p>
          <button type="button" class="btn btn-icon" aria-label={t("qr.close")} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>

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
          <div class="qr-modal-body">
            <div class="qr-tile">
              <canvas ref={canvasRef} />
            </div>
            <div class="qr-actions">
              <button type="button" class="btn btn-outlined" onClick={handleCopy}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? t("qr.copied") : t("qr.copyLink")}
              </button>
              {typeof navigator.share === "function" && (
                <button type="button" class="btn btn-primary" onClick={handleShare}>
                  <Share aria-hidden="true" />
                  {t("qr.share")}
                </button>
              )}
            </div>
            {inRoomSession && (
              <div class="qr-actions">
                <button type="button" class="btn btn-outlined" onClick={handleOpenGroupChat}>
                  <MessageCircle aria-hidden="true" />
                  {t("qr.groupChat")}
                </button>
              </div>
            )}
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
              <p class="qr-scan-hint">{t("qr.scanHint")}</p>
              {scanError && <p class="qr-scan-error">{t("qr.cameraError")}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
