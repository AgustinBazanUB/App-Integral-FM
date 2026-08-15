from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path, old, new, count=1):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"No se encontró bloque esperado en {path}: {old[:160]!r}")
    target.write_text(text.replace(old, new, count), encoding="utf-8")


def append(path, content):
    target = ROOT / path
    target.write_text(target.read_text(encoding="utf-8").rstrip() + "\n" + content.rstrip() + "\n", encoding="utf-8")


# Dedicated WhatsApp permissions must not fall back to generic Marketing edit/create/view.
replace("src/gestion/marketing/whatsapp/campaignService.js", '''function canView(profile) {\n  return can(profile, "marketing", "whatsappView") || can(profile, "marketing", "whatsappViewHistory") || can(profile, "marketing", "view");\n}\n\nfunction canCreate(profile) {\n  return can(profile, "marketing", "whatsappCreateCampaign") || can(profile, "marketing", "create");\n}\n\nfunction canSend(profile) {\n  return can(profile, "marketing", "whatsappSendToExtension") || can(profile, "marketing", "edit");\n}\n\nfunction canCancel(profile) {\n  return can(profile, "marketing", "whatsappCancelCampaign") || can(profile, "marketing", "edit");\n}''', '''function canView(profile) {\n  return can(profile, "marketing", "whatsappView") || can(profile, "marketing", "whatsappViewHistory");\n}\n\nfunction canCreate(profile) {\n  return can(profile, "marketing", "whatsappCreateCampaign");\n}\n\nfunction canSend(profile) {\n  return can(profile, "marketing", "whatsappSendToExtension");\n}\n\nfunction canCancel(profile) {\n  return can(profile, "marketing", "whatsappCancelCampaign");\n}''')

replace("src/gestion/marketing/whatsapp/WhatsAppExtensionSync.jsx", '''if (!profile?.id || !(can(profile, "marketing", "whatsappSendToExtension") || can(profile, "marketing", "edit"))) return undefined;''', '''if (!profile?.id || !can(profile, "marketing", "whatsappSendToExtension")) return undefined;''')

replace("src/gestion/pages/WhatsAppCampaignsPage.jsx", '''const canImport = can(profile, "marketing", "whatsappImportExcel") || can(profile, "marketing", "create");\n  const canSend = can(profile, "marketing", "whatsappSendToExtension") || can(profile, "marketing", "edit");''', '''const canImport = can(profile, "marketing", "whatsappImportExcel");\n  const canSend = can(profile, "marketing", "whatsappSendToExtension");''')
replace("src/gestion/pages/WhatsAppCampaignsPage.jsx", '''const canCancel = can(profile, "marketing", "whatsappCancelCampaign") || can(profile, "marketing", "edit");''', '''const canCancel = can(profile, "marketing", "whatsappCancelCampaign");''')
replace("src/gestion/pages/WhatsAppCampaignsPage.jsx", '''const canCreate = can(profile, "marketing", "whatsappCreateCampaign") || can(profile, "marketing", "create");''', '''const canCreate = can(profile, "marketing", "whatsappCreateCampaign");''')

# Hide the WhatsApp entry point when the dedicated permission is denied.
replace("src/gestion/pages/GenericModulePage.jsx", '''{moduleId === "marketing" ? (''', '''{moduleId === "marketing" && can(profile, "marketing", "whatsappView") ? (''')

