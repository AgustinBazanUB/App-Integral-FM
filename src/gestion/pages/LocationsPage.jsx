import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  ConfirmationDialog,
  EmptyState,
  FilterBar,
  FormField,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Skeleton,
  Toast,
} from "../../design-system";
import {
  locationActivity,
  locationSchedule,
  toLocalDateTimeInput,
} from "../../modules/locations/domain/locations";
import { Link } from "../../router";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { formatDate } from "../formatters";
import { useAsyncData } from "../hooks";
import { can, normalizedRole } from "../permissions";
import {
  listLocationStockCounts,
  saveManagedLocation,
  setLocationLifecycle,
} from "../services/locationManagementService";
import { listLocations } from "../services/managementService";

const emptyLocation = {
  name: "",
  type: "store",
  codePrefix: "",
  dniMode: "optional",
  active: true,
  scheduleStartAt: "",
  scheduleEndAt: "",
};

export const locationTypeLabels = {
  store: "Local",
  fair: "Feria",
  event: "Evento",
  warehouse_store: "Depósito",
  temporary: "Punto temporal",
  other: "Otro",
};

function statusKey(location) {
  const state = locationActivity(location);
  if (state.reason === "future") return "upcoming";
  if (state.reason === "ended") return "finished";
  if (state.reason === "paused") return "paused";
  if (state.reason === "deleted") return "deleted";
  if (state.active) return "active";
  return "inactive";
}

function statusTone(location) {
  const key = statusKey(location);
  if (key === "active") return "success";
  if (["upcoming", "paused"].includes(key)) return "warning";
  if (key === "deleted") return "error";
  return "neutral";
}

function LocationCard({ location, stockCount, profile, onEdit, onLifecycle }) {
  const state = locationActivity(location);
  const schedule = locationSchedule(location);
  const canEdit = can(profile, "locations", "edit") && location.deleted !== true;
  const canArchive = can(profile, "locations", "archive") && location.deleted !== true;
  const canRestore = can(profile, "locations", "restore") && location.deleted === true;
  return (
    <article className="fm-location-card">
      <header>
        <div className="fm-location-card__icon"><Icon name={location.type === "warehouse_store" ? "Warehouse" : "MapPin"} /></div>
        <div><h3>{location.name}</h3><p>{locationTypeLabels[location.type] || "Ubicación"}</p></div>
        <Badge tone={statusTone(location)}>{state.label}</Badge>
      </header>
      <dl>
        <div><dt>Fechas</dt><dd>{schedule.startAt || schedule.endAt ? `${schedule.startAt ? formatDate(schedule.startAt) : "Sin inicio"} — ${schedule.endAt ? formatDate(schedule.endAt) : "Sin fin"}` : "Operación permanente"}</dd></div>
        <div><dt>Vendedores</dt><dd>{location.assignedSellerIds?.length || 0} asignados</dd></div>
        <div><dt>Stock</dt><dd>{stockCount > 0 ? `${stockCount} productos configurados` : "Todavía sin configurar"}</dd></div>
      </dl>
      <footer>
        {location.deleted !== true ? <Link className="fm-button fm-button--primary" to={`/gestion/locations/${encodeURIComponent(location.id)}`}><span>Abrir ubicación</span><Icon name="ChevronRight" /></Link> : null}
        {canEdit ? <Button variant="secondary" icon="Settings2" onClick={() => onEdit(location)}>Editar</Button> : null}
        {canEdit && state.active ? <Button variant="ghost" icon="Pause" onClick={() => onLifecycle(location, "pause")}>Pausar</Button> : null}
        {canEdit && !state.active ? <Button variant="ghost" icon="Play" onClick={() => onLifecycle(location, "activate")}>Activar</Button> : null}
        {canArchive ? <Button variant="ghost" icon="Trash2" onClick={() => onLifecycle(location, "delete")}>Dar de baja</Button> : null}
        {canRestore ? <Button variant="secondary" icon="RotateCcw" onClick={() => onLifecycle(location, "restore")}>Restaurar</Button> : null}
      </footer>
    </article>
  );
}

