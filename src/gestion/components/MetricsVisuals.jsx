import { formatMoney } from "../formatters";

const paymentColors = ["#B88A2D", "#65704A", "#76510F", "#9B7B63", "#6A655F"];

export function SalesLineChart({ points = [], label = "Evolución de ventas" }) {
  const width = 720;
  const height = 230;
  const paddingX = 28;
  const paddingY = 24;
  const max = Math.max(1, ...points.map((point) => Number(point.total || 0)));
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const coordinates = points.map((point, index) => ({
    ...point,
    x: paddingX + (points.length <= 1 ? usableWidth / 2 : (index / (points.length - 1)) * usableWidth),
    y: paddingY + usableHeight - (Number(point.total || 0) / max) * usableHeight,
  }));
  const path = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const labelStep = Math.max(1, Math.ceil(points.length / 9));

  return (
    <div className="fm-metrics-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}. Máximo ${formatMoney(max)}.`}>
        <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} className="fm-metrics-line-chart__axis" />
        <line x1={paddingX} y1={paddingY} x2={paddingX} y2={height - paddingY} className="fm-metrics-line-chart__axis" />
        {path ? <path d={path} className="fm-metrics-line-chart__line" /> : null}
        {coordinates.map((point, index) => (
          <g key={point.key || index}>
            <circle cx={point.x} cy={point.y} r="4" className="fm-metrics-line-chart__point"><title>{`${point.label}: ${formatMoney(point.total)} · ${point.sales} ventas`}</title></circle>
            {(index % labelStep === 0 || index === coordinates.length - 1) ? <text x={point.x} y={height - 5} textAnchor="middle">{point.label}</text> : null}
          </g>
        ))}
      </svg>
      <div className="sr-only">
        {points.map((point) => <span key={point.key}>{point.label}: {formatMoney(point.total)}, {point.sales} ventas. </span>)}
      </div>
    </div>
  );
}

export function PaymentDonut({ rows = [], total = 0 }) {
  const positive = rows.filter((row) => Number(row.total || 0) > 0);
  let cursor = 0;
  const segments = positive.map((row, index) => {
    const start = total ? cursor / total * 360 : 0;
    cursor += Number(row.total || 0);
    const end = total ? cursor / total * 360 : 0;
    return `${paymentColors[index % paymentColors.length]} ${start}deg ${end}deg`;
  });
  return (
    <div className="fm-payment-breakdown">
      <div
        className="fm-payment-donut"
        role="img"
        aria-label={`Distribución de cobros por monto. Total ${formatMoney(total)}.`}
        style={{ background: segments.length ? `conic-gradient(${segments.join(",")})` : "#eee8df" }}
      >
        <span><small>Total</small><strong>{formatMoney(total)}</strong></span>
      </div>
      <ul className="fm-payment-legend">
        {positive.map((row, index) => {
          const percentage = total ? row.total / total * 100 : 0;
          return (
            <li key={row.key}>
              <span className="fm-payment-legend__dot" style={{ background: paymentColors[index % paymentColors.length] }} />
              <span><strong>{row.name}</strong><small>{percentage.toFixed(1)} %</small></span>
              <b>{formatMoney(row.total)}</b>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
