// Thumbnail hover preview (F-23 / S-11). Mounted by the row that is currently hovered (the
// panel keeps at most one), plays the first HOVER_PREVIEW_SECONDS of the lowest-bitrate mp4
// muted and on a loop, and tears the <video> down on unmount (src = ""; load()). The
// thumbnail stays visible until the video has a frame to show.
import { useEffect, useRef, useState } from "preact/hooks";
import { HOVER_PREVIEW_SECONDS } from "@/shared/constants";

export function HoverPreview({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) {
      return undefined;
    }
    setReady(false);
    const onTimeUpdate = () => {
      if (video.currentTime >= HOVER_PREVIEW_SECONDS) {
        video.currentTime = 0;
      }
    };
    const onPlaying = () => setReady(true);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("playing", onPlaying);
    video.muted = true;
    video.src = src;
    video.play().catch(() => {
      // Autoplay refused or source failed: the thumbnail simply stays.
    });
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("playing", onPlaying);
      video.pause();
      video.src = "";
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      class="xap-panel__hover-video"
      data-ready={ready ? "true" : "false"}
      muted
      playsInline
      loop
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
