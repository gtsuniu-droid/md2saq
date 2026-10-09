/** Make a downloaded backup self-contained after bank media moved out of JSON. */
export async function embedBankMedia<T>(value: T): Promise<T> {
  const urls = new Set<string>();
  const encoded = JSON.stringify(value, (_key, item) => {
    if (typeof item === "string" && /^https?:\/\/[^/]+\/api\/bank\?image=[a-f0-9]{64}$/.test(item)) urls.add(item);
    return item;
  });
  const embedded = new Map<string, string>();
  const pending = [...urls];
  for (let offset = 0; offset < pending.length; offset += 6) {
    await Promise.all(pending.slice(offset, offset + 6).map(async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not download a backup image. Reconnect and try again.");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Could not read a backup image.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      embedded.set(url, `data:${blob.type};base64,${btoa(binary)}`);
    }));
  }
  return JSON.parse(encoded, (_key, item) => typeof item === "string" ? embedded.get(item) ?? item : item) as T;
}
