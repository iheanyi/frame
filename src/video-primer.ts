type Decoder = {
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/** WebKit may report loadeddata before its first canvas-readable texture. */
export function primeVideoFrame(video: Decoder, onFrame: () => void): () => void {
  let active = true;
  const muted = video.muted;
  video.muted = true;
  const ready = () => {
    if (!active) return;
    active = false;
    video.pause();
    video.muted = muted;
    onFrame();
  };
  const callback = video.requestVideoFrameCallback?.(ready);
  void video.play().then(() => {
    if (callback === undefined) ready();
  }).catch(() => {
    if (!active) return;
    active = false;
    if (callback !== undefined) video.cancelVideoFrameCallback?.(callback);
    video.muted = muted;
  });
  return () => {
    if (!active) return;
    active = false;
    if (callback !== undefined) video.cancelVideoFrameCallback?.(callback);
    video.pause();
    video.muted = muted;
  };
}
