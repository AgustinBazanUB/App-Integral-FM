import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";

const LauncherHost = createContext({ host: null, setHost: () => {} });
export function OliviaLauncherProvider({ children }) {
  const [host, setHost] = useState(null);
  return <LauncherHost.Provider value={{ host, setHost }}>{children}</LauncherHost.Provider>;
}
export function OliviaLauncherSlot() {
  const { setHost } = useContext(LauncherHost);
  return <span className="fm-olivia-slot" ref={setHost} />;
}
export function OliviaLauncherPortal({ children }) {
  const { host } = useContext(LauncherHost);
  return host ? createPortal(children, host) : null;
}
