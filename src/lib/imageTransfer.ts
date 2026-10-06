/** Edge and OS screenshot drags can omit the MIME type until the drop occurs. */
export function isImageFile(file: Pick<File, "type" | "name">): boolean {
  return file.type.startsWith("image/") || ((!file.type || file.type === "application/octet-stream") && /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name));
}

export function imageTransferFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files = Array.from(transfer.files ?? []);
  // Some clipboard implementations expose images only through items.
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && !files.some((f) => f === file || (f.name === file.name && f.size === file.size && f.type === file.type && f.lastModified === file.lastModified))) files.push(file);
  }
  return files.filter(isImageFile);
}

export function hasFileTransfer(transfer: DataTransfer | null): boolean {
  return !!transfer && (Array.from(transfer.types ?? []).includes("Files") || (transfer.files?.length ?? 0) > 0 || Array.from(transfer.items ?? []).some((item) => item.kind === "file"));
}
