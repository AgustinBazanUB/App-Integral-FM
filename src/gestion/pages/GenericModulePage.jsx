import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Skeleton,
} from "../../design-system";
import { Link } from "../../router";
import { useAuth } from "../AuthContext";
import {
  formatDateTime,
  humanizeStatus,
  statusTone,
} from "../formatters";
import { useAsyncData } from "../hooks";
import { moduleById } from "../modules";
import { can } from "../permissions";
import {
  createModuleRecord,
  listModuleRecords,
} from "../services/managementService";

const fieldLabels = {
  "loyal-customers": "DNI o referencia del cliente",
  finance: "Concepto del movimiento",
  warehouse: "Referencia de transferencia",
  ecommerce: "Código o referencia del pedido",
  social: "Contacto o consulta",
  marketing: "Nombre de la campaña",
  shipping: "Código del envío",
  alerts: "Título de la alerta",
  suppliers: "Nombre del proveedor",
};

const initialStatus = {
  "loyal-customers": "new",
  finance: "pending",
  warehouse: "draft",
  ecommerce: "pending",
  social: "new",
  marketing: "draft",
  shipping: "pending",
  alerts: "new",
  suppliers: "active",
};

function recordTitle(record) {
  return (
    record.name ||
    record.title ||
    record.code ||
    record.saleCode ||
    record.orderCode ||
    record.dni ||
    "Registro sin nombre"
  );
}

export default function GenericModulePage({ moduleId }) {
  const { profile } = useAuth();
  const module = moduleById[moduleId];
  const result = useAsyncData(() => listModuleRecords(moduleId), [moduleId]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", notes: "" });
  const [saveState, setSaveState] = useState({ busy: false, error: "" });
  const rows = useMemo(() => {
    const records = result.data || [];
    const term = search.trim().toLocaleLowerCase("es");
    return term
      ? records.filter((record) =>
          `${recordTitle(record)} ${record.status || ""}`
            .toLocaleLowerCase("es")
            .includes(term),
        )
      : records;
  }, [result.data, search]);

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setSaveState({ busy: false, error: "Completá el campo principal." });
      return;
    }
    setSaveState({ busy: true, error: "" });
    try {
      await createModuleRecord(
        moduleId,
        {
          name: form.name.trim(),
          notes: form.notes.trim(),
          status: initialStatus[moduleId] || "pending",
        },
        profile,
      );
      setForm({ name: "", notes: "" });
      setModalOpen(false);
      await result.refresh();
    } catch (error) {
      setSaveState({ busy: false, error: error.message });
    }
  };

  return (
    <div className="fm-page-enter">
      <PageHeader
        eyebrow={`Módulo ${module.number}`}
        title={module.label}
        description={module.description}
        actions={can(profile, moduleId, "create") && module.primaryAction ? <Button icon="Plus" onClick={() => setModalOpen(true)}>{module.primaryAction}</Button> : null}
      />
      {moduleId === "ecommerce" ? (
        <Panel className="fm-editorial-panel" title="Superficie pública conectada" description="La tienda, el catálogo, el carrito y el checkout aprobado se conservan dentro de este repositorio.">
          <Link className="fm-button fm-button--secondary" to="/productos">Abrir catálogo público</Link>
        </Panel>
      ) : null}
      <Panel
        title="Registros recientes"
        description="Consulta paginada de los registros autorizados en Firestore."
        action={<SearchInput label="Buscar registros" value={search} onChange={(event) => setSearch(event.target.value)} />}
      >
        {result.status === "loading" ? <Skeleton lines={5} /> : null}
        {result.status === "error" ? (
          <EmptyState
            icon="ShieldCheck"
            title="La colección todavía no está habilitada para este perfil"
            description="La colección no existe todavía o este perfil no tiene permiso para consultarla en la base independiente de App Integral FM."
            action={<Button variant="secondary" onClick={result.refresh}>Reintentar</Button>}
          />
        ) : null}
        {result.status === "ready" ? (
          <DataTable
            rows={rows}
            columns={[
              { key: "name", label: "Registro", render: recordTitle },
              { key: "status", label: "Estado", render: (record) => <Badge tone={statusTone(record.status)}>{humanizeStatus(record.status)}</Badge> },
              { key: "updatedAt", label: "Actualización", render: (record) => formatDateTime(record.updatedAt || record.createdAt) },
              { key: "responsible", label: "Responsable", render: (record) => record.responsibleName || record.assignedToName || record.createdByName || "Pendiente" },
            ]}
            empty={<EmptyState icon={module.icon} title="Todavía no hay registros" description="Cuando se cargue información real en este módulo aparecerá aquí; no se generaron datos ficticios." />}
          />
        ) : null}
      </Panel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={module.primaryAction || "Nuevo registro"} description="Carga inicial editable; las integraciones externas permanecen pendientes hasta recibir credenciales reales.">
        <form className="fm-form-grid" onSubmit={handleCreate}>
          <FormField label={fieldLabels[moduleId] || "Nombre"} required className="fm-form-grid__full"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FormField>
          <FormField label="Notas" className="fm-form-grid__full"><textarea rows="4" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></FormField>
          {saveState.error ? <p className="fm-form-error fm-form-grid__full" role="alert">{saveState.error}</p> : null}
          <div className="fm-dialog-actions fm-form-grid__full"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button type="submit" loading={saveState.busy}>Guardar</Button></div>
        </form>
      </Modal>
    </div>
  );
}

