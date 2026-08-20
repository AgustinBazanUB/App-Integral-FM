
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const shell = read("src/gestion/ManagementShell.jsx");
const connection = read("src/gestion/components/ConnectionIndicator.jsx");
const popover = read("src/gestion/components/AnchoredPopover.jsx");
const activity = read("src/gestion/pages/ActivityPage.jsx");
const dashboard = read("src/gestion/pages/DashboardPage.jsx");
const customers = read("src/gestion/pages/LoyalCustomersPage.jsx");
const customerService = read("src/gestion/services/customerService.js");
const rules = read("firestore.rules");

test("header usa un solo chevron de perfil y popovers portales", () => {
  assert.doesNotMatch(shell, /<Dropdown/);
  assert.match(shell, /className="fm-profile-button"/);
  assert.match(shell, /<Icon name="ChevronDown" \/>/);
  assert.equal((shell.match(/<Icon name="ChevronDown" \/>/g) || []).length, 1);
  assert.match(popover, /createPortal/);
  assert.match(popover, /document\.body/);
  assert.match(popover, /event\.key !== "Escape"/);
});

test("conexión es global, compacta, accesible y permite reconectar", () => {
  assert.match(connection, /useConnectionStatus\(\)/);
  assert.match(connection, /aria-expanded=\{open\}/);
  assert.match(connection, /navigator\.onLine/);
  assert.match(connection, /reconnectFirestore\(profile\.id\)/);
  assert.match(connection, /Conexión restablecida\./);
});

test("actividad comparte presentación y mantiene paginación", () => {
  assert.match(activity, /getActivityPresentation/);
  assert.match(activity, /Filtrar por tipo de actividad/);
  assert.match(dashboard, /getActivityPresentation/);
  assert.match(dashboard, /activityType/);
  assert.match(activity, /Cargar más actividad/);
});

test("clientes abren detalle, editan transaccionalmente y WhatsApp no usa el formato visual", () => {
  assert.match(customers, /Detalle del cliente/);
  assert.match(customers, /updateCustomerFromAdmin/);
  assert.match(customers, /customerWhatsAppUrl/);
  assert.match(customers, /rel="noopener noreferrer"/);
  assert.match(customers, /event\.stopPropagation\(\)/);
  assert.match(customerService, /runTransaction/);
  assert.match(customerService, /Ya existe otro cliente con ese teléfono/);
  assert.match(customerService, /movedToCustomerId/);
  assert.match(customerService, /action: "customer\.updated"/);
});

test("reglas permiten migración de ID al editar y auditoría de clientes", () => {
  assert.match(rules, /canModule\("loyal-customers", "create"\) \|\| canModule\("loyal-customers", "edit"\)/);
  assert.match(rules, /request\.resource\.data\.moduleId == "loyal-customers"/);
});
