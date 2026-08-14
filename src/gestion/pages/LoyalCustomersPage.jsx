import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Skeleton,
  Tabs,
  Toast,
} from "../../design-system";
import {
  customerDisplayName,
  customerZoneLabel,
  matchesCustomerSearch,
  normalizeCustomerPhone,
} from "../customers/customerDomain";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { useAsyncData } from "../hooks";
import { can } from "../permissions";
import {
  listCustomers,
  listCustomerZones,
  saveCustomerFromAdmin,
  saveCustomerZone,
  setCustomerZoneActive,
} from "../services/customerService";

const blankCustomer = { phone: "", zoneId: "", customZone: "", name: "" };
const blankZone = { name: "", order: 0, active: true };

function customerPhone(customer) {
  return customer.phone || customer.phoneNormalized || customer.title || "Sin teléfono";
}

function CustomersList({ customers }) {
  if (!customers.length) {
    return <EmptyState icon="UsersRound" title="No hay clientes para mostrar" description="Los clientes identificados desde una venta aparecerán aquí automáticamente." />;
  }
  return (
    <div className="fm-customers-list">
      {customers.map((customer) => (
        <article key={customer.id} className="fm-customer-card">
          <div className="fm-customer-card__identity">
            <span className="fm-customer-card__icon"><Icon name="UserRound" /></span>
            <div>
              {customer.name ? <strong>{customerDisplayName(customer)}</strong> : null}
              <b>{customerPhone(customer)}</b>
              {customerZoneLabel(customer) ? <span><Icon name="MapPin" />{customerZoneLabel(customer)}</span> : null}
            </div>
          </div>
          <Badge tone={customer.active === false ? "neutral" : "success"}>
            {customer.active === false ? "Inactivo" : "Activo"}
          </Badge>
        </article>
      ))}
    </div>
  );
}

