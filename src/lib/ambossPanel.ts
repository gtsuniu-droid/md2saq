/** Tiny store for the AMBOSS side pane: which term is open, if any. */
export interface PanelRequest {
  pgId: string;
  term: string;
}

let current: PanelRequest | null = null;
const listeners = new Set<(r: PanelRequest | null) => void>();

export function openAmbossPanel(r: PanelRequest): void {
  current = r;
  listeners.forEach((l) => l(current));
}

export function closeAmbossPanel(): void {
  current = null;
  listeners.forEach((l) => l(null));
}

export function subscribeAmbossPanel(l: (r: PanelRequest | null) => void): () => void {
  listeners.add(l);
  l(current);
  return () => {
    listeners.delete(l);
  };
}
