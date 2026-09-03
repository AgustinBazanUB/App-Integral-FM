import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, FormField, PageHeader, SearchInput, Skeleton, Toast } from "../../design-system";
import { Link } from "../../router";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import {
  customerDisplayName,
  customerZoneLabel,
  formatPhoneForDisplay,
  normalizeCustomerPhone,
  normalizedSearchText,
} from "../customers/customerDomain";
import { can } from "../permissions";
import { pingWhatsAppExtension } from "../marketing/whatsapp/extensionBridge";
import {
  createCustomerFromAdminIfMissing,
  findCustomerByPhone,
  findCustomersByPhones,
  listActiveCustomerZones,
  updateCustomerFromAdmin,
} from "../services/customerService";
import { getWhatsAppInboxChats, getWhatsAppInboxMessages, sendWhatsAppInboxText } from "../social/whatsapp/inboxBridge";

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "unread", label: "No leídos" },
  { id: "no-zone", label: "Sin zona" },
  { id: "new", label: "Nuevos contactos" },
];
const EMPTY_FORM = { name: "", zoneId: "", customZone: "" };
const CHAT_TYPE_LABEL = { group: "Grupo", channel: "Canal", community: "Comunidad", other: "Otro" };

function connectionPresentation(state) {
  if (state.status === "loading") return { tone: "neutral", label: "Comprobando conexión…" };
  if (state.status === "connected") return { tone: "success", label: "WhatsApp conectado" };
  if (state.code === "EXTENSION_NOT_AVAILABLE" || state.code === "extension_unavailable") return { tone: "error", label: "Extensión no detectada" };
  if (state.code === "WHATSAPP_NOT_OPEN") return { tone: "warning", label: "WhatsApp Web cerrado" };
  if (state.code === "SESSION_NOT_READY" || state.code === "session_not_ready") return { tone: "warning", label: "Sesión de WhatsApp pendiente" };
  if (state.code === "CAMPAIGN_CONFLICT") return { tone: "warning", label: "WhatsApp ocupado" };
  return { tone: "error", label: "WhatsApp necesita revisión" };
}

function emptyStateForConnection(connection, retry) {
  if (connection.code === "EXTENSION_NOT_AVAILABLE" || connection.code === "extension_unavailable") return <EmptyState icon="PlugZap" title="La extensión no está disponible" description="Comprobá que Flor Mía WhatsApp Sender esté instalada, actualizada y habilitada para este dominio." action={<Button variant="secondary" onClick={retry}>Volver a comprobar</Button>} />;
  if (connection.code === "WHATSAPP_NOT_OPEN") return <EmptyState icon="MessagesSquare" title="WhatsApp Web está cerrado" description="Abrí web.whatsapp.com en otra pestaña con esta misma sesión de Chrome y después reintentá." action={<Button variant="secondary" onClick={retry}>Ya lo abrí</Button>} />;
  if (connection.code === "SESSION_NOT_READY" || connection.code === "session_not_ready") return <EmptyState icon="QrCode" title="WhatsApp necesita iniciar sesión" description="Completá el inicio de sesión en WhatsApp Web. La bandeja no simula conversaciones." action={<Button variant="secondary" onClick={retry}>Comprobar sesión</Button>} />;
  return <EmptyState icon="TriangleAlert" title="No pudimos leer WhatsApp" description={connection.message || "La extensión está disponible, pero WhatsApp Web no respondió de la forma esperada."} action={<Button variant="secondary" onClick={retry}>Reintentar</Button>} />;
}

function zoneSelection(customer, zones) {
  if (!customer) return EMPTY_FORM;
  const configured = zones.find((zone) => zone.id === customer.zoneId && zone.active !== false);
  const custom = customer.customZone || (!configured && customer.zoneName ? customer.zoneName : "");
  return { name: customer.name || "", zoneId: custom ? "__custom" : (configured?.id || ""), customZone: custom };
}

function displayedPhone(chat) {
  if (!chat?.phone) return "Teléfono no disponible";
  return formatPhoneForDisplay(normalizeCustomerPhone(chat.phone)) || chat.phone;
}

function crmEligibleChat(chat) {
  return chat?.chatType !== "group" && chat?.chatType !== "channel" && chat?.chatType !== "community" && Boolean(normalizeCustomerPhone(chat?.phone));
}

