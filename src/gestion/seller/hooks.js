import { useCallback, useEffect, useRef, useState } from "react";
import { useAsyncData } from "../hooks";
import {
  listSellerDailySales,
  listSellerLocations,
  subscribeSellerLocationStock,
} from "../services/sellerService";
import { listSellerPendingSales } from "./offlineSales";
import { isEditableTarget, keyMatchesEvent } from "./sellerDomain";

export function useSellerLocations(profile) {
  return useAsyncData(() => listSellerLocations(profile), [profile.id]);
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
    setState({ status: "loading", data: [], error: null });
    subscribeSellerLocationStock({
      profile,
      locationId,
      onData: (data) => !disposed && setState({ status: "ready", data, error: null }),
      onError: (error) => !disposed && setState({ status: "error", data: [], error }),
    })
      .then((cleanup) => {
        if (disposed) cleanup?.();
        else unsubscribe = cleanup;
      })
      .catch((error) => {
        if (!disposed) setState({ status: "error", data: [], error });
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [profile, locationId]);
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
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    try {
      const data = await listSellerDailySales(profile, locationId);
      if (current === request.current) setState({ status: "ready", data, error: null });
      return data;
    } catch (error) {
      if (current === request.current) setState({ status: "error", data: [], error });
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
      setState({ status: "error", data: [], error });
      throw error;
    }
  }, [profile.id]);
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);
  return { ...state, refresh };
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
  const handlers = useRef({});
  handlers.current = {
    products,
    discounts,
    actionShortcuts,
    onProduct,
    onDiscount,
    onShortcut,
    onContinue,
    onAdd,
    onSubtract,
  };
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        isEditableTarget(event.target) ||
        document.querySelector(".fm-overlay")
      ) return;
      const current = handlers.current;
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
      const shortcut = current.actionShortcuts?.find((item) => keyMatchesEvent(item, event));
      if (shortcut) {
        event.preventDefault();
        current.onShortcut?.(shortcut);
        return;
      }
      const discount = current.discounts?.find((item) => keyMatchesEvent(item, event));
      if (discount) {
        event.preventDefault();
        current.onDiscount?.(discount);
        return;
      }
      const product = current.products?.find((item) => keyMatchesEvent(item, event));
      if (product) {
        event.preventDefault();
        current.onProduct?.(product);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