# Explicit extension-started event; the first progress remains a compatible fallback.
replace("src/gestion/marketing/whatsapp/extensionBridge.js", '''  accepted: "FLORMIA_CAMPAIGN_ACCEPTED",\n  progress: "FLORMIA_CAMPAIGN_PROGRESS",''', '''  accepted: "FLORMIA_CAMPAIGN_ACCEPTED",\n  started: "FLORMIA_CAMPAIGN_STARTED",\n  progress: "FLORMIA_CAMPAIGN_PROGRESS",''')
replace("src/gestion/marketing/whatsapp/extensionBridge.js", '''  EXTENSION_MESSAGE_TYPES.accepted,\n  EXTENSION_MESSAGE_TYPES.progress,''', '''  EXTENSION_MESSAGE_TYPES.accepted,\n  EXTENSION_MESSAGE_TYPES.started,\n  EXTENSION_MESSAGE_TYPES.progress,''')
replace("src/gestion/marketing/whatsapp/extensionBridge.js", '''const campaignEventTypes = new Set([\n  EXTENSION_MESSAGE_TYPES.progress,''', '''const campaignEventTypes = new Set([\n  EXTENSION_MESSAGE_TYPES.started,\n  EXTENSION_MESSAGE_TYPES.progress,''')
replace("src/gestion/marketing/whatsapp/WhatsAppExtensionSync.jsx", '''const campaignEvents = new Set([\n  EXTENSION_MESSAGE_TYPES.progress,''', '''const campaignEvents = new Set([\n  EXTENSION_MESSAGE_TYPES.started,\n  EXTENSION_MESSAGE_TYPES.progress,''')
replace("src/gestion/marketing/whatsapp/campaignService.js", '''const extensionStatusByType = {\n  [EXTENSION_MESSAGE_TYPES.progress]: "running",''', '''const extensionStatusByType = {\n  [EXTENSION_MESSAGE_TYPES.started]: "running",\n  [EXTENSION_MESSAGE_TYPES.progress]: "running",''')
replace("src/gestion/marketing/whatsapp/campaignService.js", '''const actionByType = {\n  [EXTENSION_MESSAGE_TYPES.progress]: "whatsappCampaign.running",''', '''const actionByType = {\n  [EXTENSION_MESSAGE_TYPES.started]: "whatsappCampaign.running",\n  [EXTENSION_MESSAGE_TYPES.progress]: "whatsappCampaign.running",''')
replace("src/gestion/pages/WhatsAppCampaignsPage.jsx", '''if ([EXTENSION_MESSAGE_TYPES.progress, EXTENSION_MESSAGE_TYPES.paused, EXTENSION_MESSAGE_TYPES.completed, EXTENSION_MESSAGE_TYPES.error, EXTENSION_MESSAGE_TYPES.cancelled].includes(message.type)) {''', '''if ([EXTENSION_MESSAGE_TYPES.started, EXTENSION_MESSAGE_TYPES.progress, EXTENSION_MESSAGE_TYPES.paused, EXTENSION_MESSAGE_TYPES.completed, EXTENSION_MESSAGE_TYPES.error, EXTENSION_MESSAGE_TYPES.cancelled].includes(message.type)) {''')

# Persist aggregate progress without spamming audit/event subcollections on every progress tick.
replace("src/gestion/marketing/whatsapp/campaignService.js", '''    transaction.set(campaignRef, update, { merge: true });\n    transaction.set(eventRef, {\n      type: message.type,\n      label: CAMPAIGN_STATUS_LABELS[status],\n      sequence: update.lastExtensionSequence,\n      sentCount: counters.sent,\n      errorCount: counters.errors,\n      progressPercentage: counters.progress,\n      message: status === "error" ? update.extensionErrorMessage : null,\n      createdAt: serverTimestamp(),\n    });\n    transaction.set(auditRef, campaignAudit(profile, actionByType[message.type], message.campaignId, `Campaña de WhatsApp ${CAMPAIGN_STATUS_LABELS[status].toLocaleLowerCase("es")}`, `Progreso reportado: ${counters.sent}/${counters.total}.`));\n    return { ignored: false, status, ...counters };''', '''    transaction.set(campaignRef, update, { merge: true });\n    const statusChanged = current.status !== status;\n    if (statusChanged) {\n      transaction.set(eventRef, {\n        type: message.type,\n        label: CAMPAIGN_STATUS_LABELS[status],\n        sequence: update.lastExtensionSequence,\n        sentCount: counters.sent,\n        errorCount: counters.errors,\n        progressPercentage: counters.progress,\n        message: status === "error" ? update.extensionErrorMessage : null,\n        createdAt: serverTimestamp(),\n      });\n      transaction.set(auditRef, campaignAudit(profile, actionByType[message.type], message.campaignId, `Campaña de WhatsApp ${CAMPAIGN_STATUS_LABELS[status].toLocaleLowerCase("es")}`, `Progreso reportado: ${counters.sent}/${counters.total}.`));\n    }\n    return { ignored: false, status, statusChanged, ...counters };''')

