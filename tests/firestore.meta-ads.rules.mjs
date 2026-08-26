import test, { after, before } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

let environment;

const project = (userId, name = "Campaña Meta") => ({
  name,
  channel: "meta_ads",
  status: "draft",
  schemaVersion: 1,
  productId: null,
  productNameSnapshot: null,
  archived: false,
  createdBy: userId,
  createdByName: userId,
  createdAt: new Date(),
  updatedBy: userId,
  updatedByName: userId,
  updatedAt: new Date(),
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-flor-mia-meta-ads",
    firestore: {
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users", "admin-meta"), { name: "Admin", role: "admin", active: true }),
      setDoc(doc(db, "users", "marketing-meta"), { name: "Marketing", role: "marketing_manager", active: true }),
      setDoc(doc(db, "users", "seller-meta"), { name: "Seller", role: "seller", active: true }),
      setDoc(doc(db, "users", "inactive-meta"), { name: "Inactivo", role: "marketing_manager", active: false }),
      setDoc(doc(db, "users", "ecommerce-meta"), { name: "Ecommerce", role: "ecommerce_manager", active: true }),
      setDoc(doc(db, "users", "explicit-meta"), {
        name: "Explícito",
        role: "ecommerce_manager",
        active: true,
        permissions: { marketing: ["metaAdsView", "metaAdsCreateProject", "metaAdsEditProject", "metaAdsArchiveProject"] },
      }),
      setDoc(doc(db, "users", "denied-meta"), {
        name: "Marketing restringido",
        role: "marketing_manager",
        active: true,
        permissionDeny: { marketing: ["metaAdsEditProject"] },
      }),
    ]);
  });
});

after(async () => {
  await environment?.cleanup();
});

test("admin puede crear, leer y editar CampaignProject", async () => {
  const db = environment.authenticatedContext("admin-meta").firestore();
  const ref = doc(db, "metaCampaignProjects", "admin-project");
  await assertSucceeds(setDoc(ref, project("admin-meta")));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(collection(db, "metaCampaignProjects")));
  await assertSucceeds(updateDoc(ref, {
    name: "Campaña editada",
    updatedBy: "admin-meta",
    updatedByName: "Admin",
    updatedAt: new Date(),
  }));
});

test("marketing_manager puede operar el contrato de Etapa 2", async () => {
  const db = environment.authenticatedContext("marketing-meta").firestore();
  const ref = doc(db, "metaCampaignProjects", "marketing-project");
  await assertSucceeds(setDoc(ref, project("marketing-meta")));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(updateDoc(ref, {
    productId: "product-1",
    productNameSnapshot: "Producto 1",
    updatedBy: "marketing-meta",
    updatedByName: "Marketing",
    updatedAt: new Date(),
  }));
  await assertSucceeds(updateDoc(ref, {
    status: "archived",
    archived: true,
    archivedAt: new Date(),
    archivedBy: "marketing-meta",
    archivedByName: "Marketing",
    updatedBy: "marketing-meta",
    updatedByName: "Marketing",
    updatedAt: new Date(),
  }));
});

test("permiso explícito de Meta Ads funciona sin cambiar el rol", async () => {
  const db = environment.authenticatedContext("explicit-meta").firestore();
  const ref = doc(db, "metaCampaignProjects", "explicit-project");
  await assertSucceeds(setDoc(ref, project("explicit-meta")));
  await assertSucceeds(getDoc(ref));
});

test("seller, perfil sin Marketing e inactivo no acceden", async () => {
  const adminDb = environment.authenticatedContext("admin-meta").firestore();
  await assertSucceeds(setDoc(doc(adminDb, "metaCampaignProjects", "protected-project"), project("admin-meta")));
  for (const userId of ["seller-meta", "ecommerce-meta", "inactive-meta"]) {
    const db = environment.authenticatedContext(userId).firestore();
    await assertFails(getDoc(doc(db, "metaCampaignProjects", "protected-project")));
    await assertFails(setDoc(doc(db, "metaCampaignProjects", `${userId}-project`), project(userId)));
  }
});

test("payload inválido, estado inválido y campo peligroso se rechazan", async () => {
  const db = environment.authenticatedContext("marketing-meta").firestore();
  await assertFails(setDoc(doc(db, "metaCampaignProjects", "bad-status"), {
    ...project("marketing-meta"),
    status: "inventado",
  }));
  await assertFails(setDoc(doc(db, "metaCampaignProjects", "bad-secret"), {
    ...project("marketing-meta"),
    metaAccessToken: "secret",
  }));
  await assertFails(setDoc(doc(db, "metaCampaignProjects", "bad-product"), {
    ...project("marketing-meta"),
    productId: "product-1",
    productNameSnapshot: null,
  }));
});

test("ownership y schemaVersion permanecen protegidos", async () => {
  const db = environment.authenticatedContext("marketing-meta").firestore();
  const ref = doc(db, "metaCampaignProjects", "ownership-project");
  await assertSucceeds(setDoc(ref, project("marketing-meta")));
  await assertFails(updateDoc(ref, { createdBy: "otro", updatedAt: new Date() }));
  await assertFails(updateDoc(ref, { schemaVersion: 2, updatedAt: new Date() }));
  await assertFails(updateDoc(ref, { status: "active", updatedAt: new Date() }));
});

test("permissionDeny prevalece sobre el rol para edición", async () => {
  const adminDb = environment.authenticatedContext("admin-meta").firestore();
  await assertSucceeds(setDoc(doc(adminDb, "metaCampaignProjects", "denied-project"), project("admin-meta")));
  const db = environment.authenticatedContext("denied-meta").firestore();
  await assertSucceeds(getDoc(doc(db, "metaCampaignProjects", "denied-project")));
  await assertFails(updateDoc(doc(db, "metaCampaignProjects", "denied-project"), {
    name: "No debería guardar",
    updatedBy: "denied-meta",
    updatedByName: "Marketing restringido",
    updatedAt: new Date(),
  }));
});
