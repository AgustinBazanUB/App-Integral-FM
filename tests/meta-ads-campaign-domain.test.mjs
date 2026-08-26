import test from "node:test";
import assert from "node:assert/strict";
import {
  META_ADS_CAMPAIGN_SCHEMA_VERSION,
  campaignProjectEditablePatch,
  canTransitionMetaAdsCampaignStatus,
  isMetaAdsCampaignStatus,
  normalizeCampaignProjectInput,
} from "../src/gestion/marketing/metaAds/campaignProjectDomain.js";

test("CampaignProject fija schemaVersion inicial", () => {
  assert.equal(META_ADS_CAMPAIGN_SCHEMA_VERSION, 1);
});

test("normaliza nombre y producto opcional", () => {
  assert.deepEqual(normalizeCampaignProjectInput({ name: "  Lanzamiento Arauco  " }), {
    name: "Lanzamiento Arauco",
    productId: null,
    productNameSnapshot: null,
  });
  assert.deepEqual(campaignProjectEditablePatch({
    name: "Arauco",
    productId: "oil-arauco",
    productNameSnapshot: "AOVE Arauco 500 ml",
  }), {
    name: "Arauco",
    productId: "oil-arauco",
    productNameSnapshot: "AOVE Arauco 500 ml",
  });
});

test("rechaza campos obligatorios e identidad de producto incompleta", () => {
  assert.throws(() => normalizeCampaignProjectInput({ name: " " }), /nombre/i);
  assert.throws(() => normalizeCampaignProjectInput({ name: "Campaña", productId: "p1" }), /producto/i);
});

test("estados y transiciones viven en dominio", () => {
  assert.equal(isMetaAdsCampaignStatus("draft"), true);
  assert.equal(isMetaAdsCampaignStatus("inventado"), false);
  assert.equal(canTransitionMetaAdsCampaignStatus("draft", "planning"), true);
  assert.equal(canTransitionMetaAdsCampaignStatus("draft", "active"), false);
  assert.equal(canTransitionMetaAdsCampaignStatus("draft", "archived"), true);
  assert.equal(canTransitionMetaAdsCampaignStatus("archived", "draft"), false);
});