# Excel mapping step includes an actual local preview before confirmation.
replace("src/gestion/pages/WhatsAppCampaignsPage.jsx", '''</div><Button variant="secondary" onClick={confirmExcel}>Confirmar importación</Button></> : null}</div>''', '''</div><div className="fm-wa-excel-preview" aria-label="Vista previa del Excel"><table><thead><tr>{excelSheet.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{excelSheet.rows.slice(0, 5).map((row, rowIndex) => <tr key={rowIndex}>{excelSheet.headers.map((header, columnIndex) => <td key={`${rowIndex}-${header}`}>{row[columnIndex] == null ? "" : String(row[columnIndex])}</td>)}</tr>)}</tbody></table><small>Vista previa de hasta 5 filas. El archivo permanece solamente en tu navegador.</small></div><Button variant="secondary" onClick={confirmExcel}>Confirmar importación</Button></> : null}</div>''')
append("src/styles/whatsapp-marketing.css", '''\n.fm-wa-excel-preview{overflow:auto;border:1px solid #e7ded1;border-radius:10px;background:#fff}.fm-wa-excel-preview table{width:100%;border-collapse:collapse;min-width:520px}.fm-wa-excel-preview th,.fm-wa-excel-preview td{padding:8px 10px;border-bottom:1px solid #eee7dc;text-align:left;white-space:nowrap;font-size:.82rem}.fm-wa-excel-preview th{background:#f8f4ec;position:sticky;top:0}.fm-wa-excel-preview small{display:block;padding:8px 10px;color:#71685f}''')

# Firestore: dedicated WhatsApp permissions, deny-aware, and action-specific campaign mutations.
replace("firestore.rules", '''    function whatsappCanView() {\n      return canModule("marketing", "whatsappView")\n        || canModule("marketing", "whatsappViewHistory")\n        || canModule("marketing", "view");\n    }\n    function whatsappCanCreate() {\n      return canModule("marketing", "whatsappCreateCampaign")\n        || canModule("marketing", "create");\n    }\n    function whatsappCanSend() {\n      return canModule("marketing", "whatsappSendToExtension")\n        || canModule("marketing", "edit");\n    }\n    function whatsappCanCancel() {\n      return canModule("marketing", "whatsappCancelCampaign")\n        || canModule("marketing", "edit");\n    }''', '''    function whatsappDenied(action) {\n      let user = profile();\n      return ("permissionDeny" in user)\n        && ("marketing" in user.permissionDeny)\n        && (user.permissionDeny.marketing is list)\n        && action in user.permissionDeny.marketing;\n    }\n    function whatsappCanView() {\n      return activeUser() && (\n        (!whatsappDenied("whatsappView") && canModule("marketing", "whatsappView"))\n        || (!whatsappDenied("whatsappViewHistory") && canModule("marketing", "whatsappViewHistory"))\n      );\n    }\n    function whatsappCanCreate() {\n      return activeUser()\n        && !whatsappDenied("whatsappCreateCampaign")\n        && canModule("marketing", "whatsappCreateCampaign");\n    }\n    function whatsappCanSend() {\n      return activeUser()\n        && !whatsappDenied("whatsappSendToExtension")\n        && canModule("marketing", "whatsappSendToExtension");\n    }\n    function whatsappCanCancel() {\n      return activeUser()\n        && !whatsappDenied("whatsappCancelCampaign")\n        && canModule("marketing", "whatsappCancelCampaign");\n    }''')

