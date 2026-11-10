import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "../../router";

const ScreenContext = createContext(null);

export function OliviaScreenProvider({ children }) {
  const { pathname, search } = useLocation();
  const [screen, setScreen] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [review, setReview] = useState(null);
  const [guideRequest, setGuideRequest] = useState(null);
  const [guideCommand, setGuideCommand] = useState(null);
  const [guideContext, setGuideContext] = useState(null);
  const publish = useCallback((route, owner, fields) => {
    setScreen({ route, owner, fields });
    return () => setScreen((current) => current?.owner === owner ? null : current);
  }, []);
  const context = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    const params = new URLSearchParams(search || "");
    const queryLocationId = params.get("locationId") || params.get("location") || "";
    const queryView = params.get("view") || "";
    return {
      route: pathname,
      module: parts[0] === "vendedor" ? "seller" : parts[1] || "dashboard",
      ...(queryView && /^[A-Za-z0-9_-]{1,60}$/.test(queryView) ? { view: queryView } : {}),
      ...(queryLocationId && /^[A-Za-z0-9_-]{1,128}$/.test(queryLocationId) ? { locationId: queryLocationId } : {}),
      ...(parts[1] === "locations" && parts[2] ? { locationId: decodeURIComponent(parts[2]), entityType: "location", entityId: decodeURIComponent(parts[2]) } : {}),
      ...(parts[1] === "warehouse" && parts[2] ? { warehouseId: decodeURIComponent(parts[2]), entityType: "warehouse", entityId: decodeURIComponent(parts[2]) } : {}),
      ...(screen?.route === pathname ? screen.fields : screen?.fields?.locationId ? { locationId: screen.fields.locationId } : {}),
      ...(guideContext ? { uiGuide: guideContext } : {}),
    };
  }, [pathname, search, screen, guideContext]);
  return <ScreenContext.Provider value={{ context, publish, assistantOpen, setAssistantOpen, review, setReview, guideRequest, setGuideRequest, guideCommand, setGuideCommand, setGuideContext }}>{children}</ScreenContext.Provider>;
}

export function useOliviaContext() {
  return useContext(ScreenContext)?.context || {};
}

export function useOliviaVisibility() {
  return useContext(ScreenContext) || { assistantOpen: false, setAssistantOpen: () => {} };
}

// Publish only IDs, view and filters. Live prices, stock and permissions are read by the backend.
export function useOliviaScreenContext(fields) {
  const provider = useContext(ScreenContext);
  const { pathname } = useLocation();
  const serialized = JSON.stringify(fields);
  useEffect(() => {
    if (!provider) return undefined;
    return provider.publish(pathname, Symbol("screen"), JSON.parse(serialized));
  }, [provider?.publish, pathname, serialized]);
}

export function useOliviaRefresh(refresh) {
  useEffect(() => {
    const onCompleted = () => Promise.resolve(refresh()).catch(() => {});
    window.addEventListener("flor-mia:olivia-completed", onCompleted);
    return () => window.removeEventListener("flor-mia:olivia-completed", onCompleted);
  }, [refresh]);
}
