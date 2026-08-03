import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { login, logout } from "./services/firebase";
import { observeSession } from "./services/managementService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState({
    status: "loading",
    user: null,
    profile: null,
    error: null,
  });

  useEffect(
    () =>
      observeSession(({ user, profile, error }) => {
        if (!user) {
          setSession({ status: "signed-out", user: null, profile: null, error });
          return;
        }
        if (error) {
          setSession({ status: "error", user, profile: null, error });
          return;
        }
        if (!profile) {
          setSession({
            status: "error",
            user,
            profile: null,
            error: new Error("Tu usuario no tiene un perfil configurado."),
          });
          return;
        }
        if (profile.active !== true) {
          setSession({
            status: "error",
            user,
            profile,
            error: new Error("Tu usuario está inactivo."),
          });
          return;
        }
        setSession({ status: "ready", user, profile, error: null });
      }),
    [],
  );

  const value = useMemo(
    () => ({ ...session, login, logout }),
    [session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth requiere AuthProvider");
  return context;
}