replace("firestore.rules", '''    function validWhatsappRecipient(data) {\n      return data.recipientId is string\n        && data.phoneNormalized is string\n        && data.phoneNormalized.size() >= 8\n        && data.phoneNormalized.size() <= 11\n        && data.source in ["flor_mia", "excel"]\n        && data.status in ["pending", "running", "completed", "error"]\n        && !data.keys().hasAny(["cookies", "token", "password", "imageData", "imageBase64"]);\n    }''', '''    function validWhatsappRecipient(data) {\n      return data.recipientId is string\n        && data.phoneNormalized is string\n        && data.phoneNormalized.size() >= 8\n        && data.phoneNormalized.size() <= 11\n        && data.source in ["flor_mia", "excel"]\n        && data.status in ["pending", "running", "completed", "error"]\n        && !data.keys().hasAny(["cookies", "token", "password", "imageData", "imageBase64"]);\n    }\n    function whatsappCreateCampaignUpdate() {\n      return whatsappCanCreate()\n        && request.resource.data.status in ["draft", "ready"]\n        && request.resource.data.sentCount == 0\n        && request.resource.data.errorCount == 0\n        && request.resource.data.progressPercentage == 0\n        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n          "name", "filters", "message", "imageCount", "imageNames", "imageOrder",\n          "imageMetadata", "totalRecipients", "sentCount", "errorCount",\n          "progressPercentage", "status", "snapshotState", "preparedAt",\n          "updatedBy", "updatedByName", "updatedAt"\n        ]);\n    }\n    function whatsappExtensionCampaignUpdate() {\n      return whatsappCanSend()\n        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n          "status", "sentCount", "errorCount", "progressPercentage",\n          "lastExtensionSequence", "lastExtensionUpdateAt", "startedAt", "finishedAt",\n          "extensionErrorCode", "extensionErrorMessage", "deliveredToExtensionAt",\n          "cancelledAt", "cancelledBy", "updatedBy", "updatedByName", "updatedAt"\n        ]);\n    }\n    function whatsappCancelCampaignUpdate() {\n      return whatsappCanCancel()\n        && request.resource.data.status == "cancelled"\n        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n          "status", "cancelledAt", "cancelledBy", "finishedAt", "updatedAt"\n        ]);\n    }''')

replace("firestore.rules", '''      allow update: if (whatsappCanCreate() || whatsappCanSend() || whatsappCanCancel())\n        && request.resource.data.createdBy == resource.data.createdBy\n        && validWhatsappCampaign(request.resource.data);''', '''      allow update: if request.resource.data.createdBy == resource.data.createdBy\n        && request.resource.data.source == resource.data.source\n        && validWhatsappCampaign(request.resource.data)\n        && (whatsappCreateCampaignUpdate() || whatsappExtensionCampaignUpdate() || whatsappCancelCampaignUpdate());''')
replace("firestore.rules", '''        allow create, update: if (whatsappCanCreate() || whatsappCanSend())\n          && validWhatsappRecipient(request.resource.data);\n        allow delete: if whatsappCanCreate();''', '''        allow create: if whatsappCanCreate()\n          && get(/databases/$(database)/documents/whatsappCampaigns/$(campaignId)).data.status == "draft"\n          && validWhatsappRecipient(request.resource.data);\n        allow update: if whatsappCanSend()\n          && request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n            "status", "updatedAt", "errorCode", "errorMessage"\n          ])\n          && validWhatsappRecipient(request.resource.data);\n        allow delete: if whatsappCanCreate()\n          && get(/databases/$(database)/documents/whatsappCampaigns/$(campaignId)).data.status == "draft";''')

# Contract docs include explicit started message and audit throttling semantics.
replace("docs/whatsapp-extension-contract.md", '''- `FLORMIA_CAMPAIGN_ACCEPTED`\n- `FLORMIA_CAMPAIGN_PROGRESS`''', '''- `FLORMIA_CAMPAIGN_ACCEPTED`\n- `FLORMIA_CAMPAIGN_STARTED`\n- `FLORMIA_CAMPAIGN_PROGRESS`''')
append("docs/whatsapp-extension-contract.md", '''\n## Frecuencia de progreso\n\nLa extensión puede informar progreso tantas veces como sea útil, siempre con `sequence` creciente. La Web-App actualiza los contadores del documento principal, pero sólo crea un evento/auditoría cuando cambia el estado operativo (inicio/reanudación, pausa, finalización, error o cancelación), evitando ruido y escrituras innecesarias.\n''')

