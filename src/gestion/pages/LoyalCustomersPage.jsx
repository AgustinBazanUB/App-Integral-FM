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
import CustomerImportModal from "../customers/CustomerImportModal";
import {
  customerDisplayName,
  customerWhatsAppUrl,
  customerZoneLabel,
  formatPhoneForDisplay,
  matchesCustomerSearch,
  normalizeCustomerPhone,
} from "../customers/customerDomain";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { formatDateTime } from "../formatters";
import { useAsyncData } from "../hooks";
import { can } from "../permissions";
import {
  listCustomers,
  listCustomerZones,
  saveCustomerFromAdmin,
  saveCustomerZone,
  setCustomerZoneActive,
  updateCustomerFromAdmin,
} from "../services/customerService";

const blankCustomer = { phone: "", zoneId: "", customZone: "", name: "" };
const blankZone = { name: "", order: 0, active: true };

function displayedPhone(customer) {
  return formatPhoneForDisplay(customer.phoneNormalized || customer.phone || customer.title) || "Sin teléfono";
}

function customerToForm(customer = {}, zones = []) {
  const configured = zones.some((zone) => zone.id && zone.id === customer.zoneId);
  const usesCustom = Boolean(customer.customZone) || (!configured && !customer.zoneId && customer.zoneName);
  return {
    phone: customer.phoneNormalized || customer.phone || "",
    name: customer.name || "",
    zoneId: usesCustom ? "__custom" : (customer.zoneId || ""),
    customZone: usesCustom ? (customer.customZone || customer.zoneName || "") : "",
  };
}