export default function LocationsPage() {
  const { profile } = useAuth();
  const canRecover = ["admin", "general_admin"].includes(normalizedRole(profile));
  const locationsResult = useAsyncData(() => listLocations(profile, { includeDeleted: canRecover }), [profile.id, canRecover]);
  const locations = locationsResult.data || [];
  const locationIdsKey = locations.map((location) => location.id).join(",");
  const countsResult = useAsyncData(() => locations.length ? listLocationStockCounts(locations.filter((location) => location.deleted !== true)) : {}, [profile.id, locationIdsKey]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyLocation);
  const [saveState, setSaveState] = useState({ busy: false, error: "", success: "" });
  const [pendingAction, setPendingAction] = useState(null);

  useEffect(() => {
    if (statusFilter === "deleted" && !canRecover) setStatusFilter("all");
  }, [canRecover, statusFilter]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return locations.filter((location) => {
      if (term && !`${location.name} ${locationTypeLabels[location.type] || ""}`.toLocaleLowerCase("es").includes(term)) return false;
      if (statusFilter !== "all" && statusKey(location) !== statusFilter) return false;
      if (typeFilter !== "all" && location.type !== typeFilter) return false;
      return true;
    });
  }, [locations, search, statusFilter, typeFilter]);

  const openCreate = (type = "store") => {
    setEditingId("");
    setForm({ ...emptyLocation, type });
    setSaveState({ busy: false, error: "", success: "" });
    setModalOpen(true);
  };
  const openEdit = (location) => {
    setEditingId(location.id);
    setForm({
      name: location.name || "",
      type: location.type || "store",
      codePrefix: location.codePrefix || "",
      dniMode: location.dniMode || "optional",
      active: location.active !== false,
      scheduleStartAt: toLocalDateTimeInput(location.scheduleStartAt || location.startDateTime || location.startDate),
      scheduleEndAt: toLocalDateTimeInput(location.scheduleEndAt || location.endDateTime || location.endDate, "end"),
    });
    setSaveState({ busy: false, error: "", success: "" });
    setModalOpen(true);
  };
  const handleSave = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.codePrefix.trim()) {
      setSaveState({ busy: false, error: "Completá el nombre y el prefijo de venta.", success: "" });
      return;
    }
    if (form.scheduleStartAt && form.scheduleEndAt && form.scheduleStartAt >= form.scheduleEndAt) {
      setSaveState({ busy: false, error: "La fecha final debe ser posterior a la inicial.", success: "" });
      return;
    }
    setSaveState({ busy: true, error: "", success: "" });
    try {
      await saveManagedLocation(form, profile, editingId || null);
      await locationsResult.refresh();
      setModalOpen(false);
    } catch (error) {
      setSaveState({ busy: false, error: error.message, success: "" });
    }
  };
  const confirmLifecycle = async () => {
    if (!pendingAction) return;
    setPendingAction((current) => ({ ...current, busy: true }));
    try {
      await setLocationLifecycle(pendingAction.location, pendingAction.action, profile);
      setPendingAction(null);
      await locationsResult.refresh();
    } catch (error) {
      setPendingAction((current) => ({ ...current, busy: false, error: error.message }));
    }
  };
  const requestLifecycle = (location, action) => setPendingAction({ location, action, busy: false, error: "" });

  return (
    <div className="fm-page-enter">
      <PageHeader
        eyebrow="Módulo 01"
        title="Ubicaciones y eventos"
        description="Abrí el punto operativo que necesitás para gestionar sus productos, stock, vendedores y descuentos."
        actions={can(profile, "locations", "create") ? <><Button variant="secondary" icon="CalendarDays" onClick={() => openCreate("event")}>Crear evento</Button><Button icon="Plus" onClick={() => openCreate("store")}>Crear ubicación</Button></> : null}
      />
      {saveState.success ? <Toast tone="success">{saveState.success}</Toast> : null}
      {locationsResult.status === "loading" ? <Skeleton lines={5} /> : null}
      {locationsResult.status === "error" ? <Panel><EmptyState icon="WifiOff" title="No se pudieron leer las ubicaciones" description="Revisá la conexión o los permisos de Firestore." action={<Button variant="secondary" onClick={locationsResult.refresh}>Reintentar</Button>} /></Panel> : null}
      {locationsResult.status === "ready" ? <Panel title="Puntos de operación" description={`${filtered.length} de ${locations.length} ubicaciones visibles`}>
        <FilterBar search={<SearchInput label="Buscar por nombre" value={search} onChange={(event) => setSearch(event.target.value)} />}>
          <Select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos los estados</option><option value="active">Activas</option><option value="upcoming">Próximas</option><option value="paused">Pausadas</option><option value="finished">Finalizadas</option><option value="inactive">Inactivas</option>{canRecover ? <option value="deleted">Bajas para recuperar</option> : null}</Select>
          <Select aria-label="Filtrar por tipo" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos los tipos</option>{Object.entries(locationTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
        </FilterBar>
        {countsResult.status === "loading" ? <p className="fm-refresh-note"><Icon name="RefreshCw" className="fm-spinner" /> Verificando stock…</p> : null}
        {filtered.length ? <div className="fm-location-grid">{filtered.map((location) => <LocationCard key={location.id} location={location} stockCount={countsResult.data?.[location.id] || 0} profile={profile} onEdit={openEdit} onLifecycle={requestLifecycle} />)}</div> : <EmptyState icon="MapPin" title="No hay ubicaciones para mostrar" description="Revisá los filtros o creá un nuevo punto de operación." action={can(profile, "locations", "create") ? <Button onClick={() => openCreate()}>Crear ubicación</Button> : null} />}
      </Panel> : null}

      <Modal open={modalOpen} onClose={() => !saveState.busy && setModalOpen(false)} title={editingId ? "Editar ubicación" : form.type === "event" ? "Nuevo evento" : "Nueva ubicación"} description="Los datos se guardan sin alterar ventas ni movimientos históricos.">
        <form className="fm-form-grid" onSubmit={handleSave}>
          <FormField label="Nombre" required><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FormField>
          <FormField label="Tipo" required><Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{Object.entries(locationTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormField>
          <FormField label="Prefijo de venta" hint="Hasta 8 letras o números." required><input maxLength="8" value={form.codePrefix} onChange={(event) => setForm({ ...form, codePrefix: event.target.value.replace(/[^a-zA-Z0-9]/g, "") })} /></FormField>
          <FormField label="Solicitud de DNI" required><Select value={form.dniMode} onChange={(event) => setForm({ ...form, dniMode: event.target.value })}><option value="disabled">Desactivado</option><option value="optional">Opcional</option><option value="recommended">Recomendado</option><option value="required">Obligatorio</option></Select></FormField>
          <FormField label="Inicio" hint="Opcional para locales permanentes."><input type="datetime-local" value={form.scheduleStartAt} onChange={(event) => setForm({ ...form, scheduleStartAt: event.target.value })} /></FormField>
          <FormField label="Finalización" hint="Opcional para locales permanentes."><input type="datetime-local" value={form.scheduleEndAt} onChange={(event) => setForm({ ...form, scheduleEndAt: event.target.value })} /></FormField>
          {saveState.error ? <p className="fm-form-error fm-form-grid__full" role="alert">{saveState.error}</p> : null}
          <div className="fm-dialog-actions fm-form-grid__full"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button type="submit" loading={saveState.busy}>Guardar</Button></div>
        </form>
      </Modal>

      <ConfirmationDialog
        open={Boolean(pendingAction)}
        onClose={() => !pendingAction?.busy && setPendingAction(null)}
        onConfirm={confirmLifecycle}
        busy={pendingAction?.busy}
        title={pendingAction?.action === "delete" ? "Dar de baja la ubicación" : pendingAction?.action === "restore" ? "Restaurar ubicación" : pendingAction?.action === "pause" ? "Pausar ubicación" : "Activar ubicación"}
        description={pendingAction ? `${pendingAction.location.name}. ${pendingAction.action === "delete" ? "La baja es lógica: los datos históricos se conservan." : "El cambio quedará registrado en la actividad."}${pendingAction.error ? ` Error: ${pendingAction.error}` : ""}` : ""}
      />
    </div>
  );
}
