import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSyCBVuIt36d_0DbDdEkGwRy85hmpZEjbrVg",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "app-integral-fm.firebaseapp.com",
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID || "app-integral-fm",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "app-integral-fm.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "447903189609",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:447903189609:web:ffab0ee93aa45f7fe5b0f8",
};

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
