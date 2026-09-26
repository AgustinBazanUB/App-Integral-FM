import { auth } from "./firebase";

async function authenticatedPost(payload) {
  const user = auth.currentUser;
  if (!user) throw new Error("Iniciá sesión para usar la integración ARCA.");
  const token = await user.getIdToken();
  const response = await fetch("/.netlify/functions/arca-taxpayer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo completar la operación ARCA.");
    error.code = data?.code || "arca-request-error";
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function runArcaDiagnostics() {
  const data = await authenticatedPost({ mode: "diagnostics" });
  return data.diagnostics;
}

export async function lookupArcaTaxpayer(cuit) {
  const data = await authenticatedPost({ cuit: String(cuit || "").trim() });
  return data;
}
