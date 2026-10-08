// Standard short-context text prices verified against the official model pages.
export const TEXT_PRICES = Object.freeze({
  'gpt-6-luna': { inputUsdPerMillion: 0.10, outputUsdPerMillion: 0.50 },
  'gpt-6-sol': { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
  'gpt-6.1-sol': { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
});
const SOURCES = ['https://www.bna.com.ar/Personas', 'https://www.pymenacion.com.ar/'];
export function parseOfficialDollar(html, now = new Date()) {
  const text = String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
  const section = text.slice(text.indexOf('Cotización Billetes'));
  const match = section.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+Compra\s+Venta\s+D[oó]lar U\.S\.A\s+([\d.,]+)\s+([\d.,]+)/i);
  if (!match) return null;
  const [, day, month, year, , sale] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const quotedAt = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(quotedAt.getTime()) || quotedAt.toISOString().slice(0,10) !== date || quotedAt > now || now - quotedAt > 7 * 86400000) return null;
  const rate = Number(sale.includes(',') ? sale.replace(/\./g, '').replace(',', '.') : sale);
  return Number.isFinite(rate) && rate > 0 && rate < 1000000 ? { rate, date } : null;
}
export function createPricingResolver({ fetchImpl = fetch } = {}) {
  let cached = null, checkedAt = 0, pending = null;
  async function quote(now) {
    if (cached && now.getTime() - checkedAt < 6 * 3600000 && now - new Date(`${cached.date}T12:00:00Z`) < 7 * 86400000) return cached;
    if (pending) return pending;
    pending = (async () => {
      for (const source of SOURCES) {
        try {
          const response = await fetchImpl(source, { signal: AbortSignal.timeout(3000) });
          if (!response.ok) continue;
          const html = await response.text();
          if (html.length > 1000000) continue;
          const parsed = parseOfficialDollar(html, now);
          if (parsed) { cached = { ...parsed, source }; checkedAt = now.getTime(); return cached; }
        } catch { /* Never invent a rate after a network failure. */ }
      }
      return null;
    })();
    try { return await pending; } finally { pending = null; }
  }
  return async (configuration, now = new Date()) => {
    const reference = configuration.officialDollarSellRate ? { rate: configuration.officialDollarSellRate, date: null, source: 'Configuración administrativa' } : await quote(now);
    return { ...configuration, pricing: { ...TEXT_PRICES, ...configuration.pricing }, officialDollarSellRate: reference?.rate || null, pricingReference: reference };
  };
}
export const resolveOliviaPricing = createPricingResolver();
