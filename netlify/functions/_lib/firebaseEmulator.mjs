import { configuredFirebaseProjectId } from "./firebaseProject.mjs";
export function localFirebaseEmulator(kind, env = process.env) {
  if (env.FM_LOCAL_EMULATORS !== "true") return null;
  if (
    env.CONTEXT !== "dev" ||
    configuredFirebaseProjectId(env) !== "app-integral-fm-pruebas" ||
    env.VITE_PREVIEW_FIREBASE_PROJECT_ID !== "app-integral-fm-pruebas"
  )
    throw new Error(
      "Los emuladores sólo se permiten localmente con el proyecto de pruebas.",
    );
  const host =
    env[
      kind === "auth"
        ? "FIREBASE_AUTH_EMULATOR_HOST"
        : "FIRESTORE_EMULATOR_HOST"
    ];
  if (!/^(localhost|127\.0\.0\.1):\d{4,5}$/.test(host || ""))
    throw new Error("El emulador debe escuchar exclusivamente en loopback.");
  return `http://${host}`;
}
