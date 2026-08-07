import { useState } from "react";
import { Badge, Button, Modal } from "../../design-system";
import { reconnectFirestore } from "../connection";
import { useAuth } from "../AuthContext";
import { useConnectionStatus } from "../hooks";
import { Icon } from "./icons";

const labels = {
  online: "En línea",
  offline: "Sin conexión",
  reconnecting: "Reconectando",
};

export default function ConnectionIndicator({ compact = false }) {
  const { profile } = useAuth();
  const status = useConnectionStatus();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const busy = status === "reconnecting";
  const online = status === "online";

  const reconnect = async () => {
    setMessage("");
    try {
      const connected = await reconnectFirestore(profile.id);
      setMessage(connected ? "La conexión con Firestore está disponible." : "El dispositivo continúa sin conexión.");
    } catch {
      setMessage("No pudimos confirmar conexión con Firestore. Podés volver a intentar cuando mejore la red.");
    }
  };

  return (
    <>
      <button
        type="button"
        className={`fm-connection-trigger ${compact ? "is-compact" : ""}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Estado de conexión: ${labels[status]}`}
      >
        <Badge tone={online ? "success" : "warning"} icon={busy ? "RefreshCw" : online ? "Wifi" : "WifiOff"}>
          {labels[status]}
        </Badge>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Estado de conexión"
        description="Comprobación compartida por toda la aplicación integral."
      >
        <div className="fm-connection-panel">
          <div className={`fm-connection-panel__state is-${status}`}>
            <Icon name={busy ? "RefreshCw" : online ? "Wifi" : "WifiOff"} />
            <div>
              <strong>{labels[status]}</strong>
              <p>{online
                ? "La aplicación puede consultar y registrar información normalmente."
                : "Podés seguir usando la información disponible y el Panel Vendedor mantiene su cola de ventas pendientes offline."}</p>
            </div>
          </div>
          {!online ? (
            <Button icon="RefreshCw" disabled={busy} onClick={reconnect}>
              {busy ? "Reconectando…" : "Reconectar"}
            </Button>
          ) : null}
          {message ? <p className="fm-connection-panel__message" aria-live="polite">{message}</p> : null}
        </div>
      </Modal>
    </>
  );
}
