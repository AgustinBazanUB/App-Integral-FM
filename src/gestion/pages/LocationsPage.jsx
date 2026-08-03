import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  FormField,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Skeleton,
  StatCard,
} from "../../design-system";
import {
  isLocationActiveNow,
  locationActivity,
} from "../../modules/locations/domain/locations";
import { useAuth } from "../AuthContext";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { can } from "../permissions";
import {
  listLocations,
  listLocationStock,
  saveLocation,
} from "../services/managementService";

const emptyLocation = {
  name: "",
  type: "store",
  codePrefix: "",
  dniMode: "optional",
  active: true,
};

const typeLabels = {
  store: "Local",
  fair: "Feria",
  event: "Evento",
  warehouse_store: "Depósito con venta",
  temporary: "Punto temporal",
  other: "Otro",
};

export default function LocationsPage() {
  const { profile } = useAuth();
  const locationsResult = useAsyncData(() => listLocations(profile), [profile.id]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [stock, setStock] = useState({ status: "idle", data: [], error: null });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyLocation);
  const [saveState, setSaveState] = useState({ busy: false, error: "" });

  const locations = locationsResult.data || [];
  useEffect(() => {
    if (!selectedId && locations.length) setSelectedId(locations[0].id);
  }, [locations, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setStock({ status: "idle", data: [], error: null });
      return;
    }
    let active = true;
    setStock({ status: "loading", data: [], error: null });
    listLocationStock(selectedId)
      .then((data) => active && setStock({ status: "ready", data, error: null }))
      .catch((error) => active && setStock({ status: "error", data: [], error }));
    return () => {
      active = false;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return term
      ? locations.filter((location) =>
          `${location.name} ${location.type || ""}`.toLocaleLowerCase("es").includes(term),
        )
      : locations;
  }, [locations, search]);
  const selected = locations.find((location) => location.id === selectedId);
  const stockValue = stock.data.reduce(
    (sum, item) => sum + Number(item.currentStock || 0) * Number(item.price || 0),
    0,
  );
  const lowStock = stock.data.filter(
    (item) => Number(item.currentStock || 0) <= Number(item.yellowAlertQty || -1),
  ).length;

  const openCreate = () => {
    setForm(emptyLocation);
    setSaveState({ busy: false, error: "" });
    setModalOpen(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.codePrefix.trim()) {
      setSaveState({ busy: false, error: "Completá el nombre y el prefijo." });
      return;
    }
    setSaveState({ busy: true, error: "" });
    try {
      const id = await saveLocation(form, profile);
      await locationsResult.refresh();
      setSelectedId(id);
      setModalOpen(false);
    } catch (error) {
      setSaveState({ busy: false, error: error.message });
    }
  };

  return (
    <div className="fm-page-enter">
      <PageHeader
        eyebrow="Módulo 01"
        title="Ubicaciones"
        description="La operación comprobada de locales, ferias, stock y ventas, migrada al sistema visual integral."
        actions={can(profile, "locations", "create") ? <Button icon="Plus" onClick={openCreate}>Nueva ubicación</Button> : null}
      />

      {locationsResult.status === "loading" ? <Skeleton lines={4} /> : null}
      {locationsResult.status === "error" ? (
        <Panel><EmptyState icon="WifiOff" title="No se pudieron leer las ubicaciones" description="Revisá la conexión o los permisos de Firestore." action={<Button variant="secondary" onClick={locationsResult.refresh}>Reintentar</Button>} /></Panel>
      ) : null}
      {locationsResult.status === "ready" ? (
        <>
          <section className="fm-stat-grid">
            <StatCard label="Ubicaciones visibles" value={locations.length} hint="Según tu perfil" icon="MapPinned" />
            <StatCard label="Activas ahora" value={locations.filter(isLocationActiveNow).length} hint="Horario y pausas aplicados" icon="Check" tone="olive" />
            <StatCard label="Unidades en la selección" value={stock.data.reduce((sum, item) => sum + Number(item.currentStock || 0), 0)} hint={selected?.name || "Elegí una ubicación"} icon="Box" tone="wood" />
            <StatCard label="Alertas de stock" value={lowStock} hint="Umbral amarillo o rojo" icon="BellRing" tone={lowStock ? "error" : "olive"} />
          </section>

          <Panel title="Puntos de operación" description="Las bajas lógicas no aparecen en esta lista.">
            <FilterBar
              search={<SearchInput label="Buscar ubicación" value={search} onChange={(event) => setSearch(event.target.value)} />}
            >
              <Select aria-label="Ubicación seleccionada" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                <option value="">Elegir ubicación</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </Select>
            </FilterBar>
            <DataTable
              rows={filtered}
              columns={[
                { key: "name", label: "Ubicación", render: (location) => <button type="button" className="fm-table-link" onClick={() => setSelectedId(location.id)}>{location.name}</button> },
                { key: "type", label: "Tipo", render: (location) => typeLabels[location.type] || location.type || "Pendiente" },
                { key: "codePrefix", label: "Prefijo" },
                { key: "dniMode", label: "DNI", render: (location) => location.dniMode || "Pendiente" },
                { key: "status", label: "Estado", render: (location) => {
                  const activity = locationActivity(location);
                  return <Badge tone={activity.active ? "success" : "warning"}>{activity.label}</Badge>;
                } },
              ]}
              empty={<EmptyState icon="MapPinned" title="No hay ubicaciones para mostrar" description="Creá la primera o revisá tus permisos y filtros." />}
            />
          </Panel>

          <Panel title={selected ? `Stock · ${selected.name}` : "Stock por ubicación"} description="Los precios y alertas provienen del stock real de Firestore.">
            {stock.status === "loading" ? <Skeleton lines={5} /> : null}
            {stock.status === "error" ? <EmptyState icon="AlertTriangle" title="No se pudo cargar el stock" description={stock.error.message} /> : null}
            {stock.status === "ready" ? (
              <>
                <div className="fm-inline-summary"><Badge tone="neutral">Valor visible {formatMoney(stockValue)}</Badge><Badge tone={lowStock ? "warning" : "success"}>{lowStock} alertas</Badge></div>
                <DataTable
                  rows={stock.data}
                  columns={[
                    { key: "productName", label: "Producto" },
                    { key: "currentStock", label: "Stock" },
                    { key: "price", label: "Precio", render: (item) => formatMoney(item.price) },
                    { key: "alert", label: "Estado", render: (item) => {
                      const current = Number(item.currentStock || 0);
                      const red = Number(item.redAlertQty || -1);
                      const yellow = Number(item.yellowAlertQty || -1);
                      const tone = current <= red ? "error" : current <= yellow ? "warning" : "success";
                      const label = current <= red ? "Crítico" : current <= yellow ? "Reponer" : "Disponible";
                      return <Badge tone={tone} icon={tone === "error" ? "AlertTriangle" : "Check"}>{label}</Badge>;
                    } },
                  ]}
                  empty={<EmptyState icon="Box" title="Sin stock configurado" description="Esta ubicación todavía no tiene productos activos." />}
                />
              </>
            ) : null}
          </Panel>
        </>
      ) : null}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nueva ubicación" description="Configuración mínima compatible con el sistema de stock existente.">
        <form className="fm-form-grid" onSubmit={handleSave}>
          <FormField label="Nombre" required><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FormField>
          <FormField label="Tipo" required><Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormField>
          <FormField label="Prefijo de venta" hint="Hasta 8 letras o números." required><input maxLength="8" value={form.codePrefix} onChange={(event) => setForm({ ...form, codePrefix: event.target.value })} /></FormField>
          <FormField label="Solicitud de DNI" required><Select value={form.dniMode} onChange={(event) => setForm({ ...form, dniMode: event.target.value })}><option value="disabled">Desactivado</option><option value="optional">Opcional</option><option value="recommended">Recomendado</option><option value="required">Obligatorio</option></Select></FormField>
          {saveState.error ? <p className="fm-form-error fm-form-grid__full" role="alert">{saveState.error}</p> : null}
          <div className="fm-dialog-actions fm-form-grid__full"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button type="submit" loading={saveState.busy}>Guardar ubicación</Button></div>
        </form>
      </Modal>
    </div>
  );
}
