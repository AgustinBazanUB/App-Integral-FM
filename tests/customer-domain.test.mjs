import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerDraft,
  customerDocumentId,
  matchesCustomerSearch,
  normalizeCustomerPhone,
} from "../src/gestion/customers/customerDomain.js";

test("formatos equivalentes del mismo teléfono argentino producen la misma normalización", () => {
  const variants = [
    "11 1234-5678",
    "(11) 1234-5678",
    "1112345678",
    "+54 11 1234-5678",
    "0054 11 1234-5678",
  ];
  assert.deepEqual([...new Set(variants.map(normalizeCustomerPhone))], ["1112345678"]);
});

test("el formato móvil internacional +54 9 se normaliza al número nacional", () => {
  assert.equal(normalizeCustomerPhone("+54 9 11 6123-4567"), "1161234567");
});

test("el nombre es opcional pero la zona y el teléfono son obligatorios", () => {
  assert.deepEqual(buildCustomerDraft({
    phone: "11 1234-5678",
    zoneId: "zona-norte",
    zoneName: "Zona Norte",
  }), {
    phone: "11 1234-5678",
    phoneNormalized: "1112345678",
    name: "",
    zoneId: "zona-norte",
    zoneName: "Zona Norte",
    customZone: "",
  });
  assert.throws(() => buildCustomerDraft({ phone: "123", zoneName: "CABA" }), /teléfono válido/i);
  assert.throws(() => buildCustomerDraft({ phone: "11 1234-5678" }), /zona/i);
});

test("la zona libre no crea una referencia a una zona global", () => {
  const customer = buildCustomerDraft({
    phone: "11 2222-3333",
    zoneId: "no-debe-usarse",
    zoneName: "Zona previa",
    customZone: "Barrio nuevo",
  });
  assert.equal(customer.zoneId, "");
  assert.equal(customer.zoneName, "Barrio nuevo");
  assert.equal(customer.customZone, "Barrio nuevo");
});

test("el id de cliente es determinístico y no expone el teléfono", async () => {
  const first = await customerDocumentId("11 1234-5678");
  const second = await customerDocumentId("+54 11 1234-5678");
  assert.equal(first, second);
  assert.match(first, /^customer_[0-9a-f]{40}$/);
  assert.doesNotMatch(first, /1112345678/);
});

test("la búsqueda administrativa encuentra teléfono, nombre y zona", () => {
  const customer = {
    phone: "11 1234-5678",
    phoneNormalized: "1112345678",
    name: "Agustín Pérez",
    zoneName: "Zona Norte",
  };
  assert.equal(matchesCustomerSearch(customer, "12345678"), true);
  assert.equal(matchesCustomerSearch(customer, "agustin"), true);
  assert.equal(matchesCustomerSearch(customer, "zona norte"), true);
  assert.equal(matchesCustomerSearch(customer, "sur"), false);
});
