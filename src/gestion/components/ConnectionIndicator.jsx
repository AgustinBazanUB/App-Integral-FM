
import { useCallback, useRef, useState } from "react";
import { Button } from "../../design-system";
import { reconnectFirestore } from "../connection";
import { useAuth } from "../AuthContext";
import { useConnectionStatus } from "../hooks";
import AnchoredPopover from "./AnchoredPopover";
import { Icon } from "./icons";

const labels = {
  online: "En línea",
  offline: "Sin conexión",
  reconnecting: "Reconectando",
};

export default function ConnectionIndicator() {
  const { profile } = useAuth();
  const status = useConnectionStatus();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const triggerRef = useRef(null);
  const busy = status === "reconnecting";
  const online = status === "online";
  const close = useCallback(() => setOpen(false), []);

  const reconnect = async () => {
    setMessage("");
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMessage("No se pudo restablecer la conexión.");
      return;
    }
    try {
      const connected = await reconnectFirestore(profile.id);
      setMessage(connected ? "Conexión restablecida." : "No se pudo restablecer la conexión.");
    } catch {
      setMessage("No se pudo restablecer la conexión.");
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`fm-connection-trigger is-${status}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Estado de conexión: ${labels[status]}`}
      >
        <Icon name={busy ? "RefreshCw" : online ? "Wifi" : "WifiOff"} />
        <span>{labels[status]}</span>
      </button>
      <AnchoredPopover
        open={open}
        onClose={close}
        triggerRef={triggerRef}
        className="fm-connection-popover"
        role="dialog"
        ariaLabel="Estado de conexión"
      >
        <div className="fm-connection-popover__head">
          <span className={`fm-connection-popover__icon is-${status}`}><Icon name={busy ? "RefreshCw" : online ? "Wifi" : "WifiOff"} /></span>
          <div><small>Estado de conexión</small><strong>{labels[status]}</strong></div>
        </div>
        <p>{online ? "Conexión disponible." : busy ? "Comprobando conexión con Firestore…" : "Sin conexión."}</p>
        {!online ? (
          <Button icon="RefreshCw" variant="secondary" loading={busy} onClick={reconnect}>
            Reconectar
          </Button>
        ) : null}
        {message ? <p className="fm-connection-popover__message" aria-live="polite">{message}</p> : null}
      </AnchoredPopover>
    </>
  );
}
