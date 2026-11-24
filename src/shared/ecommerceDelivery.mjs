export const DELIVERY_ZONES = {
  caba: "CABA",
  cordon_1: "Cordón 1",
  cordon_2: "Cordón 2",
  cordon_3: "Cordón 3",
};

export const ARGENTINA_PROVINCES = [
  ["C", "CABA"], ["B", "Buenos Aires"], ["K", "Catamarca"], ["H", "Chaco"], ["U", "Chubut"],
  ["X", "Córdoba"], ["W", "Corrientes"], ["E", "Entre Ríos"], ["P", "Formosa"], ["Y", "Jujuy"],
  ["L", "La Pampa"], ["F", "La Rioja"], ["M", "Mendoza"], ["N", "Misiones"], ["Q", "Neuquén"],
  ["R", "Río Negro"], ["A", "Salta"], ["J", "San Juan"], ["D", "San Luis"], ["Z", "Santa Cruz"],
  ["S", "Santa Fe"], ["G", "Santiago del Estero"], ["V", "Tierra del Fuego"], ["T", "Tucumán"],
];

export function addressKey(value) {
  return String(value || "").normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function provinceKey(value) {
  const name = addressKey(value);
  if (name === "provincia de buenos aires") return "buenos aires";
  if (name.startsWith("tierra del fuego ")) return "tierra del fuego";
  return ["caba", "capital federal", "ciudad autonoma de buenos aires", "ciudad de buenos aires"].includes(name)
    ? "caba"
    : name;
}

export function argentinaProvinceCode(value) {
  return ARGENTINA_PROVINCES.find(([, province]) => provinceKey(province) === provinceKey(value))?.[0] || "";
}

export function argentinePostalCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^(?:[1-9]\d{3}|[A-Z][1-9]\d{3}(?:[A-Z]{3})?)$/.test(code)
    ? code.match(/\d{4}/)[0]
    : "";
}

export function parseAddressSearch(value) {
  const parts = String(value || "").trim().split(",").map((part) => part.trim());
  const match = /^(.*?)\s+([1-9]\d{0,5})$/.exec(parts[0]);
  if (!match?.[1] || parts.length > 3 || String(value).length > 150) return null;
  return { line: parts[0], street: match[1], number: match[2], city: parts[1] || "", province: parts[2] || "" };
}
