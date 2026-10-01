function safeJson(response) {
  return response.json().catch(() => ({}));
}

export async function fetchEcommerceCatalog({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/.netlify/functions/ecommerce-catalog", {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const data = await safeJson(response);
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo cargar el catálogo comercial.");
    error.code = data?.code || "ecommerce-catalog-error";
    error.status = response.status;
    throw error;
  }
  return data.catalog;
}

export async function createEcommerceOrder(payload, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/.netlify/functions/ecommerce-checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await safeJson(response);
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo crear el pedido.");
    error.code = data?.code || "ecommerce-checkout-error";
    error.status = response.status;
    throw error;
  }
  return data;
}