function CustomersList({ customers, onOpen }) {
  if (!customers.length) {
    return <EmptyState icon="UsersRound" title="No hay clientes para mostrar" description="Los clientes identificados desde una venta aparecerán aquí automáticamente." />;
  }
  return (
    <div className="fm-customers-list">
      {customers.map((customer) => {
        const phone = displayedPhone(customer);
        const whatsappUrl = customerWhatsAppUrl(customer.phoneNormalized || customer.phone);
        return (
          <article key={customer.id} className="fm-customer-card">
            <button type="button" className="fm-customer-card__open" onClick={() => onOpen(customer)} aria-label={`Abrir detalle de ${customerDisplayName(customer)}`} />
            <div className="fm-customer-card__identity">
              <span className="fm-customer-card__icon"><Icon name="UserRound" /></span>
              <div>
                {customer.name ? <strong>{customerDisplayName(customer)}</strong> : null}
                {whatsappUrl ? (
                  <a
                    className="fm-customer-phone-link"
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Abrir WhatsApp con ${phone}`}
                    onClick={(event) => event.stopPropagation()}
                  ><Icon name="MessagesSquare" /><b>{phone}</b></a>
                ) : <b>{phone}</b>}
                {customerZoneLabel(customer) ? <span><Icon name="MapPin" />{customerZoneLabel(customer)}</span> : null}
              </div>
            </div>
            <Badge tone={customer.active === false ? "neutral" : "success"}>
              {customer.active === false ? "Inactivo" : "Activo"}
            </Badge>
          </article>
        );
      })}
    </div>
  );
}

export default function LoyalCustomersPage() {
  const { profile } = useAuth();
  const canEditCustomers = can(profile, "loyal-customers", "edit");
  const canCreateCustomers = can(profile, "loyal-customers", "create") || canEditCustomers;
  const canManageZones = canEditCustomers || can(profile, "loyal-customers", "admin");
  const customersResult = useAsyncData(() => listCustomers(profile, 250), [profile.id]);
  const zonesResult = useAsyncData(() => listCustomerZones(profile), [profile.id]);
  const [tab, setTab] = useState("customers");
  const [search, setSearch] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState(blankCustomer);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [detailForm, setDetailForm] = useState(blankCustomer);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
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

  const handleImportedCustomers = async ({ created, skipped, invalid }) => {
    await customersResult.refresh();
    setMessage(`Importación finalizada: ${created} creado(s), ${skipped} omitido(s) y ${invalid} inválido(s).`);
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

  const openCustomer = (customer) => {
    setSelectedCustomer(customer);
    setDetailForm(customerToForm(customer, zones));
    setEditingCustomer(false);
    setDetailError("");
  };

  const closeCustomer = () => {
    if (detailBusy) return;
    setSelectedCustomer(null);
    setEditingCustomer(false);
    setDetailError("");
  };

  const startCustomerEdit = () => {
    setDetailForm(customerToForm(selectedCustomer, zones));
    setDetailError("");
    setEditingCustomer(true);
  };

  const saveCustomerEdit = async () => {
    if (!selectedCustomer) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const selectedZone = zones.find((zone) => zone.id === detailForm.zoneId);
      const result = await updateCustomerFromAdmin(profile, selectedCustomer, {
        phone: detailForm.phone,
        name: detailForm.name,
        zoneId: selectedZone?.id || "",
        zoneName: selectedZone?.name || "",
        customZone: detailForm.zoneId === "__custom" ? detailForm.customZone : "",
      });
      const refreshed = await customersResult.refresh();
      const updated = (refreshed || []).find((customer) => customer.id === result.id);
      setSelectedCustomer(updated || { ...selectedCustomer, id: result.id, phone: detailForm.phone, phoneNormalized: normalizeCustomerPhone(detailForm.phone), name: detailForm.name, zoneId: selectedZone?.id || "", zoneName: selectedZone?.name || detailForm.customZone, customZone: detailForm.zoneId === "__custom" ? detailForm.customZone : "" });
      setEditingCustomer(false);
      setMessage("Cliente actualizado.");
    } catch (error) {
      setDetailError(error.message);
    } finally {
      setDetailBusy(false);
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

  const detailPhone = selectedCustomer ? displayedPhone(selectedCustomer) : "";
  const detailWhatsapp = selectedCustomer ? customerWhatsAppUrl(selectedCustomer.phoneNormalized || selectedCustomer.phone) : "";
  const historicalZone = selectedCustomer?.zoneId ? zones.find((zone) => zone.id === selectedCustomer.zoneId && zone.active === false) : null;

  return (
    <div className="fm-page fm-customers-page">
      <PageHeader
        eyebrow="CRM operativo"
        title="Clientes"
        description="Una única base de clientes, identificada principalmente por teléfono y alimentada también desde las ventas."
        actions={tab === "customers" && canCreateCustomers
          ? (
            <div className="fm-customer-page-actions">
              <Button icon="UserPlus" onClick={openNewCustomer}>Nuevo cliente</Button>
              <div className="fm-customer-import-help">
                <Button
                  variant="secondary"
                  icon="FileText"
                  onClick={() => setImportOpen(true)}
                  aria-describedby="customer-import-help"
                >
                  Agregar Clientes
                </Button>
                <div id="customer-import-help" className="fm-customer-import-tooltip" role="tooltip">
                  Importá un Excel generado por Flor Mía WhatsApp Sender. En la extensión: Contactos → elegí la etiqueta → Analizar → Exportar Excel. El archivo debe tener Telefono, Nombre y Apellido y Zona.
                </div>
              </div>
            </div>
          )
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
            {search && normalizeCustomerPhone(search) ? <small>Teléfono normalizado: {formatPhoneForDisplay(normalizeCustomerPhone(search))}</small> : null}
          </div>
          {customersResult.status === "loading" ? <Skeleton lines={6} /> : null}
          {customersResult.status === "error" ? <Toast tone="error">{customersResult.error.message}</Toast> : null}
          {customersResult.status === "ready" ? <CustomersList customers={filteredCustomers} onOpen={openCustomer} /> : null}
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

      <CustomerImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        profile={profile}
        zones={zones}
        onImported={handleImportedCustomers}
      />

      <Modal
        open={Boolean(selectedCustomer)}
        onClose={closeCustomer}
        title={editingCustomer ? "Editar cliente" : "Detalle del cliente"}
        description={editingCustomer ? "Los cambios se guardan únicamente al confirmar." : "Datos principales del cliente."}
        footer={selectedCustomer ? <div className="fm-dialog-actions">
          {editingCustomer ? <><Button variant="secondary" disabled={detailBusy} onClick={() => { setEditingCustomer(false); setDetailError(""); }}>Cancelar</Button><Button icon="Save" loading={detailBusy} onClick={saveCustomerEdit}>Guardar cambios</Button></> : <><Button variant="secondary" onClick={closeCustomer}>Cerrar</Button>{canEditCustomers ? <Button icon="Settings2" onClick={startCustomerEdit}>Editar</Button> : null}</>}
        </div> : null}
      >
        {selectedCustomer ? editingCustomer ? (
          <div className="fm-customer-form fm-customer-detail-form">
            <FormField label="Nombre (opcional)"><input autoComplete="name" value={detailForm.name} onChange={(event) => setDetailForm((current) => ({ ...current, name: event.target.value }))} /></FormField>
            <FormField label="Teléfono" required hint="Se valida contra la base antes de guardar para evitar duplicados."><input type="tel" inputMode="tel" autoComplete="tel" value={detailForm.phone} onChange={(event) => setDetailForm((current) => ({ ...current, phone: event.target.value }))} /></FormField>
            <FormField label="Zona" required><select value={detailForm.zoneId} onChange={(event) => setDetailForm((current) => ({ ...current, zoneId: event.target.value }))}><option value="">Elegir zona</option>{activeZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}{historicalZone ? <option value={historicalZone.id}>{historicalZone.name} (inactiva · actual)</option> : null}<option value="__custom">Otra zona</option></select></FormField>
            {detailForm.zoneId === "__custom" ? <FormField label="Otra zona" required><input value={detailForm.customZone} onChange={(event) => setDetailForm((current) => ({ ...current, customZone: event.target.value }))} /></FormField> : null}
            {detailError ? <Toast tone="error">{detailError}</Toast> : null}
          </div>
        ) : (
          <div className="fm-customer-detail">
            <div className="fm-customer-detail__hero"><span className="fm-customer-card__icon"><Icon name="UserRound" /></span><div><small>Cliente</small><strong>{customerDisplayName(selectedCustomer)}</strong></div></div>
            <dl>
              <div><dt>Teléfono</dt><dd>{detailWhatsapp ? <a href={detailWhatsapp} target="_blank" rel="noopener noreferrer" aria-label={`Abrir WhatsApp con ${detailPhone}`}><Icon name="MessagesSquare" />{detailPhone}</a> : detailPhone}</dd></div>
              <div><dt>Zona</dt><dd>{customerZoneLabel(selectedCustomer) || "Sin zona"}</dd></div>
              {selectedCustomer.createdAt ? <div><dt>Alta</dt><dd>{formatDateTime(selectedCustomer.createdAt)}</dd></div> : null}
              {selectedCustomer.lastPurchaseAt ? <div><dt>Última compra</dt><dd>{formatDateTime(selectedCustomer.lastPurchaseAt)}</dd></div> : null}
              {selectedCustomer.updatedAt ? <div><dt>Última actualización</dt><dd>{formatDateTime(selectedCustomer.updatedAt)}</dd></div> : null}
            </dl>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={customerOpen}
        onClose={() => !customerBusy && setCustomerOpen(false)}
        title="Nuevo cliente"
        description="Teléfono y zona son suficientes; el nombre es opcional."
        footer={<div className="fm-dialog-actions"><Button variant="secondary" onClick={() => setCustomerOpen(false)}>Cancelar</Button><Button icon="Save" loading={customerBusy} onClick={saveCustomer}>Guardar</Button></div>}
      >
        <div className="fm-customer-form">
          <FormField label="Teléfono" required hint="Se usa para evitar clientes duplicados aunque cambie el formato escrito."><input type="tel" inputMode="tel" autoComplete="tel" value={customerForm.phone} onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} /></FormField>
          <FormField label="Zona" required><select value={customerForm.zoneId} onChange={(event) => setCustomerForm((current) => ({ ...current, zoneId: event.target.value }))}><option value="">Elegir zona</option>{activeZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}<option value="__custom">Otra zona</option></select></FormField>
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