function CustomerBadge({ chat, crm }) {
  if (chat && !crmEligibleChat(chat)) return <Badge tone="neutral">{CHAT_TYPE_LABEL[chat.chatType] || "Sin CRM"}</Badge>;
  if (!crm || crm.status === "loading") return <Badge tone="neutral">Buscando cliente…</Badge>;
  if (crm.status === "existing") return <Badge tone="success">Cliente registrado</Badge>;
  if (crm.status === "new") return <Badge tone="warning">Nuevo contacto</Badge>;
  return <Badge tone="neutral">Sin teléfono verificable</Badge>;
}

function ChatList({ chats, selectedId, crmByChat, onSelect }) {
  return <div className="fm-wa-inbox__chat-list" role="list">{chats.map((chat) => {
    const crm = crmByChat[chat.chatId];
    const zone = crm?.customer ? customerZoneLabel(crm.customer) : "";
    return <button type="button" role="listitem" key={chat.chatId} className={`fm-wa-chat ${selectedId === chat.chatId ? "is-selected" : ""}`} onClick={() => onSelect(chat)}>
      <span className="fm-wa-chat__avatar" aria-hidden="true">{String(chat.name || "W").trim().charAt(0).toLocaleUpperCase("es") || "W"}</span>
      <span className="fm-wa-chat__body">
        <span className="fm-wa-chat__heading"><strong>{chat.name || displayedPhone(chat)}</strong><small>{chat.timestampLabel || ""}</small></span>
        <span className="fm-wa-chat__preview">{chat.lastMessage || "Sin preview de texto"}</span>
        <span className="fm-wa-chat__meta">
          {crm?.status === "existing" ? <span><Icon name="UserRoundCheck" />Cliente</span> : null}
          {zone ? <span><Icon name="MapPin" />{zone}</span> : null}
          {chat.chatType && chat.chatType !== "individual" ? <span><Icon name="UsersRound" />{CHAT_TYPE_LABEL[chat.chatType] || "Otro"}</span> : null}
          {!chat.phone && (!chat.chatType || chat.chatType === "individual") ? <span><Icon name="ShieldQuestion" />Teléfono no disponible</span> : null}
        </span>
      </span>
      {chat.unreadCount > 0 ? <span className="fm-wa-chat__unread" aria-label={`${chat.unreadDisplay || chat.unreadCount} mensajes no leídos`}>{chat.unreadDisplay || chat.unreadCount}</span> : null}
    </button>;
  })}</div>;
}

function Messages({ conversation }) {
  if (!conversation?.messages?.length) return <EmptyState icon="MessageCircle" title="No hay mensajes de texto visibles" description="Esta versión muestra únicamente texto reciente cargado por WhatsApp Web; multimedia no se importa ni se almacena." />;
  return <div className="fm-wa-conversation__messages" aria-live="polite">
    {conversation.hasMore ? <div className="fm-wa-conversation__history-note">Hay historial anterior. Se carga sólo el bloque reciente.</div> : null}
    {conversation.messages.map((message) => <article key={message.messageId} className={`fm-wa-message fm-wa-message--${message.direction}`}><p>{message.text}</p>{message.timestampLabel ? <small>{message.timestampLabel}</small> : null}</article>)}
  </div>;
}

