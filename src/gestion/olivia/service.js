import { auth } from "../services/firebase";
import { createOliviaTransport } from "./client.mjs";

export const oliviaClient = createOliviaTransport({
  getToken: async () => {
    if (!auth.currentUser) throw new Error("Iniciá sesión para usar Olivia.");
    return auth.currentUser.getIdToken();
  },
});
