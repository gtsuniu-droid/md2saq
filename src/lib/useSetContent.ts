import { useEffect, useState } from "react";
import { ensureSetContent } from "./bank";

export function useSetContent(setId?: string, revision?: number) {
  const [state, setState] = useState<{ id?: string; revision?: number; ready?: boolean; error?: string }>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ id: setId, revision });
    if (setId) void ensureSetContent(setId).then(() => {
      if (active) setState({ id: setId, revision, ready: true });
    }).catch(error => {
      if (active) setState({ id: setId, revision, error: error instanceof Error ? error.message : "Could not load this set." });
    });
    return () => { active = false; };
  }, [setId, revision, retry]);
  return { ready: state.id === setId && state.revision === revision && !!state.ready, error: state.id === setId && state.revision === revision ? state.error : undefined, retry: () => setRetry(n => n + 1) };
}
