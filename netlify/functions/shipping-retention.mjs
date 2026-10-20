import { clearExpiredShippingPositions } from "./_lib/shippingRetention.mjs";
// Netlify scheduled functions cannot be invoked by public URL in production.
// Only expired last points are cleared; sales, history and stock are untouched.
export default async function handler() {
  await clearExpiredShippingPositions();
  return new Response(null, { status: 204 });
}
export const config = { schedule: "@hourly" };
