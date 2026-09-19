/**
 * Pictures attached to questions are stored inline as data URLs, resized so a
 * set stays small enough for the bank (Netlify accepts about 6 MB per request).
 */
export const MAX_EDGE = 1400;
export const JPEG_QUALITY = 0.82;

export async function compressImage(file: File, maxEdge = MAX_EDGE): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  // PNG keeps line drawings crisp; photographs go to JPEG.
  const keepPng = file.type === "image/png" && file.size < 400_000;
  return keepPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

/** Approximate byte size of a data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  return Math.round(((dataUrl.length - i - 1) * 3) / 4);
}
