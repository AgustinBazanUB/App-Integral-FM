export default function ShippingProgress({ status, repository = false, customer = false }) {
  const labels = customer ? ["Preparado", "Despachado", "En camino", "Entregado"] : repository ? ["Venta registrada", "Preparado", "Retiro al repositorio", "En repositorio", "En camino al cliente", "Entrega confirmada"] : ["Venta registrada", "Preparado", "En camino al cliente", "Entrega confirmada"];
  const index = customer ? ({ listo_retirar: 0, hacia_repositorio: 1, recibido_repositorio: 1, reparto_final: 2, entregado: 3 }[status] ?? 0)
    : repository ? ({ listo_retirar: 1, hacia_repositorio: 2, recibido_repositorio: 3, reparto_final: 4, entregado: 5 }[status] ?? 0) : ({ listo_retirar: 1, reparto_final: 2, entregado: 3 }[status] ?? 0);
  const exception = ["cancelado", "devuelto", "no_entregado", "rechazado"].includes(status);
  return <ol className="fm-shipping-progress" aria-label="Progreso del envío">{labels.map((label, step) => <li key={label} aria-current={!exception && step === index ? "step" : undefined} className={!exception && (step < index || status === "entregado") ? "is-done" : !exception && step === index ? "is-current" : ""}>{label}</li>)}</ol>;
}
