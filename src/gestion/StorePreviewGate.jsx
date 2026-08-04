import { useEffect } from "react";
import { Skeleton } from "../design-system";
import { useNavigate } from "../router";
import { AuthProvider, useAuth } from "./AuthContext";
import { normalizedRole } from "./permissions";
import LoginPage from "./pages/LoginPage";

function StorePreviewAccess({ children }) {
  const navigate = useNavigate();
  const { status, profile, error } = useAuth();
  const isAdministrator =
    status === "ready" && normalizedRole(profile) === "admin";

  useEffect(() => {
    if (status === "ready" && !isAdministrator) {
      navigate("/gestion", { replace: true });
    }
  }, [isAdministrator, navigate, status]);

  if (status === "loading") {
    return (
      <main className="fm-auth-loading" id="main-content">
        <img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" />
        <Skeleton lines={3} />
      </main>
    );
  }

  if (status === "signed-out" || status === "error") {
    return <LoginPage sessionError={status === "error" ? error : null} />;
  }

  if (!isAdministrator) {
    return (
      <main className="fm-auth-loading" id="main-content">
        <span>Redirigiendo al panel autorizado…</span>
      </main>
    );
  }

  return children;
}

export default function StorePreviewGate({ children }) {
  return (
    <AuthProvider>
      <StorePreviewAccess>{children}</StorePreviewAccess>
    </AuthProvider>
  );
}
