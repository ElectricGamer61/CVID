import { useEffect } from "react";

// Lightbox preview for a finished video. Click the backdrop or press Esc to close.
export function VideoModal({
  src,
  title,
  onClose,
  onDownload,
}: {
  src: string;
  title?: string;
  onClose: () => void;
  onDownload?: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="vm-back" onClick={onClose}>
      <div className="vm-box" onClick={(e) => e.stopPropagation()}>
        <div className="vm-head">
          <span className="vm-title">{title || "Preview"}</span>
          <button className="icon-btn" onClick={onClose} title="Close">✕</button>
        </div>
        <video className="vm-video" src={src} controls autoPlay playsInline />
        {onDownload && (
          <div className="vm-actions">
            <button className="primary" onClick={onDownload}>⬇ Download</button>
          </div>
        )}
      </div>
    </div>
  );
}
