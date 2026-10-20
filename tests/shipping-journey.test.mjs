import test from "node:test";
import assert from "node:assert/strict";
import { deliveryJourney } from "../src/gestion/shipping/deliveryJourney.mjs";

test("direct delivery moves through received, preparation, ready, transit and delivery", () => {
  const received = deliveryJourney("manual", "aprobado");
  const preparing = deliveryJourney("manual", "en_preparacion");
  const ready = deliveryJourney("uber", "listo_retirar");
  const onWay = deliveryJourney("manual", "reparto_final");
  const delivered = deliveryJourney("manual", "entregado");

  assert.equal(received.index, 0);
  assert.equal(received.scene, "received");
  assert.match(received.message, /recibimos/i);
  assert.equal(preparing.index, 1);
  assert.equal(preparing.scene, "preparing");
  assert.equal(preparing.inMotion, false);
  assert.equal(ready.index, 2);
  assert.equal(ready.scene, "ready");
  assert.equal(ready.inMotion, false);
  assert.equal(onWay.index, 3);
  assert.equal(onWay.scene, "to-customer");
  assert.equal(onWay.inMotion, true);
  assert.equal(delivered.index, 4);
  assert.equal(delivered.scene, "delivered");
  assert.equal(delivered.inMotion, false);
});

test("repository delivery includes preparation, repository and customer milestones", () => {
  const departure = deliveryJourney("repository", "hacia_repositorio");
  const atRepository = deliveryJourney("repository", "recibido_repositorio");
  const finalLeg = deliveryJourney("repository", "reparto_final");
  const delivered = deliveryJourney("repository", "entregado");

  assert.equal(departure.index, 3);
  assert.equal(departure.scene, "to-repository");
  assert.equal(atRepository.index, 4);
  assert.equal(atRepository.scene, "at-repository");
  assert.equal(atRepository.inMotion, false);
  assert.equal(finalLeg.index, 5);
  assert.equal(finalLeg.scene, "to-customer");
  assert.equal(delivered.index, 6);
  assert.equal(delivered.scene, "delivered");
  assert.deepEqual(delivered.steps, ["Pedido recibido", "Preparando", "Listo para salir", "Hacia el repositorio", "En repositorio", "Hacia tu domicilio", "Entregado"]);
});

test("a pending seller request is shown as received and does not invent movement", () => {
  const pending = deliveryJourney("manual", "solicitud_pendiente");
  assert.equal(pending.index, 0);
  assert.equal(pending.scene, "received");
  assert.equal(pending.inMotion, false);
  assert.match(pending.message, /revisando/i);
});

test("exceptional states stop the motorcycle and do not mark any normal step active", () => {
  for (const status of ["cancelado", "devuelto", "no_entregado", "rechazado"]) {
    const journey = deliveryJourney("repository", status);
    assert.equal(journey.index, -1);
    assert.equal(journey.inMotion, false);
    assert.equal(journey.exception, true);
    assert.match(journey.message, /pedido|envío|entrega|solicitud/i);
  }
  const unknown = deliveryJourney("manual", "unexpected_state");
  assert.equal(unknown.index, -1);
  assert.equal(unknown.scene, "paused");
  assert.equal(unknown.inMotion, false);
  assert.match(unknown.message, /revisión/i);
});