# Regression tests for granular permissions and Excel preview.
append("tests/whatsapp-marketing-integration.test.mjs", r'''

test("WhatsApp no hereda permisos genéricos de create/edit y el Excel tiene vista previa", async () => {
  const [service, page, generic] = await Promise.all([
    read("src/gestion/marketing/whatsapp/campaignService.js"),
    read("src/gestion/pages/WhatsAppCampaignsPage.jsx"),
    read("src/gestion/pages/GenericModulePage.jsx"),
  ]);
  assert.doesNotMatch(service, /whatsappCreateCampaign[^\n]+marketing\", \"create/);
  assert.doesNotMatch(service, /whatsappSendToExtension[^\n]+marketing\", \"edit/);
  assert.match(page, /fm-wa-excel-preview/);
  assert.match(generic, /whatsappView/);
});

test("progreso repetido no crea auditoría en cada tick y existe evento started explícito", async () => {
  const [service, bridge] = await Promise.all([
    read("src/gestion/marketing/whatsapp/campaignService.js"),
    read("src/gestion/marketing/whatsapp/extensionBridge.js"),
  ]);
  assert.match(service, /const statusChanged = current\.status !== status/);
  assert.match(service, /if \(statusChanged\)/);
  assert.match(bridge, /FLORMIA_CAMPAIGN_STARTED/);
});
''')

# Client permission regression: a deny on the new action must beat the role template.
append("tests/whatsapp-campaign-domain.test.mjs", r'''

import { can } from "../src/gestion/permissions.js";

test("permissionDeny específico bloquea envío aunque el rol pueda editar Marketing", () => {
  const profile = {
    id: "marketing-1",
    active: true,
    role: "marketing_manager",
    permissionDeny: { marketing: ["whatsappSendToExtension"] },
  };
  assert.equal(can(profile, "marketing", "edit"), true);
  assert.equal(can(profile, "marketing", "whatsappSendToExtension"), false);
  assert.equal(can(profile, "marketing", "whatsappCreateCampaign"), true);
});
''')

# Rules test: create a marketing manager with an explicit send deny and assert rules honor it.
rules_path = ROOT / "tests/firestore.rules.mjs"
text = rules_path.read_text(encoding="utf-8")
seed_marker = '''      setDoc(doc(database, "users", "manager-1"), {\n        name: "Encargado",\n        role: "location_manager",\n        active: true,\n        allowedLocationIds: ["loc-1"],\n      }),'''
seed_new = seed_marker + '''\n      setDoc(doc(database, "users", "marketing-denied"), {\n        name: "Marketing restringido",\n        role: "marketing_manager",\n        active: true,\n        permissionDeny: { marketing: ["whatsappSendToExtension"] },\n      }),'''
if seed_marker not in text:
    raise RuntimeError("No se encontró seed manager-1 en rules tests")
text = text.replace(seed_marker, seed_new, 1)
rules_path.write_text(text, encoding="utf-8")
append("tests/firestore.rules.mjs", r'''

test("reglas respetan denegación específica de envío WhatsApp", async () => {
  const database = environment.authenticatedContext("marketing-denied").firestore();
  const campaignRef = doc(database, "whatsappCampaigns", "wa-denied");
  await assertSucceeds(setDoc(campaignRef, {
    name: "Borrador restringido",
    source: "whatsapp",
    filters: {},
    message: "Hola",
    imageCount: 0,
    imageNames: [],
    imageOrder: [],
    imageMetadata: [],
    totalRecipients: 0,
    sentCount: 0,
    errorCount: 0,
    progressPercentage: 0,
    status: "draft",
    snapshotState: "draft",
    active: true,
    deleted: false,
    createdBy: "marketing-denied",
    createdByName: "Marketing restringido",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await assertFails(updateDoc(campaignRef, {
    status: "running",
    lastExtensionSequence: 1,
    lastExtensionUpdateAt: new Date(),
    updatedAt: new Date(),
  }));
});
''')
