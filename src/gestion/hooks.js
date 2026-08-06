import { useCallback, useEffect, useRef, useState } from "react";

export function useAsyncData(loader, dependencies = []) {
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });
  const requestSequence = useRef(0);
  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setState((current) => ({ ...current, status: "loading", error: null }));
    try {
      const data = await loader();
      if (requestSequence.current !== requestId) return;
      setState({ status: "ready", data, error: null });
    } catch (error) {
      if (requestSequence.current !== requestId) return;
      setState({ status: "error", data: null, error });
    }
  // El llamador declara las dependencias que hacen estable al loader.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  return { ...state, refresh };
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  return online;
}
