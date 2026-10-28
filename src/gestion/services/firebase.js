import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Keep the preview client config separate from the server-only VITE_FIREBASE_*
// values that may be marked secret in Netlify. Firebase web config is public;
// the service account remains exclusively in Functions environment variables.
const stagingProject = import.meta.env.VITE_PREVIEW_FIREBASE_PROJECT_ID === "app-integral-fm-pruebas";
const productionConfig = {
  apiKey: "AIzaSyCBVuIt36d_0DbDdEkGwRy85hmpZEjbrVg",
  authDomain: "app-integral-fm.firebaseapp.com",
  projectId: "app-integral-fm",
  storageBucket: "app-integral-fm.firebasestorage.app",
  messagingSenderId: "447903189609",
  appId: "1:447903189609:web:ffab0ee93aa45f7fe5b0f8",
};

export const firebaseConfig = stagingProject
  ? {
      apiKey: import.meta.env.VITE_PREVIEW_FIREBASE_API_KEY || "",
      authDomain: import.meta.env.VITE_PREVIEW_FIREBASE_AUTH_DOMAIN || "",
      projectId: import.meta.env.VITE_PREVIEW_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_PREVIEW_FIREBASE_STORAGE_BUCKET || "",
      messagingSenderId: import.meta.env.VITE_PREVIEW_FIREBASE_MESSAGING_SENDER_ID || "",
      appId: import.meta.env.VITE_PREVIEW_FIREBASE_APP_ID || "",
    }
  : productionConfig;

if (stagingProject) {
  const requiredConfig = Object.values(firebaseConfig).every((value) => String(value || "").trim());
  const containsProductionCredentials =
    firebaseConfig.apiKey === productionConfig.apiKey ||
    firebaseConfig.authDomain === productionConfig.authDomain ||
    firebaseConfig.storageBucket === productionConfig.storageBucket ||
    firebaseConfig.messagingSenderId === productionConfig.messagingSenderId ||
    firebaseConfig.appId === productionConfig.appId;
  if (!requiredConfig || containsProductionCredentials) {
    throw new Error("La configuración Firebase de pruebas está incompleta o mezcla valores productivos.");
  }
}

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {
  // Firebase conserva su persistencia disponible si el navegador bloquea el almacenamiento local.
});

export const login = async (email, password) => {
  await persistenceReady;
  return signInWithEmailAndPassword(auth, email.trim(), password);
};

export const logout = () => signOut(auth);
