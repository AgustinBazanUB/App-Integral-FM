import { useEffect, useState } from "react";
import { Button } from "../../design-system";
import { createShippingSaleRequest, readPendingShippingSale } from "../services/shippingService";
export default function ShippingSaleRecovery({ profile, onRecovered }) {
  const [pending, setPending] = useState(() => readPendingShippingSale(profile.id)), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const refresh = () => setPending(readPendingShippingSale(profile.id)); window.addEventListener("shipping-intent", refresh); return () => window.removeEventListener("shipping-intent", refresh); }, [profile.id]);
  if (!pending) return null;
  return <div className="fm-shipping-recovery" role="status"><p>Hay una venta con envío pendiente de confirmación. Recuperá su resultado antes de volver a cargarla.</p><Button loading={busy} onClick={async () => { setBusy(true); setError(""); try { const result = await createShippingSaleRequest({ ...pending.sale, profile }); onRecovered?.(result); } catch (error) { setError(error.message); } finally { setBusy(false); } }}>Recuperar confirmación de envío</Button>{error && <p role="alert">{error}</p>}</div>;
}
