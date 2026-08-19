
import { useEffect, useMemo, useRef, useState } from "react";
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
  Toast,
} from "../../design-system";
import { Link } from "../../router";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { formatDateTime } from "../formatters";
import { can } from "../permissions";
import {
  ACTIVE_CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONES,
  MAX_CAMPAIGN_IMAGES,
  analyzeRecipientCandidates,
  campaignRecipientDisplayPhone,
  campaignValidation,
  customerMatchesCampaignFilters,
  extensionPrimaryStatus,
  recipientFromCustomer,
} from "../marketing/whatsapp/campaignDomain";
import { mapExcelRows, readCampaignExcel } from "../marketing/whatsapp/excelImport";
import {
  campaignSummaryForExtension,
  cancelLocalCampaign,
  getWhatsAppCampaign,
  listAllCampaignCustomers,
  listCampaignCustomerFilterOptions,
  listCampaignCustomerPage,
  listCampaignEvents,
  listCampaignRecipients,
  listWhatsAppCampaignsPage,
  prepareCampaignSnapshot,
  recordCampaignDeliveredToExtension,
  replaceCampaignRecipients,
  saveWhatsAppCampaignDraft,
} from "../marketing/whatsapp/campaignService";
import {
  EXTENSION_MESSAGE_TYPES,
  pingWhatsAppExtension,
  prepareCampaignForExtension,
  requestCampaignPause,
  requestCampaignResume,
  requestCampaignStart,
  requestCampaignStop,
  requestWhatsAppPreflight,
  subscribeExtensionMessages,
} from "../marketing/whatsapp/extensionBridge";

const steps = ["Información", "Destinatarios", "Mensaje", "Imágenes", "Revisión"];
const emptyFilters = { zoneId: "", zoneName: "", category: "", search: "" };

function imageMetadata(images) {
  return images.map((item, index) => ({ name: item.file.name, type: item.file.type, size: item.file.size, order: index + 1 }));
}

function ExtensionStatus({ status, refreshing, onRefresh, onReconnect }) {
  const primary = extensionPrimaryStatus(status);
  const reconnect = status.connectionState && status.connectionState !== "connected";
  return (
    <section className={`fm-wa-extension is-${primary.operational ? "operational" : "error"}`} aria-live="polite">
      <div className="fm-wa-extension__state">
        <span className="fm-wa-extension__icon"><Icon name={primary.operational ? "Check" : "AlertTriangle"} /></span>
        <div><small>Conexión con WhatsApp</small><strong>{primary.label}</strong><p>{primary.message}</p></div>
      </div>
      <Button variant="secondary" icon="RefreshCw" loading={refreshing} onClick={reconnect ? (onReconnect || onRefresh) : onRefresh}>{reconnect ? "Reconectar" : "Revisar conexión"}</Button>
      <div className="fm-wa-extension__limits">
        <span><b>{Number(status.configuredLimit || 0).toLocaleString("es-AR")}</b><small>Límite configurado</small></span>
        <span><b>{Number(status.sentToday || 0).toLocaleString("es-AR")}</b><small>Enviados hoy</small></span>
        <span><b>{Number(status.availableToday || 0).toLocaleString("es-AR")}</b><small>Disponibles</small></span>
      </div>
    </section>
  );
}

function RecipientRows({ recipients, excluded, onToggleExclude }) {
  if (!recipients.length) return <EmptyState icon="UsersRound" title="Sin destinatarios" description="Seleccioná clientes o importá un Excel para continuar." />;
  return (
    <div className="fm-wa-recipient-list">
      {recipients.map((recipient) => {
        const key = recipient.phoneNormalized;
        const isExcluded = excluded.has(key);
        return (
          <article key={key} className={`fm-wa-recipient ${isExcluded ? "is-excluded" : ""}`}>
            <label>
              <input type="checkbox" checked={!isExcluded} onChange={() => onToggleExclude(key)} />
              <span><strong>{recipient.name || "Sin nombre"}</strong><small>{campaignRecipientDisplayPhone(recipient)} · {recipient.zone || "Sin zona"}{recipient.category ? ` · ${recipient.category}` : ""}</small></span>
            </label>
            <Badge tone={recipient.source === "flor_mia" ? "success" : "neutral"}>{recipient.source === "flor_mia" ? "Flor Mía" : "Excel"}</Badge>
          </article>
        );
      })}
    </div>
  );
}

