import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { effectiveSellerLocations } from "../permissions";
import {
  getLocationsSharedCached,
  getSellerResourcesSharedCached,
  listLocationsShared,
  loadSellerResourcesShared,
} from "../services/sharedResources";
import {
  listSellerDailySales,
  subscribeSellerLocationStock,
} from "../services/sellerService";
import { listSellerPendingSales } from "./offlineSales";
import {
  isEditableTarget,
  keyboardEventKeys,
  keyboardLookupKeys,
} from "./sellerDomain";

function useWarmResource({ initialValue, load, dependencies }) {
  const initial = initialValue();
  const [state, setState] = useState(() => ({
    status: initial == null ? "loading" : "ready",
    data: initial ?? null,
    error: null,
  }));
  const request = useRef(0);

  const refresh = useCallback(async ({ keepCurrent = true } = {}) => {
    const current = ++request.current;
    setState((previous) => ({
      ...previous,
      status: keepCurrent && previous.data != null ? "ready" : "loading",
      error: null,
    }));
    try {
      const data = await load();
      if (current === request.current) setState({ status: "ready", data, error: null });
      return data;
    } catch (error) {
      if (current === request.current) {
        setState((previous) => ({
          status: previous.data != null ? "ready" : "error",
          data: previous.data,
          error,
        }));
      }
      throw error;
    }
  // El llamador declara las dependencias que vuelven estable la carga.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    refresh({ keepCurrent: true }).catch(() => {});
    return () => { request.current += 1; };
  }, [refresh]);

  return { ...state, refresh };
}

export function useSellerLocations(profile) {
  return useWarmResource({
    initialValue: () => {
      const cached = getLocationsSharedCached(profile);
      return cached ? effectiveSellerLocations(profile, cached) : null;
    },
    load: async () => effectiveSellerLocations(profile, await listLocationsShared(profile)),
    dependencies: [profile.id, (profile.allowedLocationIds || []).join(",")],
  });
}

export function useSellerResources(profile) {
  return useWarmResource({
    initialValue: () => getSellerResourcesSharedCached(profile),
    load: () => loadSellerResourcesShared(profile),
    dependencies: [profile.id, (profile.allowedLocationIds || []).join(",")],
  });
}

export function useSellerLocationStock(profile, locationId) {
  const [state, setState] = useState({ status: "idle", data: [], error: null });
  useEffect(() => {
    if (!locationId) {
      setState({ status: "idle", data: [], error: null });
      return undefined;
    }
    let disposed = false;
    let unsubscribe = null;
    setState((current) => ({ ...current, status: current.data?.length ? "ready" : "loading", error: null }));
    subscribeSellerLocationStock({
      profile,
      locationId,
      onData: (data) => !disposed && setState({ status: "ready", data, error: null }),
      onError: (error) => !disposed && setState((current) => ({ status: current.data?.length ? "ready" : "error", data: current.data || [], error })),
    })
      .then((cleanup) => {
        if (disposed) cleanup?.();
        else unsubscribe = cleanup;
      })
      .catch((error) => {
        if (!disposed) setState((current) => ({ status: current.data?.length ? "ready" : "error", data: current.data || [], error }));
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [profile.id, locationId]);
  return state;
}

export function useSellerDailySales(profile, locationId) {
  const [state, setState] = useState({ status: "idle", data: [], error: null });
  const request = useRef(0);
  const refresh = useCallback(async () => {
    if (!locationId) {
      setState({ status: "idle", data: [], error: null });
      return [];
    }
    const current = ++request.current;
    setState((previous) => ({ ...previous, status: previous.data?.length ? "ready" : "loading", error: null }));
    try {
      const data = await listSellerDailySales(profile, locationId);
      if (current === request.current) setState({ status: "ready", data, error: null });
      return data;
    } catch (error) {
      if (current === request.current) setState((previous) => ({ status: previous.data?.length ? "ready" : "error", data: previous.data || [], error }));
      throw error;
    }
  }, [profile, locationId]);
  useEffect(() => {
    refresh().catch(() => {});
    return () => { request.current += 1; };
  }, [refresh]);
  return { ...state, refresh };
}

export function useSellerPendingSales(profile) {
  const [state, setState] = useState({ status: "loading", data: [], error: null });
  const refresh = useCallback(async () => {
    try {
      const data = await listSellerPendingSales(profile.id);
      setState({ status: "ready", data, error: null });
      return data;
    } catch (error) {
      setState((current) => ({ status: current.data?.length ? "ready" : "error", data: current.data || [], error }));
      throw error;
    }
  }, [profile.id]);
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);
  return { ...state, refresh };
}

function shortcutMap(items) {
  const lookup = new Map();
  (items || []).forEach((item) => {
    keyboardLookupKeys(item).forEach((key) => {
      if (!lookup.has(key)) lookup.set(key, item);
    });
  });
  return lookup;
}

export function useSellerKeyboard({
  enabled,
  products,
  discounts,
  actionShortcuts,
  onProduct,
  onDiscount,
  onShortcut,
  onContinue,
  onAdd,
  onSubtract,
}) {
  const productLookup = useMemo(() => shortcutMap(products), [products]);
  const discountLookup = useMemo(() => shortcutMap(discounts), [discounts]);
  const actionLookup = useMemo(() => shortcutMap(actionShortcuts), [actionShortcuts]);
  const handlers = useRef({});
  handlers.current = {
    enabled,
    productLookup,
    discountLookup,
    actionLookup,
    onProduct,
    onDiscount,
    onShortcut,
    onContinue,
    onAdd,
    onSubtract,
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const current = handlers.current;
      if (
        !current.enabled ||
        event.defaultPrevented ||
        event.repeat ||
        isEditableTarget(event.target) ||
        document.querySelector(".fm-overlay")
      ) return;
      if (event.code === "NumpadEnter" || event.key === "Enter") {
        event.preventDefault();
        current.onContinue?.();
        return;
      }
      if (event.code === "NumpadAdd" || event.key === "+") {
        event.preventDefault();
        current.onAdd?.();
        return;
      }
      if (
        event.code === "NumpadSubtract" ||
        event.key === "-" ||
        event.key === "Backspace"
      ) {
        event.preventDefault();
        current.onSubtract?.();
        return;
      }
      const keys = keyboardEventKeys(event);
      const find = (lookup) => keys.map((key) => lookup.get(key)).find(Boolean);
      const shortcut = find(current.actionLookup);
      if (shortcut) {
        event.preventDefault();
        current.onShortcut?.(shortcut);
        return;
      }
      const discount = find(current.discountLookup);
      if (discount) {
        event.preventDefault();
        current.onDiscount?.(discount);
        return;
      }
      const product = find(current.productLookup);
      if (product) {
        event.preventDefault();
        current.onProduct?.(product);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
