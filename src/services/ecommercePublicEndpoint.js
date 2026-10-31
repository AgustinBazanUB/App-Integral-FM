// Netlify reserves /.netlify for its own runtime. The standalone storefront
// uses public proxy routes; the unified app calls its Functions directly.
export function ecommercePublicEndpoint(name) {
  return import.meta.env.VITE_APP_SURFACE === "ecommerce"
    ? `/api/ecommerce/${name}`
    : `/.netlify/functions/ecommerce-${name}`;
}
