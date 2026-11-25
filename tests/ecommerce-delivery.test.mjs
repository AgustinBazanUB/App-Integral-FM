import assert from "node:assert/strict";
import test from "node:test";
import { lookupAddresses, confirmAddress } from "../netlify/functions/_lib/ecommerce/addressLookup.mjs";
import { quoteAndreani } from "../netlify/functions/_lib/ecommerce/andreani.mjs";
import { calculateDeliveryRate, publicAddressOption, quoteSelectedDelivery, readDeliveryQuote } from "../netlify/functions/_lib/ecommerce/deliveryQuote.mjs";
import { normalizeDeliveryConfig } from "../netlify/functions/_lib/ecommerce/deliveryRates.mjs";

const now = new Date("2026-11-24T15:00:00Z");
const env = {
  FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
  CONTEXT: "deploy-preview",
  ECOMMERCE_DELIVERY_TOKEN_KEY: "a".repeat(43),
  ANDREANI_ENVIRONMENT: "production",
  ANDREANI_USER: "testing-account",
  ANDREANI_PASSWORD: "synthetic-password",
  ANDREANI_CUSTOMER: "testing-customer",
  ANDREANI_CONTRACT: "testing-contract",
  ANDREANI_ORIGIN_BRANCH: "testing-branch",
};
const buenosAires = { street: "Mendoza", number: "1571", city: "Lanús Oeste", municipality: "Lanús", province: "Buenos Aires", postalCode: "1824" };
const capital = { ...buenosAires, city: "Ciudad Autónoma de Buenos Aires", municipality: "", province: "CABA", postalCode: "1428" };
const interior = { ...buenosAires, city: "Santo Tomé", municipality: "La Capital", province: "Santa Fe", postalCode: "3016" };
const items = [{ productId: "oil", quantity: 2, unitPrice: 1210, subtotal: 2420, arcaVatRate: 21 }];
const promotions = { oil: { active: true, freeShippingAmba: true, name: "Promo QA" } };
const delivery = normalizeDeliveryConfig({
  enabled: true,
  rates: [
    { id: "capital", zone: "caba", amount: 500, arcaVatRate: 21 },
    { id: "first", zone: "cordon_1", areas: ["Lanús"], amount: 1600, arcaVatRate: 21 },
    { id: "third", zone: "cordon_3", areas: ["La Plata"], amount: 2400, arcaVatRate: 21 },
  ],
  andreani: { enabled: true, arcaVatRate: 21 },
});
const json = (value) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

test("las sugerencias muestran CABA, Buenos Aires y el resto en ese orden, con la altura confirmada", async () => {
  const usig = (party, city, x, y, altura = 1571) => ({
    altura, tipo: "calle_altura", nombre_calle: "MENDOZA", nombre_localidad: city,
    cod_partido: party, nombre_partido: city, coordenadas: { x, y },
  });
  const fetchImpl = async (url) => {
    if (url.hostname === "servicios.usig.buenosaires.gob.ar") return json({ direccionesNormalizadas: [
      usig("lanus", "Lanús Oeste", -58.4, -34.7),
      usig("caba", "CABA", -58.45, -34.55),
      usig("caba", "CABA", -58.45, -34.55, 1572),
    ] });
    return json({ direcciones: [{
      altura: { valor: 1571 }, calle: { nombre: "MENDOZA" }, localidad_censal: { nombre: "Santo Tomé" },
      departamento: { nombre: "La Capital" }, provincia: { id: "82", nombre: "Santa Fe" },
      ubicacion: { lat: -31.66, lon: -60.77 },
    }] });
  };
  const options = await lookupAddresses("Mendoza 1571", { fetchImpl });
  assert.deepEqual(options.map((place) => place.province), ["CABA", "Buenos Aires", "Santa Fe"]);
  const result = await confirmAddress(options[0], {
    fetchImpl: async (url) => {
      assert.equal(url.searchParams.get("calle"), "MENDOZA");
      assert.equal(url.searchParams.get("altura"), "1571");
      return json({ codigo_postal: "1428", barrio: "Belgrano" });
    },
  });
  assert.equal(result.postalCode, "1428");
  assert.equal(result.neighborhood, "Belgrano");
});

