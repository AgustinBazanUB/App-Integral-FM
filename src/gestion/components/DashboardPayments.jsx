import { useState } from "react";
import { EmptyState } from "../../design-system";
import { formatMoney } from "../formatters";

export default function DashboardPayments({ breakdown }) {
  const [view, setView] = useState("percentage");
  const [selectedKey, setSelectedKey] = useState(null);
  const selected = breakdown.rows.find((row) => row.key === selectedKey);
  return (
    <div className="fm-dashboard-payments">
      <div className="fm-dashboard-payment-toggle" role="group" aria-label="Vista de formas de pago">
        <button type="button" aria-pressed={view === "percentage"} onClick={() => setView("percentage")}>Porcentaje</button>
        <button type="button" aria-pressed={view === "amount"} onClick={() => setView("amount")}>Monto</button>
      </div>
      {!breakdown.count ? <EmptyState icon="Wallet" title="Sin cobros en este período" description="Las formas de pago se actualizarán cuando haya ventas en las ubicaciones seleccionadas." /> : null}
      <ul className="fm-dashboard-payment-rows">
        {breakdown.rows.map((row) => (
          <li key={row.key}>
            <button type="button" aria-pressed={selectedKey === row.key} onClick={() => setSelectedKey(row.key)}>
              <span>{row.name}</span>
              <strong>{view === "percentage" ? `${row.percentage.toFixed(1)} %` : formatMoney(row.total)}</strong>
              <span className="fm-dashboard-payment-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, row.percentage))}%` }} /></span>
              <small>{view === "percentage" ? formatMoney(row.total) : `${row.percentage.toFixed(1)} % del total vendido`}</small>
            </button>
          </li>
        ))}
      </ul>
      <p className="fm-dashboard-payment-detail" aria-live="polite">
        {selected ? `${selected.name}: ${formatMoney(selected.total)} · ${selected.percentage.toFixed(1)} % del total vendido.` : "Seleccioná una forma de pago para consultar su participación."}
      </p>
      {breakdown.inconsistentSales ? <p role="status">Hay {breakdown.inconsistentSales} ventas cuyo desglose de cobros supera el total. Revisá su forma de pago en Ventas.</p> : null}
    </div>
  );
}
