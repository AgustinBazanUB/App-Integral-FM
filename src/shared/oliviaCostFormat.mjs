const priced = (value) => Number.isFinite(value) && value >= 0;

export function formatOliviaCost(value, currency = "ARS") {
  if (!priced(value)) return "Sin medición";
  if (currency === "USD") return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumSignificantDigits: 3 }).format(value);
  if (value > 0 && value < 0.1) return "< $0,1";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}
