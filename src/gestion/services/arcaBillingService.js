import { auth } from "./firebase";

export async function persistArcaInvoiceIntent({ sourceType, sourceId }) {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error("Tu sesión venció. Volvé a iniciar sesión.");
    error.code = "unauthenticated";
    throw error;
  }

  const idToken = await user.getIdToken();
  const response = await fetch("/.netlify/functions/arca-invoice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ sourceType, sourceId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo guardar la solicitud de facturación.");
    error.code = data?.code || "arca-invoice-persistence-error";
    error.status = response.status;
    throw error;
  }
  return data.invoice;
}
