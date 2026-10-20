import test from "node:test";
import assert from "node:assert/strict";
import { deliveryJourney } from "../src/gestion/shipping/deliveryJourney.mjs";

test("direct delivery separates confirmed checkpoints from animated phases", () => {
  const received = deliveryJourney("manual", "aprobado");
  const preparing = deliveryJourney("manual", "en_preparacion");
  const ready = deliveryJourney("uber", "listo_retirar");
  const onWay = deliveryJourney("manual", "reparto_final");
  const delivered = deliveryJourney("manual", "entregado");

  assert.equal(received.scene, "preparing");
  assert.equal(received.completedCount, 1);
  assert.equal(received.activePhase.id, "preparing");
  assert.equal(preparing.completedCount, 1);
  assert.equal(preparing.scene, "preparing");
  assert.equal(preparing.inMotion, false);
  assert.equal(ready.completedCount, 2);
  assert.equal(ready.activePhase.id, "waiting-at-origin");
  assert.equal(ready.scene, "ready");
  assert.equal(ready.inMotion, false);
  assert.equal(onWay.completedCount, 3);
  assert.equal(onWay.activePhase.id, "to-customer");
  assert.equal(onWay.scene, "to-customer");
  assert.equal(onWay.inMotion, true);
  assert.equal(delivered.completedCount, 4);
  assert.equal(delivered.activePhase, null);
  assert.equal(delivered.scene, "delivered");
  assert.deepEqual(delivered.checkpoints.map(step => step.label), ["Pedido recibido", "Listo para retirar", "Repartidor lo retiró", "Entregado"]);
});

test("repository delivery adds pickup, depot arrival, waiting, departure and final delivery", () => {
  const departure = deliveryJourney("repository", "hacia_repositorio");
  const atRepository = deliveryJourney("repository", "recibido_repositorio");
  const finalLeg = deliveryJourney("repository", "reparto_final");
  const delivered = deliveryJourney("repository", "entregado");

  assert.equal(departure.completedCount, 3);
  assert.equal(departure.scene, "to-repository");
  assert.equal(departure.activePhase.id, "to-repository");
  assert.equal(departure.inMotion, true);
  assert.equal(atRepository.completedCount, 4);
  assert.equal(atRepository.scene, "waiting-courier");
  assert.equal(atRepository.activePhase.id, "waiting-final-courier");
  assert.equal(atRepository.inMotion, false);
  assert.equal(finalLeg.completedCount, 5);
  assert.equal(finalLeg.scene, "to-customer");
  assert.equal(finalLeg.activePhase.id, "to-customer");
  assert.equal(delivered.completedCount, 6);
  assert.equal(delivered.activePhase, null);
  assert.deepEqual(delivered.checkpoints.map(step => step.label), [
    "Pedido recibido", "Listo para retirar", "Repartidor lo retiró", "Entregado en repositorio", "Salió del repositorio", "Entregado",
  ]);
});

test("a pending seller request stays at received while approval is active", () => {
  const pending = deliveryJourney("manual", "solicitud_pendiente");
  assert.equal(pending.completedCount, 1);
  assert.equal(pending.scene, "received");
  assert.equal(pending.inMotion, false);
  assert.equal(pending.activePhase.id, "confirming");
  assert.match(pending.message, /confirmando/i);
});

test("exceptional or unknown states stop movement and hide the active progress phase", () => {
  for (const status of ["cancelado", "devuelto", "no_entregado", "rechazado"]) {
    const journey = deliveryJourney("repository", status);
    assert.equal(journey.completedCount, 0);
    assert.equal(journey.scene, "paused");
    assert.equal(journey.inMotion, false);
    assert.equal(journey.activePhase, null);
    assert.equal(journey.exception, true);
    assert.match(journey.message, /pedido|envío|entrega|solicitud/i);
  }
  const unknown = deliveryJourney("manual", "unexpected_state");
  assert.equal(unknown.scene, "paused");
  assert.equal(unknown.inMotion, false);
  assert.equal(unknown.activePhase, null);
  assert.match(unknown.message, /revisión/i);
});
