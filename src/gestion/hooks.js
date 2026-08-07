import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getConnectionSnapshot, subscribeConnection } from "./connection";

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
      if (requestSequence.current !== requestId) return data;
      setState({ status: "ready", data, error: null });
      return data;
    } catch (error) {
      if (requestSequence.current !== requestId) throw error;
      setState({ status: "error", data: null, error });
      throw error;
    }
  // El llamador declara las dependencias que hacen estable al loader.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    refresh().catch(() => {});
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  return { ...state, refresh };
}

export function useConnectionStatus() {
  return useSyncExternalStore(
    subscribeConnection,
    getConnectionSnapshot,
    () => "online",
  );
}

export function useOnlineStatus() {
  return useConnectionStatus() === "online";
}
