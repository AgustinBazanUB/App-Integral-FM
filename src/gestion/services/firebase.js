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
    "AIzaSyD-GEqaTJZKXyKa7fUBbXa0Cigit7qZyio",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "fm-stock-y-venta.firebaseapp.com",
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID || "fm-stock-y-venta",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "fm-stock-y-venta.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "334694189931",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:334694189931:web:6f75a7f73e2eacd3675a2e",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

setPersistence(auth, browserLocalPersistence).catch(() => {
  // Firebase conserva su persistencia por defecto si el navegador la bloquea.
});

export const login = (email, password) =>
  signInWithEmailAndPassword(auth, email.trim(), password);

export const logout = () => signOut(auth);