export default function WhatsAppInboxPage() {
  const { profile } = useAuth();
  const canViewCustomers = can(profile, "loyal-customers", "view");
  const canEditCustomers = can(profile, "loyal-customers", "edit");
  const canCreateCustomers = can(profile, "loyal-customers", "create") || canEditCustomers;
  const canRespond = can(profile, "social", "edit") || can(profile, "social", "create");
  const lookupCache = useRef(new Map());
  const [connection, setConnection] = useState({ status: "loading", code: "", message: "" });
  const [chats, setChats] = useState([]);
  const [chatsStatus, setChatsStatus] = useState("idle");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedChat, setSelectedChat] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [conversationStatus, setConversationStatus] = useState("idle");
  const [conversationError, setConversationError] = useState("");
  const [crmByChat, setCrmByChat] = useState({});
  const [zones, setZones] = useState([]);
  const [crmForm, setCrmForm] = useState(EMPTY_FORM);
  const [crmBusy, setCrmBusy] = useState(false);
  const [crmMessage, setCrmMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [sendState, setSendState] = useState({ status: "idle", message: "" });
  const [mobileView, setMobileView] = useState("list");

  const hydrateCrm = useCallback(async (nextChats) => {
    if (!canViewCustomers) return;
    const eligible = nextChats.map((chat) => ({ chat, phone: crmEligibleChat(chat) ? normalizeCustomerPhone(chat.phone) : "" }));
    const missingPhones = [...new Set(eligible.map((item) => item.phone).filter((phone) => phone && !lookupCache.current.has(phone)))];
    if (missingPhones.length) {
      try {
        const found = await findCustomersByPhones(missingPhones);
        for (const phone of missingPhones) lookupCache.current.set(phone, found.get(phone) || null);
      } catch (error) {
        for (const phone of missingPhones) lookupCache.current.set(phone, { __lookupError: error });
      }
    }
    const entries = eligible.map(({ chat, phone }) => {
      if (!phone) return [chat.chatId, { status: "unavailable", customer: null }];
      const customer = lookupCache.current.get(phone);
      if (customer?.__lookupError) return [chat.chatId, { status: "error", customer: null, error: customer.__lookupError }];
      return [chat.chatId, customer ? { status: "existing", customer } : { status: "new", customer: null }];
    });
    setCrmByChat((current) => ({ ...current, ...Object.fromEntries(entries) }));
  }, [canViewCustomers]);

  const loadInbox = useCallback(async () => {
    setChatsStatus("loading");
    setConnection({ status: "loading", code: "", message: "" });
    try {
      const extension = await pingWhatsAppExtension({ timeoutMs: 5000 });
      if (extension.connectionState === "disconnected" && !extension.runtimeAvailable) {
        setConnection({ status: "error", code: extension.errorCode || "EXTENSION_NOT_AVAILABLE", message: extension.message });
        setChatsStatus("error");
        return;
      }
      const nextChats = await getWhatsAppInboxChats({ limit: 80 });
      setChats(nextChats);
      setConnection({ status: "connected", code: "", message: "WhatsApp Web y la extensión están disponibles." });
      setChatsStatus("ready");
      void hydrateCrm(nextChats);
    } catch (error) {
      setConnection({ status: "error", code: error.code || "UNKNOWN_ERROR", message: error.message });
      setChatsStatus("error");
    }
  }, [hydrateCrm]);

  useEffect(() => {
    void loadInbox();
    listActiveCustomerZones().then(setZones).catch(() => setZones([]));
  }, [loadInbox]);

  const selectChat = useCallback(async (chat) => {
    setSelectedChat(chat);
    setConversation(null);
    setConversationError("");
    setConversationStatus("loading");
    setSendState({ status: "idle", message: "" });
    setMobileView("conversation");
    try {
      const next = await getWhatsAppInboxMessages(chat.chatId, { limit: 50 });
      setConversation(next);
      const actualChat = next.chat || chat;
      setSelectedChat(actualChat);
      setChats((current) => current.map((item) => item.chatId === chat.chatId ? { ...item, ...actualChat } : item));
      setConversationStatus("ready");
      if (next.chat) void hydrateCrm([next.chat]);
    } catch (error) {
      setConversationError(error.message || "No se pudieron obtener los mensajes.");
      setConversationStatus("error");
    }
  }, [hydrateCrm]);

  const selectedCrm = selectedChat ? crmByChat[selectedChat.chatId] : null;
  useEffect(() => {
    setCrmForm(zoneSelection(selectedCrm?.customer, zones));
    setCrmMessage("");
  }, [selectedCrm?.customer?.id, selectedCrm?.customer?.updatedAt, selectedChat?.chatId, zones]);

  const counts = useMemo(() => ({
    all: chats.length,
    unread: chats.filter((chat) => Number(chat.unreadCount || 0) > 0).length,
    "no-zone": chats.filter((chat) => crmByChat[chat.chatId]?.status === "existing" && !customerZoneLabel(crmByChat[chat.chatId].customer)).length,
    new: chats.filter((chat) => crmByChat[chat.chatId]?.status === "new").length,
  }), [chats, crmByChat]);

  const visibleChats = useMemo(() => {
    const term = normalizedSearchText(search);
    return chats.filter((chat) => {
      const crm = crmByChat[chat.chatId];
      if (filter === "unread" && Number(chat.unreadCount || 0) <= 0) return false;
      if (filter === "no-zone" && !(crm?.status === "existing" && !customerZoneLabel(crm.customer))) return false;
      if (filter === "new" && crm?.status !== "new") return false;
      if (!term) return true;
      return normalizedSearchText([chat.name, chat.phone, chat.lastMessage, crm?.customer?.name, crm?.customer ? customerZoneLabel(crm.customer) : ""].join(" ")).includes(term);
    });
  }, [chats, crmByChat, filter, search]);

  const nextUnread = useMemo(() => chats.find((chat) => chat.chatId !== selectedChat?.chatId && Number(chat.unreadCount || 0) > 0), [chats, selectedChat?.chatId]);

  const saveCrm = async () => {
    if (!selectedChat?.phone || !crmEligibleChat(selectedChat)) return;
    setCrmBusy(true);
    setCrmMessage("");
    try {
      const selectedZone = zones.find((zone) => zone.id === crmForm.zoneId);
      const input = {
        phone: selectedCrm?.customer?.phone || selectedChat.phone,
        name: crmForm.name || selectedCrm?.customer?.name || selectedChat.name || "",
        zoneId: selectedZone?.id || "",
        zoneName: selectedZone?.name || "",
        customZone: crmForm.zoneId === "__custom" ? crmForm.customZone : "",
      };
      let customerId;
      if (selectedCrm?.status === "existing") {
        const result = await updateCustomerFromAdmin(profile, selectedCrm.customer, input);
        customerId = result.id;
      } else {
        const result = await createCustomerFromAdminIfMissing(profile, input);
        customerId = result.id;
      }
      const normalized = normalizeCustomerPhone(selectedChat.phone);
      lookupCache.current.delete(normalized);
      const refreshed = await findCustomerByPhone(selectedChat.phone);
      lookupCache.current.set(normalized, refreshed);
      setCrmByChat((current) => ({ ...current, [selectedChat.chatId]: { status: "existing", customer: refreshed || { id: customerId, ...input } } }));
      setCrmMessage(selectedCrm?.status === "existing" ? "Cliente actualizado en CRM." : "Cliente relacionado sin duplicar ni sobrescribir una alta concurrente.");
    } catch (error) {
      setCrmMessage(error.message || "No se pudo guardar el cliente.");
    } finally {
      setCrmBusy(false);
    }
  };

  const sendText = async (event) => {
    event.preventDefault();
    if (!canRespond || !selectedChat || !crmEligibleChat(selectedChat) || !draft.trim() || sendState.status === "sending") return;
    const text = draft.trim();
    setSendState({ status: "sending", message: "Enviando…" });
    try {
      await sendWhatsAppInboxText(selectedChat.chatId, text);
      setDraft("");
      setSendState({ status: "sent", message: "Enviado y confirmado" });
      const refreshed = await getWhatsAppInboxMessages(selectedChat.chatId, { limit: 50 });
      setConversation(refreshed);
      if (refreshed.chat) setChats((current) => current.map((item) => item.chatId === refreshed.chat.chatId ? { ...item, ...refreshed.chat } : item));
    } catch (error) {
      const uncertain = error?.details?.inboxReason === "SEND_STATUS_UNKNOWN";
      setSendState({ status: "error", message: uncertain ? `${error.message} Revisá WhatsApp antes de reintentar.` : (error.message || "No se pudo enviar el mensaje.") });
    }
  };

  const connectionUi = connectionPresentation(connection);
  const whatsappLabels = Array.isArray(selectedChat?.labels) ? [...new Set(selectedChat.labels.filter(Boolean))] : [];

  return <div className="fm-page fm-wa-inbox-page">
    <PageHeader eyebrow="Redes Sociales · WhatsApp" title="Bandeja comercial" description="Respondé texto y completá CRM sin copiar el historial de WhatsApp a Firebase." actions={<div className="fm-wa-inbox__header-actions"><Badge tone={connectionUi.tone}>{connectionUi.label}</Badge>{nextUnread ? <Button variant="secondary" onClick={() => selectChat(nextUnread)}>Siguiente no leído</Button> : null}<Button variant="secondary" icon="RefreshCw" onClick={loadInbox}>Actualizar</Button></div>} />

    <div className="fm-wa-inbox__mobile-nav" aria-label="Navegación de WhatsApp en pantalla pequeña">
      <button type="button" className={mobileView === "list" ? "is-active" : ""} onClick={() => setMobileView("list")}><Icon name="List" />Chats</button>
      <button type="button" disabled={!selectedChat} className={mobileView === "conversation" ? "is-active" : ""} onClick={() => setMobileView("conversation")}><Icon name="MessageCircle" />Conversación</button>
      <button type="button" disabled={!selectedChat} className={mobileView === "crm" ? "is-active" : ""} onClick={() => setMobileView("crm")}><Icon name="ContactRound" />Cliente</button>
    </div>

    {connection.status === "error" ? <section className="fm-wa-inbox__connection-state">{emptyStateForConnection(connection, loadInbox)}</section> : <div className="fm-wa-inbox" data-mobile-view={mobileView}>
      <aside className="fm-wa-inbox__list-column">
        <div className="fm-wa-inbox__toolbar"><SearchInput label="Buscar conversaciones" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="fm-wa-inbox__filters" role="tablist" aria-label="Filtros de conversaciones">{FILTERS.map((item) => <button type="button" role="tab" aria-selected={filter === item.id} key={item.id} className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)}><span>{item.label}</span><b>{counts[item.id]}</b></button>)}</div></div>
        {chatsStatus === "loading" ? <div className="fm-wa-inbox__loading"><Skeleton lines={8} /></div> : null}
        {chatsStatus === "ready" && !chats.length ? <EmptyState icon="MessagesSquare" title="No hay conversaciones visibles" description="WhatsApp Web no devolvió chats en la bandeja actual." /> : null}
        {chatsStatus === "ready" && chats.length && !visibleChats.length ? <EmptyState icon="ListFilter" title={`No hay conversaciones en “${FILTERS.find((item) => item.id === filter)?.label || "este filtro"}”`} description="Probá otro filtro o limpiá la búsqueda." /> : null}
        {chatsStatus === "ready" ? <ChatList chats={visibleChats} selectedId={selectedChat?.chatId} crmByChat={crmByChat} onSelect={selectChat} /> : null}
      </aside>

      <main className="fm-wa-inbox__conversation-column">
        {!selectedChat ? <EmptyState icon="MessageSquareText" title="Elegí una conversación" description="Los mensajes se solicitan a WhatsApp Web sólo al abrir un chat." /> : <>
          <header className="fm-wa-conversation__header"><button type="button" className="fm-wa-inbox__back" onClick={() => setMobileView("list")} aria-label="Volver a chats"><Icon name="ArrowLeft" /></button><div><strong>{selectedChat.name || displayedPhone(selectedChat)}</strong><span>{selectedChat.chatType && selectedChat.chatType !== "individual" ? CHAT_TYPE_LABEL[selectedChat.chatType] || "Otro" : displayedPhone(selectedChat)}</span></div><CustomerBadge chat={selectedChat} crm={selectedCrm} /><button type="button" className="fm-wa-inbox__open-crm" onClick={() => setMobileView("crm")}><Icon name="ContactRound" />Ficha</button></header>
          {conversationStatus === "loading" ? <div className="fm-wa-inbox__loading"><Skeleton lines={7} /></div> : null}
          {conversationStatus === "error" ? <EmptyState icon="TriangleAlert" title="No pudimos cargar los mensajes" description={conversationError} action={<Button variant="secondary" onClick={() => selectChat(selectedChat)}>Reintentar</Button>} /> : null}
          {conversationStatus === "ready" ? <Messages conversation={conversation} /> : null}
          <form className="fm-wa-composer" onSubmit={sendText}><label htmlFor="wa-inbox-reply">Responder por WhatsApp</label><div><textarea id="wa-inbox-reply" rows="2" value={draft} maxLength={4096} onChange={(event) => setDraft(event.target.value)} placeholder={crmEligibleChat(selectedChat) ? "Escribí un mensaje de texto…" : "Este tipo de chat no admite respuesta desde el Inbox"} disabled={!canRespond || !crmEligibleChat(selectedChat)} /><Button type="submit" icon="Send" loading={sendState.status === "sending"} disabled={!canRespond || !crmEligibleChat(selectedChat) || !draft.trim()}>Enviar</Button></div>{!canRespond ? <small className="fm-wa-composer__status fm-wa-composer__status--error">Tu perfil no tiene permiso de edición en Redes Sociales.</small> : null}{sendState.message ? <small className={`fm-wa-composer__status fm-wa-composer__status--${sendState.status}`}>{sendState.message}</small> : null}</form>
        </>}
      </main>

      <aside className="fm-wa-inbox__crm-column">
        {!selectedChat ? <EmptyState icon="ContactRound" title="Ficha comercial" description="Seleccioná un chat para relacionarlo con Clientes." /> : <div className="fm-wa-crm-card">
          <div className="fm-wa-crm-card__heading"><button type="button" className="fm-wa-inbox__back" onClick={() => setMobileView("conversation")} aria-label="Volver a la conversación"><Icon name="ArrowLeft" /></button><div><small>Ficha rápida</small><h2>{selectedCrm?.customer ? customerDisplayName(selectedCrm.customer) : selectedChat.name || "Nuevo contacto"}</h2></div></div>
          <CustomerBadge chat={selectedChat} crm={selectedCrm} />
          <dl className="fm-wa-crm-card__facts"><div><dt>Teléfono</dt><dd>{displayedPhone(selectedChat)}</dd></div><div><dt>Zona</dt><dd>{selectedCrm?.customer ? customerZoneLabel(selectedCrm.customer) || "Sin asignar" : "Sin asignar"}</dd></div></dl>
          {!canViewCustomers ? <Toast tone="warning">Tu perfil puede atender Redes Sociales, pero no consultar Clientes.</Toast> : null}
          {!crmEligibleChat(selectedChat) ? <Toast tone="warning">{selectedChat.chatType && selectedChat.chatType !== "individual" ? "Grupos, canales y comunidades no se convierten en clientes." : "WhatsApp no expuso un teléfono verificable. No se hará un vínculo CRM por inferencia."}</Toast> : null}
          {selectedCrm?.status === "error" ? <Toast tone="error">No se pudo consultar el cliente por teléfono.</Toast> : null}
          {(selectedCrm?.status === "existing" || selectedCrm?.status === "new") ? <div className="fm-wa-crm-card__form">
            <FormField label="Nombre"><input value={crmForm.name} onChange={(event) => setCrmForm((current) => ({ ...current, name: event.target.value }))} disabled={selectedCrm.status === "existing" ? !canEditCustomers : !canCreateCustomers} /></FormField>
            <FormField label="Zona" required hint="Se guarda en la misma ficha de Clientes y queda disponible para segmentación."><select value={crmForm.zoneId} onChange={(event) => setCrmForm((current) => ({ ...current, zoneId: event.target.value, customZone: event.target.value === "__custom" ? current.customZone : "" }))} disabled={selectedCrm.status === "existing" ? !canEditCustomers : !canCreateCustomers}><option value="">Seleccionar zona</option>{zones.filter((zone) => zone.active !== false).map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}<option value="__custom">Otra zona…</option></select></FormField>
            {crmForm.zoneId === "__custom" ? <FormField label="Zona personalizada"><input value={crmForm.customZone} onChange={(event) => setCrmForm((current) => ({ ...current, customZone: event.target.value }))} disabled={selectedCrm.status === "existing" ? !canEditCustomers : !canCreateCustomers} /></FormField> : null}
            {selectedCrm.status === "existing" && canEditCustomers ? <Button icon="Save" loading={crmBusy} onClick={saveCrm}>Guardar cambios</Button> : null}
            {selectedCrm.status === "new" && canCreateCustomers ? <Button icon="UserPlus" loading={crmBusy} onClick={saveCrm}>Crear cliente</Button> : null}
            {selectedCrm.status === "new" && !canCreateCustomers ? <Toast tone="warning">Tu perfil puede ver el contacto, pero no crear Clientes.</Toast> : null}
            {crmMessage ? <Toast tone={crmMessage.toLocaleLowerCase("es").includes("no se pudo") ? "error" : "success"}>{crmMessage}</Toast> : null}
          </div> : null}
          <section className="fm-wa-crm-card__labels"><h3>Etiquetas de WhatsApp</h3>{whatsappLabels.length ? <div>{whatsappLabels.map((label) => <Badge key={label} tone="neutral">{label}</Badge>)}</div> : <p>Sin etiquetas detectadas para este chat. Se mantienen separadas del CRM: Clientes no posee hoy un modelo de etiquetas persistentes equivalente.</p>}</section>
          {selectedCrm?.status === "existing" ? <Link className="fm-button fm-button--secondary" to="/gestion/loyal-customers">Abrir módulo Clientes</Link> : null}
        </div>}
      </aside>
    </div>}
  </div>;
}