export default function LoyalCustomersPage() {
  const { profile } = useAuth();
  const canCreateCustomers = can(profile, "loyal-customers", "create") || can(profile, "loyal-customers", "edit");
  const canManageZones = can(profile, "loyal-customers", "edit") || can(profile, "loyal-customers", "admin");
  const customersResult = useAsyncData(() => listCustomers(profile, 250), [profile.id]);
  const zonesResult = useAsyncData(() => listCustomerZones(profile), [profile.id]);
  const [tab, setTab] = useState("customers");
  const [search, setSearch] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState(blankCustomer);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState(blankZone);
  const [editingZoneId, setEditingZoneId] = useState("");
  const [zoneBusy, setZoneBusy] = useState(false);
  const [zoneError, setZoneError] = useState("");
  const [message, setMessage] = useState("");

  const customers = customersResult.data || [];
  const zones = zonesResult.data || [];
  const activeZones = zones.filter((zone) => zone.active !== false);
  const filteredCustomers = useMemo(
    () => customers.filter((customer) => matchesCustomerSearch(customer, search)),
    [customers, search],
  );

  const openNewCustomer = () => {
    setCustomerForm(blankCustomer);
    setCustomerError("");
    setCustomerOpen(true);
  };

  const saveCustomer = async () => {
    setCustomerBusy(true);
    setCustomerError("");
    try {
      const selectedZone = activeZones.find((zone) => zone.id === customerForm.zoneId);
      await saveCustomerFromAdmin(profile, {
        phone: customerForm.phone,
        name: customerForm.name,
        zoneId: selectedZone?.id || "",
        zoneName: selectedZone?.name || "",
        customZone: customerForm.zoneId === "__custom" ? customerForm.customZone : "",
      });
      setCustomerOpen(false);
      setCustomerForm(blankCustomer);
      await customersResult.refresh();
      setMessage("Cliente guardado correctamente.");
    } catch (error) {
      setCustomerError(error.message);
    } finally {
      setCustomerBusy(false);
    }
  };

  const openNewZone = () => {
    setEditingZoneId("");
    setZoneForm(blankZone);
    setZoneError("");
    setZoneOpen(true);
  };

  const openEditZone = (zone) => {
    setEditingZoneId(zone.id);
    setZoneForm({ name: zone.name || "", order: Number(zone.order || 0), active: zone.active !== false });
    setZoneError("");
    setZoneOpen(true);
  };

  const saveZone = async () => {
    setZoneBusy(true);
    setZoneError("");
    try {
      await saveCustomerZone(profile, zoneForm, editingZoneId || null);
      setZoneOpen(false);
      await zonesResult.refresh();
      setMessage(editingZoneId ? "Zona actualizada." : "Zona creada.");
    } catch (error) {
      setZoneError(error.message);
    } finally {
      setZoneBusy(false);
    }
  };

  const toggleZone = async (zone) => {
    try {
      await setCustomerZoneActive(profile, zone, zone.active === false);
      await zonesResult.refresh();
      setMessage(zone.active === false ? "Zona activada." : "Zona desactivada. Los registros históricos se conservan.");
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <div className="fm-page fm-customers-page">
      <PageHeader
        eyebrow="CRM operativo"
        title="Clientes Fidelizados"
        description="Una única base de clientes, identificada principalmente por teléfono y alimentada también desde las ventas."
        actions={tab === "customers" && canCreateCustomers
          ? <Button icon="UserPlus" onClick={openNewCustomer}>Nuevo cliente</Button>
          : tab === "zones" && canManageZones
            ? <Button icon="Plus" onClick={openNewZone}>Nueva zona</Button>
            : null}
      />

      <Tabs
        tabs={[
          { id: "customers", label: "Clientes" },
          ...(canManageZones ? [{ id: "zones", label: "Configuración de zonas" }] : []),
        ]}
        active={tab}
        onChange={setTab}
      />

      {message ? <Toast tone={message.toLocaleLowerCase().includes("error") ? "error" : "success"}>{message}</Toast> : null}

      {tab === "customers" ? (
        <Panel
          title="Registro de clientes"
          description="La vista carga un bloque acotado de registros; la venta nunca descarga la colección completa para identificar un teléfono."
          action={<Badge tone="neutral">{filteredCustomers.length} visibles</Badge>}
        >
          <div className="fm-customers-toolbar">
            <SearchInput
              label="Buscar por teléfono, nombre o zona"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
            />
            {search && normalizeCustomerPhone(search) ? <small>Teléfono normalizado: {normalizeCustomerPhone(search)}</small> : null}
          </div>
          {customersResult.status === "loading" ? <Skeleton lines={6} /> : null}
          {customersResult.status === "error" ? <Toast tone="error">{customersResult.error.message}</Toast> : null}
          {customersResult.status === "ready" ? <CustomersList customers={filteredCustomers} /> : null}
        </Panel>
      ) : (
        <Panel
          title="Zonas"
          description="Las zonas inactivas dejan de ofrecerse en ventas nuevas, pero siguen visibles en clientes y ventas históricas."
        >
          {zonesResult.status === "loading" ? <Skeleton lines={5} /> : null}
          {zonesResult.status === "error" ? <Toast tone="error">{zonesResult.error.message}</Toast> : null}
          <div className="fm-zones-list">
            {zones.map((zone) => (
              <article key={zone.id} className="fm-zone-row">
                <div><strong>{zone.name}</strong><small>Orden {Number(zone.order || 0)}</small></div>
                <Badge tone={zone.active === false ? "neutral" : "success"}>{zone.active === false ? "Inactiva" : "Activa"}</Badge>
                {canManageZones ? (
                  <div className="fm-zone-row__actions">
                    <button type="button" onClick={() => openEditZone(zone)}><Icon name="Settings2" />Editar</button>
                    <button type="button" onClick={() => toggleZone(zone)}><Icon name={zone.active === false ? "Play" : "Pause"} />{zone.active === false ? "Activar" : "Desactivar"}</button>
                  </div>
                ) : null}
              </article>
            ))}
            {zonesResult.status === "ready" && !zones.length ? <EmptyState icon="MapPinned" title="Todavía no hay zonas" description="Creá las zonas que el vendedor podrá seleccionar al identificar un cliente." /> : null}
          </div>
        </Panel>
      )}

      <Modal
        open={customerOpen}
        onClose={() => !customerBusy && setCustomerOpen(false)}
        title="Nuevo cliente"
        description="Teléfono y zona son suficientes; el nombre es opcional."
        footer={<div className="fm-dialog-actions"><Button variant="secondary" onClick={() => setCustomerOpen(false)}>Cancelar</Button><Button icon="Save" loading={customerBusy} onClick={saveCustomer}>Guardar</Button></div>}
      >
        <div className="fm-customer-form">
          <FormField label="Teléfono" required hint="Se usa para evitar clientes duplicados aunque cambie el formato escrito.">
            <input type="tel" inputMode="tel" autoComplete="tel" value={customerForm.phone} onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} />
          </FormField>
          <FormField label="Zona" required>
            <select value={customerForm.zoneId} onChange={(event) => setCustomerForm((current) => ({ ...current, zoneId: event.target.value }))}>
              <option value="">Elegir zona</option>
              {activeZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
              <option value="__custom">Otra zona</option>
            </select>
          </FormField>
          {customerForm.zoneId === "__custom" ? <FormField label="Nueva zona" required><input value={customerForm.customZone} onChange={(event) => setCustomerForm((current) => ({ ...current, customZone: event.target.value }))} /></FormField> : null}
          <FormField label="Nombre (opcional)"><input autoComplete="name" value={customerForm.name} onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))} /></FormField>
          {customerError ? <Toast tone="error">{customerError}</Toast> : null}
        </div>
      </Modal>

      <Modal
        open={zoneOpen}
        onClose={() => !zoneBusy && setZoneOpen(false)}
        title={editingZoneId ? "Editar zona" : "Nueva zona"}
        description="La zona quedará disponible para la captura rápida del Panel Vendedor."
        footer={<div className="fm-dialog-actions"><Button variant="secondary" onClick={() => setZoneOpen(false)}>Cancelar</Button><Button icon="Save" loading={zoneBusy} onClick={saveZone}>Guardar</Button></div>}
      >
        <div className="fm-customer-form">
          <FormField label="Nombre de la zona" required><input value={zoneForm.name} onChange={(event) => setZoneForm((current) => ({ ...current, name: event.target.value }))} /></FormField>
          <FormField label="Orden"><input type="number" min="0" step="1" inputMode="numeric" value={zoneForm.order} onChange={(event) => setZoneForm((current) => ({ ...current, order: event.target.value }))} /></FormField>
          <label className="fm-zone-active-toggle"><input type="checkbox" checked={zoneForm.active !== false} onChange={(event) => setZoneForm((current) => ({ ...current, active: event.target.checked }))} /><span>Zona activa</span></label>
          {zoneError ? <Toast tone="error">{zoneError}</Toast> : null}
        </div>
      </Modal>
    </div>
  );
}
