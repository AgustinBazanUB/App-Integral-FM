import { useEffect, useState } from "react";

export default function ShippingAccessQr({ url, title = "Abrir en el teléfono del repartidor", description = "Escaneá este QR con la cámara del teléfono. Abre el panel autorizado para este pedido y tramo." }) {
  const [src, setSrc] = useState(""), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; setSrc(""); setFailed(false);
    import("qrcode").then(module => (module.default || module).toDataURL(url, { width: 280, margin: 4, errorCorrectionLevel: "M" })).then(value => live && setSrc(value)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [url]);
  return <div className="fm-courier-access-qr">
    <h3>{title}</h3>
    <p>{description}</p>
    {src && <img src={src} width="280" height="280" alt="QR temporal de acceso autorizado al panel del repartidor" />}
    {failed && <p role="alert">No se pudo generar el QR. Podés copiar el enlace autorizado.</p>}
    <a className="fm-button fm-button--secondary" href={url} target="_blank" rel="noreferrer">Abrir panel del repartidor</a>
    <p className="fm-shipping-muted">Compartilo únicamente con el repartidor asignado. Tiene el mismo vencimiento que el enlace; un nuevo acceso revoca el anterior.</p>
  </div>;
}