test("el código postal de una localidad con más de un código se considera sin confirmar", async () => {
  await assert.rejects(() => confirmAddress(interior, {
    env,
    fetchImpl: async (url) => {
      assert.equal(url.hostname, "apisqa.andreani.com");
      return json([{ localidad: "SANTO TOME", partido: "LA CAPITAL", provincia: "SANTA FE", codigosPostales: ["3016", "3017"] }]);
    },
  }), { code: "ecommerce-postal-unconfirmed" });
});

test("CABA y los cordones usan la tarifa configurada, y los partidos del AMBA sin tarifa quedan pendientes", async () => {
  const quote = (address, more = {}) => calculateDeliveryRate({ delivery, address, items, ...more });
  assert.equal((await quote(capital)).amount, 500);
  assert.equal((await quote(buenosAires)).name, "Cordón 1");
  assert.equal((await quote({ ...buenosAires, municipality: "La Plata", city: "City Bell", postalCode: "1896" })).name, "Cordón 3");
  assert.equal((await quote(capital, { promotions })).amount, 0);
  await assert.rejects(() => quote({ ...buenosAires, municipality: "La Matanza" }), { code: "ecommerce-delivery-amba-unpriced" });
});

test("fuera del AMBA se cotiza con el contrato de Andreani QA y el bulto, aunque el carrito tenga envío gratis en AMBA", async () => {
  const calls = [];
  const result = await calculateDeliveryRate({
    delivery, address: interior, items, promotions, env,
    settings: { oil: { parcel: { grams: 900, volumeCm3: 2200 } } },
    quoteCarrier: (postal, parcel, options) => quoteAndreani(postal, parcel, {
      ...options,
      fetchImpl: async (url, request) => {
        assert.equal(url.hostname, "apisqa.andreani.com");
        calls.push(url.pathname);
        if (url.pathname === "/login") {
          assert.match(request.headers.Authorization, /^Basic /);
          return json({ token: "synthetic-qa-token" });
        }
        assert.equal(request.headers["x-authorization-token"], "synthetic-qa-token");
        assert.equal(url.searchParams.get("cpDestino"), "3016");
        assert.equal(url.searchParams.get("contrato"), "testing-contract");
        assert.equal(url.searchParams.get("cliente"), "testing-customer");
        assert.equal(url.searchParams.get("sucursalOrigen"), "testing-branch");
        assert.equal(url.searchParams.get("bultos[0][kilos]"), "1.8");
        assert.equal(url.searchParams.get("bultos[0][volumen]"), "4400");
        assert.equal(url.searchParams.get("bultos[0][valorDeclarado]"), "2000.00");
        return json({ tarifaConIva: { total: "7041.21" } });
      },
    }),
  });
  assert.deepEqual(calls, ["/login", "/v1/tarifas"]);
  assert.equal(result.carrier, "andreani");
  assert.equal(result.amount, 7041);
  assert.equal(result.promotion, null);
});

test("el checkout no acepta una cotización con importe alterado o una selección de otra clave", async () => {
  const option = publicAddressOption(capital, { env, now });
  const { quote } = await quoteSelectedDelivery({
    selectionToken: option.selectionToken, delivery, items, env, now, confirm: async () => capital,
  });
  const [payload, mac] = quote.quoteToken.split(".");
  const changed = JSON.parse(Buffer.from(payload, "base64url").toString());
  changed.rate.amount = 0;
  const forged = Buffer.from(JSON.stringify(changed)).toString("base64url") + "." + mac;
  assert.throws(() => readDeliveryQuote(forged, env), { code: "ecommerce-delivery-token-invalid" });
  assert.throws(() => readDeliveryQuote(quote.quoteToken, { ECOMMERCE_DELIVERY_TOKEN_KEY: "b".repeat(43) }), { code: "ecommerce-delivery-token-invalid" });
});
