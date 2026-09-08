/** Copy original pixels, never the styled composition or CSS preview size. */
export function copyScreen(source: HTMLVideoElement | HTMLCanvasElement): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
    return Promise.reject(new Error('Image copying requires a browser with clipboard access.'));
  const video = source instanceof HTMLVideoElement;
  const width = video ? source.videoWidth : source.width;
  const height = video ? source.videoHeight : source.height;
  if (!width || !height || (video && source.readyState < 2))
    return Promise.reject(new Error('Wait for a screen image to load.'));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(source, 0, 0);
  const png = new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('Could not create the screen image.')), 'image/png'));
  return navigator.clipboard.write([new ClipboardItem({'image/png': png})]);
}