function CampaignWizard({ profile, extensionStatus, refreshExtension, initialCampaign, onClose, onSaved }) {
  const [step, setStep] = useState(0);
  const [campaignId, setCampaignId] = useState(initialCampaign?.id || "");
  const [name, setName] = useState(initialCampaign?.name || "");
  const [message, setMessage] = useState(initialCampaign?.message || "");
  const [filters, setFilters] = useState({ ...emptyFilters, ...(initialCampaign?.filters || {}) });
  const [customers, setCustomers] = useState([]);
  const [customerCursor, setCustomerCursor] = useState(null);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(true);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ zones: [], categories: [] });
  const [selectedFlor, setSelectedFlor] = useState(new Map());
  const [excelSheet, setExcelSheet] = useState(null);
  const [excelMapping, setExcelMapping] = useState({ phone: "", name: "", zone: "", category: "", notes: "" });
  const [excelCandidates, setExcelCandidates] = useState([]);
  const [excluded, setExcluded] = useState(new Set());
  const [images, setImages] = useState([]);
  const [persistedImageMetadata] = useState(initialCampaign?.imageMetadata || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const imageRef = useRef([]);

  const canImport = can(profile, "marketing", "whatsappImportExcel");
  const canSend = can(profile, "marketing", "whatsappSendToExtension");

  useEffect(() => {
    imageRef.current = images;
  }, [images]);

  useEffect(() => () => {
    for (const item of imageRef.current) URL.revokeObjectURL(item.url);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listCampaignCustomerPage(profile, { pageSize: 100 }),
      listCampaignCustomerFilterOptions(profile),
      initialCampaign?.id ? listCampaignRecipients(profile, initialCampaign.id) : Promise.resolve([]),
    ]).then(([page, options, existingRecipients]) => {
      if (cancelled) return;
      setCustomers(page.items);
      setCustomerCursor(page.cursor);
      setHasMoreCustomers(page.hasMore);
      setFilterOptions(options);
      if (existingRecipients.length) {
        const flor = new Map();
        const excel = [];
        for (const recipient of existingRecipients) {
          if (recipient.source === "flor_mia") flor.set(recipient.phoneNormalized, recipient);
          else excel.push(recipient);
        }
        setSelectedFlor(flor);
        setExcelCandidates(excel);
      }
    }).catch((cause) => setError(cause.message));
    return () => { cancelled = true; };
  }, [profile.id, initialCampaign?.id]);

  const filteredCustomers = useMemo(
    () => customers.filter((customer) => customerMatchesCampaignFilters(customer, filters)),
    [customers, filters],
  );
  const analysis = useMemo(
    () => analyzeRecipientCandidates([...selectedFlor.values(), ...excelCandidates]),
    [selectedFlor, excelCandidates],
  );
  const recipients = useMemo(
    () => analysis.recipients.filter((recipient) => !excluded.has(recipient.phoneNormalized)),
    [analysis.recipients, excluded],
  );
  const validation = campaignValidation({ name, recipients, message, images, extensionStatus, persistedImageMetadata });

  const toggleFlorCustomer = (customer) => {
    const recipient = recipientFromCustomer(customer);
    const normalized = recipient.phone && analyzeRecipientCandidates([recipient]).recipients[0];
    if (!normalized) return;
    setSelectedFlor((current) => {
      const next = new Map(current);
      if (next.has(normalized.phoneNormalized)) next.delete(normalized.phoneNormalized);
      else next.set(normalized.phoneNormalized, recipient);
      return next;
    });
    setExcluded((current) => {
      const next = new Set(current);
      next.delete(normalized.phoneNormalized);
      return next;
    });
  };

  const loadMoreCustomers = async () => {
    if (!hasMoreCustomers || customerBusy) return;
    setCustomerBusy(true);
    try {
      const page = await listCampaignCustomerPage(profile, { pageSize: 100, cursor: customerCursor });
      setCustomers((current) => [...current, ...page.items]);
      setCustomerCursor(page.cursor);
      setHasMoreCustomers(page.hasMore);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setCustomerBusy(false);
    }
  };

  const selectAllResults = async () => {
    setCustomerBusy(true);
    setError("");
    try {
      const zone = filterOptions.zones.find((item) => item.id === filters.zoneId);
      const all = await listAllCampaignCustomers(profile, { ...filters, zoneName: zone?.name || filters.zoneName });
      setSelectedFlor((current) => {
        const next = new Map(current);
        for (const customer of all) {
          const recipient = recipientFromCustomer(customer);
          const normalized = analyzeRecipientCandidates([recipient]).recipients[0];
          if (normalized) next.set(normalized.phoneNormalized, recipient);
        }
        return next;
      });
      setNotice(`${all.length} clientes habilitados incorporados a la selección.`);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setCustomerBusy(false);
    }
  };

  const importExcel = async (file) => {
    setError("");
    try {
      const sheet = await readCampaignExcel(file);
      setExcelSheet(sheet);
      setExcelMapping(sheet.mapping);
    } catch (cause) {
      setExcelSheet(null);
      setError(cause.message);
    }
  };

  const confirmExcel = () => {
    try {
      const mapped = mapExcelRows(excelSheet, excelMapping);
      setExcelCandidates(mapped);
      setNotice(`${mapped.length} registros de Excel incorporados para validar.`);
    } catch (cause) {
      setError(cause.message);
    }
  };

  const addImages = (files) => {
    const incoming = [...files].filter((file) => file.type.startsWith("image/"));
    if (images.length + incoming.length > MAX_CAMPAIGN_IMAGES) {
      setError("La campaña admite como máximo 3 imágenes.");
      return;
    }
    setImages((current) => [...current, ...incoming.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
  };

  const removeImage = (id) => {
    setImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((item) => item.id !== id);
    });
  };

  const moveImage = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    setImages((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveDraft = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await saveWhatsAppCampaignDraft(profile, {
        name,
        filters,
        message,
        imageMetadata: imageMetadata(images).length ? imageMetadata(images) : persistedImageMetadata,
        totalRecipients: recipients.length,
      }, campaignId || null);
      await replaceCampaignRecipients(profile, id, recipients);
      setCampaignId(id);
      setNotice("Borrador guardado.");
      onSaved?.();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    if (!validation.valid || !canSend) return;
    setBusy(true);
    setError("");
    try {
      const id = await prepareCampaignSnapshot(profile, {
        campaignId: campaignId || null,
        name,
        filters,
        message,
        imageMetadata: imageMetadata(images),
        recipients,
      });
      setCampaignId(id);
      const payload = campaignSummaryForExtension(id, name, profile, recipients, message);
      const accepted = await prepareCampaignForExtension(payload, images);
      await recordCampaignDeliveredToExtension(profile, id);
      await requestCampaignStart(id, { sequence: accepted.sequence });
      for (const image of images) URL.revokeObjectURL(image.url);
      setImages([]);
      setNotice("La campaña quedó iniciada.");
      onSaved?.();
      onClose();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fm-wa-wizard fm-page-enter">
      <PageHeader
        eyebrow="Marketing · WhatsApp"
        title={initialCampaign ? "Continuar campaña" : "Nueva campaña de WhatsApp"}
        description="Prepará destinatarios, contenido y multimedia; después vas a poder seguir el progreso y controlar la campaña desde esta pantalla."
        actions={<Button variant="secondary" icon="ArrowLeft" onClick={onClose}>Volver</Button>}
      />
      <nav className="fm-wa-steps" aria-label="Etapas de campaña">{steps.map((label, index) => <button key={label} type="button" className={step === index ? "is-active" : ""} onClick={() => setStep(index)} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span>{label}</button>)}</nav>
      {error ? <Toast tone="error">{error}</Toast> : null}
      {notice ? <Toast tone="success">{notice}</Toast> : null}

      {step === 0 ? <Panel title="Información" description="Nombre administrativo de la campaña."><div className="fm-wa-form"><FormField label="Nombre interno" required><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Promoción aceite Microcentro — Agosto 2026" /></FormField><div className="fm-wa-readonly"><span>Estado</span><Badge tone="neutral">Borrador</Badge></div></div></Panel> : null}

      {step === 1 ? <div className="fm-wa-stack">
        <Panel title="Clientes de Flor Mía" description="Sólo se ofrecen clientes activos y no bloqueados explícitamente para comunicaciones.">
          <div className="fm-wa-filter-grid">
            <SearchInput label="Buscar por nombre o teléfono" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
            <label><span>Zona</span><select value={filters.zoneId} onChange={(event) => setFilters((current) => ({ ...current, zoneId: event.target.value }))}><option value="">Todas las zonas</option>{filterOptions.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
            <label><span>Categoría</span><select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="">Todas las categorías</option>{filterOptions.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          </div>
          <div className="fm-wa-list-actions"><Button variant="secondary" loading={customerBusy} onClick={selectAllResults}>Seleccionar todos los resultados</Button><span>{filteredCustomers.length} visibles en este bloque</span></div>
          <div className="fm-wa-customer-list">{filteredCustomers.map((customer) => { const candidate = analyzeRecipientCandidates([recipientFromCustomer(customer)]).recipients[0]; const selected = candidate && selectedFlor.has(candidate.phoneNormalized); return <label key={customer.id} className="fm-wa-customer-row"><input type="checkbox" checked={Boolean(selected)} onChange={() => toggleFlorCustomer(customer)} /><span><strong>{customer.name || "Sin nombre"}</strong><small>{candidate ? campaignRecipientDisplayPhone(candidate) : "Celular inválido"} · {customer.zoneName || customer.customZone || "Sin zona"}{(customer.category || customer.segment) ? ` · ${customer.category || customer.segment}` : ""}</small></span></label>; })}</div>
          {hasMoreCustomers ? <div className="fm-load-more"><Button variant="secondary" loading={customerBusy} onClick={loadMoreCustomers}>Cargar más clientes</Button></div> : null}
        </Panel>

        {canImport ? <Panel title="Importar desde Excel" description="El archivo se procesa localmente y no se sube a Firebase.">
          <div className="fm-wa-excel"><label className="fm-wa-file"><span>Seleccionar .xlsx</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => importExcel(event.target.files?.[0])} /></label>{excelSheet ? <><p><strong>{excelSheet.fileName}</strong> · {excelSheet.rows.length} filas detectadas</p><div className="fm-wa-mapping">{[["phone","Teléfono *"],["name","Nombre"],["zone","Zona"],["category","Categoría"],["notes","Observaciones"]].map(([field,label]) => <label key={field}><span>{label}</span><select value={excelMapping[field]} onChange={(event) => setExcelMapping((current) => ({ ...current, [field]: event.target.value }))}><option value="">Sin mapear</option>{excelSheet.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><div className="fm-wa-excel-preview" aria-label="Vista previa del Excel"><table><thead><tr>{excelSheet.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{excelSheet.rows.slice(0, 5).map((row, rowIndex) => <tr key={rowIndex}>{excelSheet.headers.map((header, columnIndex) => <td key={`${rowIndex}-${header}`}>{row[columnIndex] == null ? "" : String(row[columnIndex])}</td>)}</tr>)}</tbody></table><small>Vista previa de hasta 5 filas. El archivo permanece solamente en tu navegador.</small></div><Button variant="secondary" onClick={confirmExcel}>Confirmar importación</Button></> : null}</div>
        </Panel> : null}

        <Panel title={`Destinatarios seleccionados: ${recipients.length}`} description="Distintos formatos del mismo celular se unifican antes de preparar la campaña; Flor Mía tiene prioridad sobre Excel.">
          <div className="fm-wa-validation" aria-live="polite"><span><b>{analysis.totalFound}</b>Total encontrado</span><span><b>{analysis.valid}</b>Válidos únicos</span><span><b>{analysis.invalid}</b>Inválidos</span><span><b>{analysis.duplicates}</b>Duplicados</span><span><b>{analysis.missingPhone}</b>Sin teléfono</span></div>
          <RecipientRows recipients={analysis.recipients} excluded={excluded} onToggleExclude={(phone) => setExcluded((current) => { const next = new Set(current); next.has(phone) ? next.delete(phone) : next.add(phone); return next; })} />
        </Panel>
      </div> : null}

      {step === 2 ? <Panel title="Mensaje de WhatsApp" description="El mismo texto se enviará a todos. La arquitectura queda preparada para placeholders futuros como {{nombre}}."><div className="fm-wa-message-grid"><FormField label="Mensaje de WhatsApp"><textarea rows="12" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escribí el mensaje…" /></FormField><div className="fm-wa-preview"><span>Vista previa</span><div>{message || "El mensaje aparecerá aquí."}</div><small>Representación aproximada de lo que se enviará.</small></div></div></Panel> : null}

      {step === 3 ? <Panel title="Imágenes" description="Podés agregar 0–3 imágenes. Los archivos viven sólo en memoria hasta transferirse a la extensión.">
        {persistedImageMetadata.length && !images.length ? <Toast tone="info">Este borrador tenía {persistedImageMetadata.length} imagen(es). Volvé a seleccionarlas antes de preparar la campaña; sólo se conservaron nombre y orden.</Toast> : null}
        <label className="fm-wa-file"><span>Agregar imágenes</span><input type="file" accept="image/*" multiple onChange={(event) => { addImages(event.target.files || []); event.target.value = ""; }} /></label>
        <div className="fm-wa-images">{images.map((item, index) => <article key={item.id}><img src={item.url} alt={`Imagen ${index + 1}: ${item.file.name}`} /><div><strong>Imagen {index + 1}</strong><span>{item.file.name}</span><small>{Math.round(item.file.size / 1024)} KB</small></div><div className="fm-wa-image-actions"><button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0} aria-label={`Mover ${item.file.name} arriba`}><Icon name="ChevronLeft" /></button><button type="button" onClick={() => moveImage(index, 1)} disabled={index === images.length - 1} aria-label={`Mover ${item.file.name} abajo`}><Icon name="ChevronRight" /></button><button type="button" onClick={() => removeImage(item.id)} aria-label={`Eliminar ${item.file.name}`}><Icon name="X" /></button></div></article>)}</div>
        <p className="fm-wa-order"><strong>Orden:</strong> {images.length ? `${images.map((_, index) => `Imagen ${index + 1}`).join(" → ")} → ${message.trim() ? "Texto" : "sin texto"}` : message.trim() ? "Texto" : "Sin contenido todavía"}</p>
      </Panel> : null}

      {step === 4 ? <div className="fm-wa-stack">
        <ExtensionStatus status={extensionStatus} refreshing={false} onRefresh={refreshExtension} />
        <Panel title="Revisión final" description="Confirmá el contenido antes de preparar la campaña."><dl className="fm-wa-review"><div><dt>Campaña</dt><dd>{name || "Sin nombre"}</dd></div><div><dt>Destinatarios</dt><dd>{recipients.length} contactos seleccionados</dd></div><div><dt>Segmentación</dt><dd>{[filters.zoneId && (filterOptions.zones.find((zone) => zone.id === filters.zoneId)?.name), filters.category].filter(Boolean).join(" + ") || "Selección manual / sin filtro"}</dd></div><div><dt>Multimedia</dt><dd>{images.length} imagen(es) · {images.map((item) => item.file.name).join(" → ") || "Sin imágenes"}</dd></div><div><dt>Mensaje</dt><dd className="fm-wa-review-message">{message || "Sin texto"}</dd></div><div><dt>Conexión</dt><dd>{extensionPrimaryStatus(extensionStatus).label}</dd></div></dl>
          {extensionStatus.availableToday > 0 && recipients.length > extensionStatus.availableToday ? <Toast tone="info">La selección supera los disponibles informados hoy. No se iniciarán contactos por encima del límite configurado.</Toast> : null}
          {!validation.valid ? <div className="fm-wa-errors" role="alert"><strong>Antes de preparar:</strong><ul>{validation.errors.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          <Button icon="Megaphone" loading={busy} disabled={!validation.valid || !canSend} onClick={prepare}>Preparar e iniciar campaña</Button>
        </Panel>
      </div> : null}

      <div className="fm-wa-wizard-actions"><Button variant="secondary" disabled={step === 0 || busy} onClick={() => setStep((current) => Math.max(0, current - 1))}>Anterior</Button><Button variant="secondary" loading={busy} onClick={saveDraft}>Guardar borrador</Button>{step < steps.length - 1 ? <Button disabled={step === 0 && !name.trim()} onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>Continuar</Button> : null}</div>
    </div>
  );
}

function CampaignDetail({ campaign, profile, onClose, onContinue, onChanged }) {
  const [events, setEvents] = useState([]);
  const [pendingControl, setPendingControl] = useState("");
  const [error, setError] = useState("");
  const controlInFlightRef = useRef(false);
  useEffect(() => { listCampaignEvents(profile, campaign.id).then(setEvents).catch((cause) => setError(cause.message)); }, [campaign.id, profile.id]);

  const runControl = async (kind) => {
    if (controlInFlightRef.current || pendingControl) return;
    controlInFlightRef.current = true;
    setPendingControl(kind);
    setError("");
    try {
      if (kind === "cancel") {
        await cancelLocalCampaign(profile, campaign);
      } else if (kind === "pause") {
        await requestCampaignPause(campaign.id);
      } else if (kind === "resume") {
        await requestCampaignResume(campaign.id);
      } else if (kind === "stop") {
        await requestCampaignStop(campaign.id);
      }
      await onChanged();
      onClose();
    } catch (cause) {
      controlInFlightRef.current = false;
      setError(cause.message || "No se pudo aplicar el control. Revisá la conexión e intentá nuevamente.");
      setPendingControl("");
    }
  };

  const canControl = can(profile, "marketing", "whatsappCancelCampaign");
  const running = ["running", "pause_requested", "waiting_contact", "waiting_batch"].includes(campaign.status);
  const resumable = ["paused", "daily_limit_reached"].includes(campaign.status);
  const stoppable = [...ACTIVE_CAMPAIGN_STATUSES].includes(campaign.status) && campaign.status !== "draft";
  const displayStatus = pendingControl === "pause"
    ? "Pausando…"
    : pendingControl === "resume"
      ? "Reanudando…"
      : pendingControl === "stop"
        ? "Deteniendo…"
        : CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status;

  const footer = <div className="fm-dialog-actions">
    <Button variant="secondary" onClick={onClose} disabled={Boolean(pendingControl)}>Cerrar</Button>
    {campaign.status === "draft" ? <Button onClick={onContinue} disabled={Boolean(pendingControl)}>Continuar borrador</Button> : null}
    {canControl && campaign.status === "draft" ? <Button variant="secondary" loading={pendingControl === "cancel"} disabled={Boolean(pendingControl)} onClick={() => runControl("cancel")}>Cancelar borrador</Button> : null}
    {canControl && running ? <Button variant="secondary" loading={pendingControl === "pause"} disabled={Boolean(pendingControl)} onClick={() => runControl("pause")}>Pausar</Button> : null}
    {canControl && resumable ? <Button variant="secondary" loading={pendingControl === "resume"} disabled={Boolean(pendingControl)} onClick={() => runControl("resume")}>Reanudar</Button> : null}
    {canControl && stoppable ? <Button variant="secondary" loading={pendingControl === "stop"} disabled={Boolean(pendingControl)} onClick={() => runControl("stop")}>Detener campaña</Button> : null}
  </div>;

  return <Modal open onClose={pendingControl ? undefined : onClose} title={campaign.name} description="Seguimiento de campaña de WhatsApp" footer={footer}>
    {error ? <Toast tone="error">{error}</Toast> : null}
    {pendingControl ? <Toast tone="info">{displayStatus} La orden fue recibida por esta pantalla y se aplicará en la primera frontera segura.</Toast> : null}
    <dl className="fm-wa-review"><div><dt>Estado</dt><dd><Badge tone={CAMPAIGN_STATUS_TONES[campaign.status] || "neutral"}>{displayStatus}</Badge></dd></div><div><dt>Creador</dt><dd>{campaign.createdByName || campaign.createdBy}</dd></div><div><dt>Fecha</dt><dd>{formatDateTime(campaign.createdAt)}</dd></div><div><dt>Progreso</dt><dd>{campaign.sentCount || 0} / {campaign.totalRecipients || 0} · {campaign.progressPercentage || 0}%</dd></div><div><dt>Problemas</dt><dd>{campaign.errorCount || 0}{campaign.extensionErrorMessage ? ` · ${campaign.extensionErrorMessage}` : ""}</dd></div><div><dt>Segmentación</dt><dd>{Object.entries(campaign.filters || {}).filter(([,value]) => value).map(([key,value]) => `${key}: ${value}`).join(" · ") || "Sin filtros guardados"}</dd></div><div><dt>Mensaje</dt><dd className="fm-wa-review-message">{campaign.message || "Sin texto"}</dd></div><div><dt>Imágenes</dt><dd>{(campaign.imageMetadata || []).map((image) => `${image.order}. ${image.name}`).join(" · ") || "Sin imágenes persistidas"}</dd></div><div><dt>Inicio / fin</dt><dd>{campaign.startedAt ? formatDateTime(campaign.startedAt) : "—"} / {campaign.finishedAt ? formatDateTime(campaign.finishedAt) : "—"}</dd></div></dl>
    <h3>Actividad</h3><div className="fm-wa-events">{events.length ? events.map((event) => <div key={event.id}><strong>{event.label || event.type}</strong><span>{formatDateTime(event.createdAt)}</span>{event.message ? <small>{event.message}</small> : null}</div>) : <p>Sin eventos adicionales.</p>}</div>
  </Modal>;
}

export default function WhatsAppCampaignsPage() {
  const { profile } = useAuth();
  const [extensionStatus, setExtensionStatus] = useState({ operational: false, connectionState: "reconnecting", message: "Comprobando conexión…", configuredLimit: 0, sentToday: 0, availableToday: 0 });
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizard, setWizard] = useState(null);
  const [detail, setDetail] = useState(null);

  const canCreate = can(profile, "marketing", "whatsappCreateCampaign");

  const refreshExtension = async () => {
    const status = await pingWhatsAppExtension();
    setExtensionStatus(status);
    return status;
  };

  const reconnectExtension = async () => {
    if (extensionStatus.connectionState === "needs_page_reload") {
      window.location.reload();
      return;
    }
    setExtensionStatus((current) => ({ ...current, operational: false, connectionState: "reconnecting", message: "Reconectando la extensión…" }));
    await refreshExtension();
  };

  const diagnoseExtension = async () => {
    setExtensionBusy(true);
    try {
      const status = await requestWhatsAppPreflight();
      setExtensionStatus(status);
    } finally {
      setExtensionBusy(false);
    }
  };

  const loadCampaigns = async ({ append = false } = {}) => {
    setLoading(true);
    setError("");
    try {
      const page = await listWhatsAppCampaignsPage(profile, { pageSize: 20, cursor: append ? cursor : null });
      setCampaigns((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (cause) { setError(cause.message); } finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    let heartbeatTimer = null;
    let heartbeatController = null;
    let reconnectAttempt = 0;
    const retryDelays = [1000, 3000, 10000, 30000];

    const scheduleHeartbeat = (delay) => {
      window.clearTimeout(heartbeatTimer);
      if (cancelled || document.visibilityState !== "visible") return;
      heartbeatTimer = window.setTimeout(runHeartbeat, delay);
    };
    const runHeartbeat = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      heartbeatController?.abort();
      heartbeatController = new AbortController();
      try {
        const status = await pingWhatsAppExtension({ signal: heartbeatController.signal });
        if (cancelled) return;
        if (status.connectionState === "connected") {
          reconnectAttempt = 0;
          setExtensionStatus(status);
          scheduleHeartbeat(30000);
          return;
        }
        if (status.connectionState === "needs_page_reload") {
          setExtensionStatus(status);
          return;
        }
        const delay = retryDelays[Math.min(reconnectAttempt, retryDelays.length - 1)];
        reconnectAttempt += 1;
        setExtensionStatus({ ...status, connectionState: "reconnecting", message: "Reconectando la extensión…" });
        scheduleHeartbeat(delay);
      } catch (cause) {
        if (cause?.name !== "AbortError" && !cancelled) scheduleHeartbeat(retryDelays[Math.min(reconnectAttempt++, retryDelays.length - 1)]);
      }
    };

    runHeartbeat();
    loadCampaigns();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        reconnectAttempt = 0;
        runHeartbeat();
      } else {
        heartbeatController?.abort();
        window.clearTimeout(heartbeatTimer);
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    const unsubscribe = subscribeExtensionMessages((message) => {
      if (message.type === EXTENSION_MESSAGE_TYPES.status) {
        setExtensionStatus({
          operational: message.payload.operational === true,
          message: message.payload.message || (message.payload.operational ? "Listo para enviar." : "La conexión necesita revisión."),
          configuredLimit: Number(message.payload.configuredLimit || 0),
          sentToday: Number(message.payload.sentToday || 0),
          availableToday: Number(message.payload.availableToday || 0),
          errorCode: message.payload.errorCode || "",
          connectionState: message.payload.operational === true ? "connected" : message.payload.errorCode === "EXTENSION_CONTEXT_INVALIDATED" ? "needs_page_reload" : "disconnected",
          extensionVersion: message.payload.extensionVersion || "",
          bridgeInstanceId: message.payload.bridgeInstanceId || "",
          bridgeGeneration: Number(message.payload.bridgeGeneration || 0),
        });
      }
      if ([EXTENSION_MESSAGE_TYPES.started, EXTENSION_MESSAGE_TYPES.progress, EXTENSION_MESSAGE_TYPES.paused, EXTENSION_MESSAGE_TYPES.resumed, EXTENSION_MESSAGE_TYPES.completed, EXTENSION_MESSAGE_TYPES.error, EXTENSION_MESSAGE_TYPES.stopped, EXTENSION_MESSAGE_TYPES.cancelled].includes(message.type)) {
        window.setTimeout(() => loadCampaigns(), 350);
      }
    });
    return () => {
      cancelled = true;
      heartbeatController?.abort();
      window.clearTimeout(heartbeatTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const activeCampaigns = campaigns.filter((campaign) => ACTIVE_CAMPAIGN_STATUSES.has(campaign.status));
  const openCampaign = async (campaign) => {
    try { setDetail(await getWhatsAppCampaign(profile, campaign.id)); } catch (cause) { setError(cause.message); }
  };
  const continueDraft = async () => {
    const campaign = detail;
    setDetail(null);
    setWizard(campaign);
  };

  if (wizard !== null) return <CampaignWizard profile={profile} extensionStatus={extensionStatus} refreshExtension={diagnoseExtension} initialCampaign={wizard?.id ? wizard : null} onClose={() => setWizard(null)} onSaved={() => loadCampaigns()} />;

  return <div className="fm-page-enter fm-wa-page">
    <PageHeader eyebrow="Marketing · WhatsApp" title="Campañas y mensajes masivos" description="Prepará campañas, seguí su progreso y controlalas desde una sola pantalla." actions={<div className="fm-page-actions"><Link className="fm-button fm-button--secondary" to="/gestion/marketing"><Icon name="ArrowLeft" />Marketing</Link>{canCreate ? <Button icon="Plus" onClick={() => setWizard({})}>Nueva campaña de WhatsApp</Button> : null}</div>} />
    <ExtensionStatus status={extensionStatus} refreshing={extensionBusy} onRefresh={diagnoseExtension} onReconnect={reconnectExtension} />
    {error ? <Toast tone="error">{error}</Toast> : null}
    {activeCampaigns.length ? <Panel title="Campañas activas" description="Progreso y estado actual."><div className="fm-wa-active-grid">{activeCampaigns.map((campaign) => <button type="button" key={campaign.id} onClick={() => openCampaign(campaign)}><strong>{campaign.name}</strong><span>{campaign.sentCount || 0} / {campaign.totalRecipients || 0}</span><progress max="100" value={campaign.progressPercentage || 0}>{campaign.progressPercentage || 0}%</progress><Badge tone={CAMPAIGN_STATUS_TONES[campaign.status] || "neutral"}>{CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}</Badge></button>)}</div></Panel> : null}
    <Panel title="Historial de campañas" description="Más recientes primero. Se cargan 20 campañas por página.">
      {loading && !campaigns.length ? <Skeleton lines={6} /> : null}
      {!loading && !campaigns.length ? <EmptyState icon="Megaphone" title="Todavía no hay campañas de WhatsApp" description="Creá la primera campaña cuando necesites preparar un envío." /> : null}
      <div className="fm-wa-history">{campaigns.map((campaign) => <button type="button" key={campaign.id} onClick={() => openCampaign(campaign)}><span className="fm-wa-history__main"><strong>{campaign.name}</strong><small>{formatDateTime(campaign.createdAt)} · {campaign.totalRecipients || 0} destinatarios</small></span><span>{campaign.sentCount || 0} enviados · {campaign.progressPercentage || 0}%</span><Badge tone={CAMPAIGN_STATUS_TONES[campaign.status] || "neutral"}>{CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}</Badge>{campaign.extensionErrorMessage ? <small className="fm-wa-history__error">Necesita revisión</small> : null}</button>)}</div>
      {hasMore ? <div className="fm-load-more"><Button variant="secondary" loading={loading} onClick={() => loadCampaigns({ append: true })}>Cargar más campañas</Button></div> : null}
    </Panel>
    {detail ? <CampaignDetail campaign={detail} profile={profile} onClose={() => setDetail(null)} onContinue={continueDraft} onChanged={() => loadCampaigns()} /> : null}
  </div>;
}
