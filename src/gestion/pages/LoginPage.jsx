import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, FormField } from "../../design-system";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";

export default function LoginPage({ sessionError }) {
  const { login, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (sessionError) await logout();
      await login(email, password);
    } catch (caughtError) {
      const message =
        caughtError.code === "auth/invalid-credential"
          ? "El email o la contraseña no son correctos."
          : "No pudimos iniciar sesión. Revisá la conexión e intentá nuevamente.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="fm-login" id="main-content">
      <section className="fm-login__brand" aria-label="Flor Mía">
        <div className="fm-login__brand-overlay">
          <p className="fm-overline fm-overline--inverse">Gestión integral</p>
          <h1>El corazón operativo de Flor Mía.</h1>
          <p>
            Ventas, stock, clientes y cada tarea del negocio en un mismo lugar.
          </p>
          <div className="fm-login__brand-note">
            <Icon name="ShieldCheck" />
            <span>Acceso protegido por Firebase Authentication y permisos por módulo.</span>
          </div>
        </div>
      </section>
      <section className="fm-login__form-area">
        <div className="fm-login__card">
          <img
            src="/images/flor-mia/logo-flor-mia.svg"
            alt="Flor Mía"
            width="154"
            height="94"
          />
          <div>
            <p className="fm-overline">Superficie privada</p>
            <h2>Bienvenido</h2>
            <p>Ingresá con el usuario asignado por el administrador.</p>
          </div>
          <form onSubmit={handleSubmit} noValidate>
            <FormField label="Email" required>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <div className="fm-field">
              <label htmlFor="login-password">
                Contraseña <span aria-hidden="true">*</span>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-describedby="login-session-note"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  style={{ width: "100%", paddingRight: "48px" }}
                />
                <button
                  type="button"
                  className="fm-icon-button fm-icon-button--secondary"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  onClick={() => setShowPassword((current) => !current)}
                  style={{
                    position: "absolute",
                    top: "50%",
                    right: "7px",
                    width: "34px",
                    height: "34px",
                    minHeight: "34px",
                    transform: "translateY(-50%)",
                  }}
                >
                  {showPassword ? (
                    <EyeOff width="17" height="17" aria-hidden="true" />
                  ) : (
                    <Eye width="17" height="17" aria-hidden="true" />
                  )}
                </button>
              </div>
              <p className="fm-field__hint" id="login-session-note">
                La sesión quedará iniciada en este dispositivo hasta que cierres sesión.
              </p>
            </div>
            {error || sessionError ? (
              <p className="fm-form-error" role="alert">
                <Icon name="AlertTriangle" />
                {error || sessionError.message}
              </p>
            ) : null}
            <Button type="submit" loading={busy} className="fm-login__submit">
              Ingresar a gestión
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
