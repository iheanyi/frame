/** Fit the source uniformly; never clamp width independently from height. */
export function fitPreview(width: number, height: number, availableWidth: number, availableHeight: number) {
  const scale = Math.max(0, Math.min(availableWidth / width, availableHeight / height));
  return { width: width * scale, height: height * scale };
}
