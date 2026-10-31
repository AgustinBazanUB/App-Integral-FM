import { saleChannelId, metricsChannelOptions } from "./channels.js";
import { LOCATION_TYPES } from "./locations.js";

export const METRICS_SECTIONS = [
  { id: "all", name: "Ventas generales" },
  { id: "locations", name: "Ubicaciones" },
  { id: "ecommerce", name: "Página web" },
  { id: "channels", name: "Canales" },
];

export function changeMetricsSection(state, section) {
  return { ...state, section, locationType: "all", locationIds: [], channelIds: [] };
}

export function metricsLocationChoices(locations, type = "all") {
  return type === "all" ? locations : locations.filter(location => (location.type || "store") === type);
}

export function metricsLocationTypes(locations) {
  const labels = { ...LOCATION_TYPES, warehouse_store: "Depósito (tipo heredado)", temporary: "Punto temporal", other: "Otro" };
  return [...new Set([...Object.keys(LOCATION_TYPES), ...locations.map(location => location.type || "store")])].map(id => ({ id, name: labels[id] || id }));
}

const PHYSICAL_CHANNELS = new Set(["in_person", "manual", "__unknown"]);

export function metricsSaleSection(sale) {
  const channel = saleChannelId(sale);
  return channel === "ecommerce" ? "ecommerce" : PHYSICAL_CHANNELS.has(channel) ? "locations" : "channels";
}

export function metricsContactChannels(sales) {
  return metricsChannelOptions(sales).filter(channel => channel.id !== "ecommerce" && !PHYSICAL_CHANNELS.has(channel.id));
}

// Each commercial sale contributes to one source and once to the general total.
// The physical stock origin does not turn web/contact sales into in-person sales.
export function applyMetricsSection(sales, state, locations) {
  if (state.section === "ecommerce") return sales.filter(sale => metricsSaleSection(sale) === "ecommerce");
  if (state.section === "channels") return sales.filter(sale => metricsSaleSection(sale) === "channels" && (!state.channelIds.length || state.channelIds.includes(saleChannelId(sale))));
  if (state.section === "locations") {
    const physical = sales.filter(sale => metricsSaleSection(sale) === "locations");
    if (state.locationType === "all" && !state.locationIds.length) return physical;
    const ids = new Set(metricsLocationChoices(locations, state.locationType).filter(location => !state.locationIds.length || state.locationIds.includes(location.id)).map(location => location.id));
    return physical.filter(sale => sale.stockOriginType !== "warehouse" && ids.has(sale.locationId || (sale.stockOriginType === "location" ? sale.stockOriginId : "")));
  }
  return sales;
}
