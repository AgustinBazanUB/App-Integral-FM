
import test from "node:test";
import assert from "node:assert/strict";
import { getActivityPresentation, getActivityTypeGroups } from "../src/gestion/activity/activityPresentation.js";

test("las actividades reales reciben iconos semánticos consistentes", () => {
  assert.equal(getActivityPresentation("sale.created").icon, "ReceiptText");
  assert.equal(getActivityPresentation("sale.cancelled").icon, "RotateCcw");
  assert.equal(getActivityPresentation("stock.add").icon, "PackagePlus");
  assert.equal(getActivityPresentation("product.updatedFromLocation").icon, "PackageCheck");
  assert.equal(getActivityPresentation("customer.updated").icon, "UserRoundCheck");
});

test("un tipo desconocido conserva un fallback legible", () => {
  const presentation = getActivityPresentation({ action: "future.event", title: "Evento futuro" });
  assert.equal(presentation.icon, "Activity");
  assert.equal(presentation.label, "Evento futuro");
});

test("el selector agrupa tipos por módulo semántico", () => {
  const groups = getActivityTypeGroups([{ action: "future.event", title: "Evento futuro" }]);
  assert.ok(groups.find((group) => group.label === "Ventas")?.options.some((item) => item.value === "sale.created"));
  assert.ok(groups.find((group) => group.label === "Clientes")?.options.some((item) => item.value === "customer.updated"));
  assert.ok(groups.find((group) => group.label === "Otros")?.options.some((item) => item.value === "future.event"));
});
