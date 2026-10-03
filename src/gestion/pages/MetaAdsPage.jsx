import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  ConfirmationDialog,
  DataTable,
  EmptyState,
  FormField,
  Modal,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  Toast,
} from "../../design-system";
import { Link } from "../../router";
import "../../styles/meta-ads.css";
import { useAuth } from "../AuthContext";
import { formatDateTime } from "../formatters";
import { useAsyncData } from "../hooks";
import MetaAdsCampaignPlanningWorkspace from "./MetaAdsCampaignPlanningWorkspace";
import MetaAdsCreativeWorkspace from "./MetaAdsCreativeWorkspace";
import {
  metaAdsStatusLabel,
  metaAdsStatusTone,
} from "../marketing/metaAds/campaignProjectDomain";
import {
  archiveMetaAdsCampaignProject,
  createMetaAdsCampaignProject,
  getMetaAdsCampaignProject,
  listMetaAdsCampaignProjects,
  metaAdsFriendlyError,
  updateMetaAdsCampaignProject,
} from "../marketing/metaAds/campaignProjectService";
import { can } from "../permissions";
import { listMasterProductsShared } from "../services/sharedResources";

const phases = [
  "Validación",
  "Producción",
  "Meta Ads",
  "Resultados",
];

function selectedProduct(products, productId) {
  return (products || []).find((product) => product.id === productId) || null;
}

function productLabel(project, products) {
  if (!project.productId) return "Sin producto asignado";
  return selectedProduct(products, project.productId)?.name || project.productNameSnapshot || "Producto no disponible";
}

