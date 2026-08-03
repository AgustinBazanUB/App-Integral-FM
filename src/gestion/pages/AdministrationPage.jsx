import { useState } from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Modal,
  PageHeader,
  Panel,
  Select,
  Skeleton,
} from "../../design-system";
import { useAuth } from "../AuthContext";
import { normalizedRole, ROLE_TEMPLATES } from "../permissions";
import {
  createManagedUser,
  listLocations,
  listUsers,
  setManagedUserActive,
} from "../services/managementService";
import { useAsyncData } from "../hooks";

const roleLabels = {
  admin: "Administrador general",
  operational_admin: "Administrador operativo",
  location_manager: "Encargado de ubicación",
  seller: "Vendedor",
  warehouse_manager: "Responsable de depósito",
  marketing_manager: "Responsable de marketing",
  ecommerce_manager: "Responsable de ecommerce",
  shipping_manager: "Responsable de envíos",
  supplier_manager: "Responsable de proveedores",
  financial_manager: "Responsable financiero",
  analyst: "Analista de métricas",
};

const emptyForm = {
  name: "",
  email: "",
  password: "",
  role: "seller",
  allowedLocationIds: [],
};

export default function AdministrationPage() {
  const { profile } = useAuth();
  const result = useAsyncData(async () => {
    const [users, locations] = await Promise.all([listUsers(), listLocations(profile)]);
    return { users, locations };
  }, [profile.id]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saveState, setSaveState] = useState({ busy: false, error: "" });

  const createUser = async (event) => {
    event.preventDefault();
    setSaveState({ busy: true, error: "" });
    try {
      await createManagedUser(form, profile);
      setModalOpen(false);
      setForm(emptyForm);
      await result.refresh();
    } catch (error) {
      setSaveState({ busy: false, error: error.message });
    }
  };

  const toggleActive = async (user) => {
    try {
      await setManagedUserActive(user.id, user.active !== true, profile);
      await result.refresh();
    } catch (error) {
      setSaveState({ busy: false, error: error.message });
    }
  };

  return (
    <div className="fm-page-enter">
      <PageHeader
        eyebrow="Capa transversal"
        title="Usuarios y permisos"
        description="Perfiles, roles configurables y alcance por ubicación. La seguridad se replica en Firestore."
        actions={<Button icon="Plus" onClick={() => setModalOpen(true)}>Nuevo usuario</Button>}
      />
      <Panel title="Usuarios" description="Las bajas son lógicas; Firebase Authentication conserva la cuenta para mantener trazabilidad.">
        {result.status === "loading" ? <Skeleton lines={5} /> : null}
        {result.status === "error" ? <EmptyState icon="ShieldCheck" title="No se pudieron leer los usuarios" description={result.error.message} /> : null}
        {result.status === "ready" ? (
          <DataTable
            rows={result.data.users}
            columns={[
              { key: "name", label: "Persona", render: (user) => <div><strong>{user.name || "Sin nombre"}</strong><small>{user.email}</small></div> },
              { key: "role", label: "Rol", render: (user) => roleLabels[normalizedRole(user)] || normalizedRole(user) },
              { key: "locations", label: "Ubicaciones", render: (user) => user.allowedLocationIds?.length || (normalizedRole(user) === "admin" ? "Todas" : 0) },
              { key: "active", label: "Estado", render: (user) => <Badge tone={user.active ? "success" : "neutral"}>{user.active ? "Activo" : "Inactivo"}</Badge> },
              { key: "actions", label: "Acciones", render: (user) => <Button variant="text" onClick={() => toggleActive(user)} disabled={user.id === profile.id}>{user.active ? "Desactivar" : "Reactivar"}</Button> },
            ]}
            empty={<EmptyState icon="UsersRound" title="No hay usuarios" description="Creá el primer perfil operativo." />}
          />
        ) : null}
        {saveState.error && !modalOpen ? <p className="fm-form-error" role="alert">{saveState.error}</p> : null}
      </Panel>
      <Panel title="Plantillas de rol" description="Cada plantilla se puede complementar con permisos específicos por usuario.">
        <div className="fm-role-grid">
          {Object.entries(roleLabels).map(([role, label]) => (
            <article key={role}><strong>{label}</strong><span>{Object.keys(ROLE_TEMPLATES[role] || {}).length} módulos definidos</span></article>
          ))}
        </div>
      </Panel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nuevo usuario" description="La contraseña temporal se envía directamente a Firebase Authentication y no se almacena en Firestore.">
        <form className="fm-form-grid" onSubmit={createUser}>
          <FormField label="Nombre" required><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FormField>
          <FormField label="Email" required><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></FormField>
          <FormField label="Contraseña temporal" hint="Mínimo 6 caracteres." required><input type="password" minLength="6" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></FormField>
          <FormField label="Rol" required><Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormField>
          <FormField label="Ubicaciones permitidas" hint="Usá Ctrl o Cmd para seleccionar varias." className="fm-form-grid__full"><select multiple value={form.allowedLocationIds} onChange={(event) => setForm({ ...form, allowedLocationIds: [...event.target.selectedOptions].map((option) => option.value) })}>{(result.data?.locations || []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></FormField>
          {saveState.error ? <p className="fm-form-error fm-form-grid__full" role="alert">{saveState.error}</p> : null}
          <div className="fm-dialog-actions fm-form-grid__full"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button type="submit" loading={saveState.busy}>Crear usuario</Button></div>
        </form>
      </Modal>
    </div>
  );
}