function CampaignForm({ value, onChange, products, productsLoading, disabled }) {
  return (
    <div className="fm-form-grid">
      <FormField label="Nombre" required className="fm-form-grid__full">
        <input
          value={value.name}
          maxLength="120"
          disabled={disabled}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </FormField>
      <FormField
        label="Producto"
        hint={productsLoading ? "Cargando catálogo maestro…" : "Opcional. Usa el catálogo existente de Flor Mía."}
        className="fm-form-grid__full"
      >
        <Select
          value={value.productId}
          disabled={disabled || productsLoading}
          onChange={(event) => onChange({ ...value, productId: event.target.value })}
        >
          <option value="">Sin producto asignado</option>
          {(products || []).map((product) => (
            <option key={product.id} value={product.id}>{product.name}</option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}

function MetaAdsCampaignList({ profile }) {
  const productsResult = useAsyncData(() => listMasterProductsShared(profile), [profile.id]);
  const [state, setState] = useState({ status: "loading", items: [], cursor: null, hasMore: false, error: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadMoreBusy, setLoadMoreBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", productId: "" });
  const [createState, setCreateState] = useState({ busy: false, error: "" });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading", error: null }));
    listMetaAdsCampaignProjects(profile)
      .then((page) => {
        if (!cancelled) setState({ status: "ready", items: page.items, cursor: page.cursor, hasMore: page.hasMore, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", items: [], cursor: null, hasMore: false, error });
      });
    return () => { cancelled = true; };
  }, [profile.id, refreshKey]);

  const products = productsResult.data || [];
  const canCreate = can(profile, "marketing", "metaAdsCreateProject");

  const handleCreate = async (event) => {
    event.preventDefault();
    setCreateState({ busy: true, error: "" });
    try {
      const product = selectedProduct(products, createForm.productId);
      await createMetaAdsCampaignProject(profile, {
        name: createForm.name,
        productId: product?.id || null,
        productNameSnapshot: product?.name || null,
      });
      setCreateOpen(false);
      setCreateForm({ name: "", productId: "" });
      setNotice("La campaña quedó guardada como borrador.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setCreateState({ busy: false, error: metaAdsFriendlyError(error) });
    }
  };

  const handleLoadMore = async () => {
    if (!state.hasMore || !state.cursor || loadMoreBusy) return;
    setLoadMoreBusy(true);
    try {
      const page = await listMetaAdsCampaignProjects(profile, { cursor: state.cursor });
      setState((current) => ({
        status: "ready",
        items: [...current.items, ...page.items],
        cursor: page.cursor,
        hasMore: page.hasMore,
        error: null,
      }));
    } catch (error) {
      setNotice(metaAdsFriendlyError(error));
    } finally {
      setLoadMoreBusy(false);
    }
  };

  return (
    <div className="fm-page-enter fm-meta-ads-page">
      <PageHeader
        eyebrow="Marketing"
        title="Meta Ads"
        description="Proyectos internos para preparar campañas publicitarias sin confundirlos todavía con Campaigns reales de Meta."
        actions={canCreate ? <Button icon="Plus" onClick={() => { setCreateState({ busy: false, error: "" }); setCreateOpen(true); }}>Nueva campaña</Button> : null}
      />

      {notice ? <div className="fm-meta-ads-notice"><Toast>{notice}</Toast></div> : null}

      <Panel title="Campañas" description="Listado paginado de CampaignProjects guardados en Firestore.">
        {state.status === "loading" ? <Skeleton lines={6} /> : null}
        {state.status === "error" ? (
          <EmptyState
            icon="AlertTriangle"
            title="No pudimos cargar Meta Ads"
            description={metaAdsFriendlyError(state.error)}
            action={<Button variant="secondary" onClick={() => setRefreshKey((value) => value + 1)}>Reintentar</Button>}
          />
        ) : null}
        {state.status === "ready" ? (
          <>
            <DataTable
              rows={state.items}
              columns={[
                { key: "name", label: "Campaña" },
                { key: "product", label: "Producto", render: (project) => productLabel(project, products) },
                { key: "status", label: "Estado", render: (project) => <Badge tone={metaAdsStatusTone(project.status)}>{metaAdsStatusLabel(project.status)}</Badge> },
                { key: "updatedAt", label: "Actualización", render: (project) => formatDateTime(project.updatedAt || project.createdAt) },
                { key: "createdByName", label: "Creador", render: (project) => project.createdByName || "Usuario" },
                { key: "open", label: "", render: (project) => <Link className="fm-button fm-button--secondary" to={`/gestion/marketing/meta-ads/${encodeURIComponent(project.id)}`}>Abrir</Link> },
              ]}
              empty={<EmptyState icon="Megaphone" title="Todavía no existen campañas Meta Ads" description="Creá un CampaignProject para empezar. No se generan campañas de ejemplo ni datos ficticios." />}
            />
            {state.hasMore ? <div className="fm-meta-ads-list-actions"><Button variant="secondary" loading={loadMoreBusy} onClick={handleLoadMore}>Cargar más</Button></div> : null}
          </>
        ) : null}
      </Panel>

      <Panel title="Integración con Meta" description="La conexión real con Meta Marketing API no forma parte de esta etapa.">
        <EmptyState icon="Megaphone" title="Meta todavía no está conectado" description="La autenticación y publicación reales se habilitarán en una etapa posterior, después de validar permisos y tokens con la cuenta real de Flor Mía." />
      </Panel>

      <Modal
        open={createOpen}
        onClose={() => !createState.busy && setCreateOpen(false)}
        title="Nueva campaña"
        description="Crea un CampaignProject interno en estado borrador."
      >
        <form onSubmit={handleCreate}>
          <CampaignForm
            value={createForm}
            onChange={setCreateForm}
            products={products}
            productsLoading={productsResult.status === "loading"}
            disabled={createState.busy}
          />
          {productsResult.status === "error" ? <p className="fm-field__hint">El catálogo no pudo cargarse; podés crear la campaña sin producto.</p> : null}
          {createState.error ? <p className="fm-form-error" role="alert">{createState.error}</p> : null}
          <div className="fm-dialog-actions">
            <Button variant="secondary" disabled={createState.busy} onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={createState.busy}>Guardar campaña</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function MetaAdsCampaignDetail({ profile, campaignId }) {
  const projectResult = useAsyncData(() => getMetaAdsCampaignProject(profile, campaignId), [profile.id, campaignId]);
  const productsResult = useAsyncData(() => listMasterProductsShared(profile), [profile.id]);
  const [form, setForm] = useState({ name: "", productId: "" });
  const [saveState, setSaveState] = useState({ busy: false, error: "" });
  const [notice, setNotice] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const project = projectResult.data;
  const products = productsResult.data || [];

  useEffect(() => {
    if (project) setForm({ name: project.name || "", productId: project.productId || "" });
  }, [project?.id, project?.name, project?.productId]);

  const product = useMemo(() => selectedProduct(products, form.productId), [products, form.productId]);
  const editable = project?.status === "draft" && project?.archived !== true && can(profile, "marketing", "metaAdsEditProject");
  const archiveAllowed = project?.status === "draft" && project?.archived !== true && can(profile, "marketing", "metaAdsArchiveProject");

  const handleSave = async (event) => {
    event.preventDefault();
    if (!project) return;
    setSaveState({ busy: true, error: "" });
    try {
      const productId = form.productId || null;
      const productNameSnapshot = product?.name
        || (productId && productId === project.productId ? project.productNameSnapshot : null);
      await updateMetaAdsCampaignProject(profile, project, {
        name: form.name,
        productId,
        productNameSnapshot,
      });
      setNotice("Los cambios quedaron guardados.");
      setSaveState({ busy: false, error: "" });
      await projectResult.refresh();
    } catch (error) {
      setSaveState({ busy: false, error: metaAdsFriendlyError(error) });
    }
  };

  const handleArchive = async () => {
    if (!project) return;
    setArchiveBusy(true);
    try {
      await archiveMetaAdsCampaignProject(profile, project);
      setArchiveOpen(false);
      setNotice("La campaña fue archivada y su historial se conserva.");
      await projectResult.refresh();
    } catch (error) {
      setNotice(metaAdsFriendlyError(error));
    } finally {
      setArchiveBusy(false);
    }
  };

  if (projectResult.status === "loading") {
    return <div className="fm-page-enter fm-meta-ads-page"><Skeleton lines={8} /></div>;
  }
  if (projectResult.status === "error") {
    return (
      <div className="fm-page-enter fm-meta-ads-page">
        <PageHeader eyebrow="Marketing → Meta Ads" title="Campaña no disponible" actions={<Link className="fm-button fm-button--secondary" to="/gestion/marketing/meta-ads">Volver</Link>} />
        <Panel><EmptyState icon="AlertTriangle" title="No pudimos abrir esta campaña" description={metaAdsFriendlyError(projectResult.error)} action={<Button variant="secondary" onClick={projectResult.refresh}>Reintentar</Button>} /></Panel>
      </div>
    );
  }

  return (
    <div className="fm-page-enter fm-meta-ads-page">
      <PageHeader
        eyebrow="Marketing → Meta Ads"
        title={project.name}
        description="CampaignProject interno de Flor Mía. La planificación guiada ya puede convertir contexto + metodología + tus respuestas en un plan de campaña."
        actions={<Link className="fm-button fm-button--secondary" to="/gestion/marketing/meta-ads">Volver a campañas</Link>}
      />

      {notice ? <Toast>{notice}</Toast> : null}

      <Panel title="Datos del proyecto" action={<Badge tone={metaAdsStatusTone(project.status)}>{metaAdsStatusLabel(project.status)}</Badge>}>
        <dl className="fm-meta-ads-detail-grid">
          <div><dt>Producto</dt><dd>{productLabel(project, products)}</dd></div>
          <div><dt>Creador</dt><dd>{project.createdByName || "Usuario"}</dd></div>
          <div><dt>Creada</dt><dd>{formatDateTime(project.createdAt)}</dd></div>
          <div><dt>Actualizada</dt><dd>{formatDateTime(project.updatedAt || project.createdAt)}</dd></div>
          <div><dt>ID interno</dt><dd>{project.id}</dd></div>
          <div><dt>Schema</dt><dd>v{project.schemaVersion}</dd></div>
        </dl>
      </Panel>

      <Panel title="Edición" description={editable ? "Podés editar nombre y producto mientras la campaña está en borrador." : "Una vez iniciada la planificación, los datos base quedan en modo lectura."}>
        <form onSubmit={handleSave}>
          <CampaignForm
            value={form}
            onChange={setForm}
            products={products}
            productsLoading={productsResult.status === "loading"}
            disabled={!editable || saveState.busy}
          />
          {saveState.error ? <p className="fm-form-error" role="alert">{saveState.error}</p> : null}
          <div className="fm-meta-ads-detail-actions">
            {editable ? <Button type="submit" loading={saveState.busy}>Guardar cambios</Button> : null}
            {archiveAllowed ? <Button variant="secondary" type="button" onClick={() => setArchiveOpen(true)}>Archivar campaña</Button> : null}
          </div>
        </form>
      </Panel>

      <MetaAdsCampaignPlanningWorkspace profile={profile} campaign={project} onCampaignRefresh={projectResult.refresh} />
      <MetaAdsCreativeWorkspace profile={profile} campaign={project} onCampaignRefresh={projectResult.refresh} />

      <Panel title="Siguientes etapas" description="Después de grabar y cargar el material, validación, render y publicación continúan en etapas posteriores.">
        <div className="fm-meta-ads-phases">
          {phases.map((phase, index) => (
            <article key={phase} className="fm-meta-ads-phase">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{phase}</strong>
              <small>Próximamente</small>
            </article>
          ))}
        </div>
      </Panel>

      <ConfirmationDialog
        open={archiveOpen}
        title="Archivar campaña"
        description="La campaña dejará de ser editable en esta etapa, pero no se borrará físicamente y conservará su historial."
        busy={archiveBusy}
        onClose={() => !archiveBusy && setArchiveOpen(false)}
        onConfirm={handleArchive}
      />
    </div>
  );
}

export default function MetaAdsPage({ campaignId = null }) {
  const { profile } = useAuth();
  return campaignId
    ? <MetaAdsCampaignDetail profile={profile} campaignId={campaignId} />
    : <MetaAdsCampaignList profile={profile} />;
}
