import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, Panel, Skeleton, Toast } from "../../design-system";
import { Link } from "../../router";
import { can } from "../permissions";
import { groupRecordingTasks } from "../marketing/metaAds/creativeWorkspaceDomain";
import {
  driveFileOpenUrl,
  googleDriveFriendlyError,
  loadCreativeWorkspace,
  prepareCreativeWorkspace,
  selectCreativeAsset,
  uploadCreativeTake,
} from "../marketing/metaAds/googleDriveService";
import "../../styles/meta-ads-creative.css";

function durationLabel(seconds) {
  if (seconds == null) return "A definir";
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "A definir";
  if (value < 60) return `Aprox. ${Math.round(value)} ${Math.round(value) === 1 ? "segundo" : "segundos"}`;
  const minutes = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return rest ? `Aprox. ${minutes} min ${rest} s` : `Aprox. ${minutes} min`;
}

function sizeLabel(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "Tamaño no disponible";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function statusPresentation(task, upload) {
  if (upload?.busy) return { label: `Subiendo ${upload.progress || 0}%`, tone: "warning" };
  if (task.status === "ready_for_validation" && task.selectedAssetId) return { label: "Listo para validar", tone: "success" };
  if (task.status === "error") return { label: "Carga interrumpida", tone: "danger" };
  return { label: "Pendiente", tone: "neutral" };
}

function AssetList({ task, assets, busy, onSelect }) {
  if (!assets.length) return <p className="fm-field__hint">Todavía no hay tomas cargadas.</p>;
  return (
    <div className="fm-creative-takes" aria-label={`Tomas de ${task.title}`}>
      {assets.map((asset) => {
        const selected = task.selectedAssetId === asset.id;
        return (
          <article key={asset.id} className={`fm-creative-take ${selected ? "is-selected" : ""}`.trim()}>
            <div>
              <strong>Toma {asset.takeNumber}</strong>
              <span>{sizeLabel(asset.sizeBytes)} · {asset.mimeType}</span>
            </div>
            <div className="fm-creative-take__actions">
              {selected ? <Badge tone="success">Preferida</Badge> : <Button variant="secondary" disabled={busy} onClick={() => onSelect(asset.id)}>Elegir esta toma</Button>}
              <a className="fm-button fm-button--secondary" href={driveFileOpenUrl(asset.driveFileId)} target="_blank" rel="noreferrer">Abrir en Drive</a>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function TaskCard({ campaignId, task, assets, upload, disabled, maxUploadBytes, onUpload, onSelect }) {
  const fileInput = useRef(null);
  const status = statusPresentation(task, upload);
  const accept = (task.allowedMimePrefixes || []).map((prefix) => `${prefix}*`).join(",") || `${task.mediaKind || "video"}/*`;
  const actionLabel = task.mediaKind === "audio" ? "Subir audio" : task.mediaKind === "image" ? "Subir imagen" : "Subir video";

  return (
    <article className="fm-creative-task">
      <header className="fm-creative-task__head">
        <div>
          <span className="fm-creative-task__eyebrow">{task.category} {task.orderWithinCategory}</span>
          <h4>{task.title}</h4>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>

      <div className="fm-creative-task__guidance">
        <section><span>Qué decir</span><p>{task.script || "No requiere texto hablado."}</p></section>
        <section><span>Cómo hacerlo</span><p>{task.instructions || "Seguí la dirección creativa de la campaña."}</p></section>
        <section><span>Para qué sirve</span><p>{task.objective || "Cumplir esta pieza del plan creativo."}</p></section>
        <section><span>Duración ideal</span><p>{durationLabel(task.targetDurationSeconds)}</p></section>
      </div>

      {task.requirements?.length ? (
        <div className="fm-creative-requirements">
          <strong>Tené en cuenta</strong>
          <ul>{task.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
        </div>
      ) : null}

      {upload?.busy ? (
        <div className="fm-creative-upload-progress" role="status" aria-live="polite">
          <progress max="100" value={upload.progress || 0}>{upload.progress || 0}%</progress>
          <span>Subiendo directamente a Google Drive… {upload.progress || 0}%</span>
        </div>
      ) : null}
      {upload?.error ? <p className="fm-form-error" role="alert">{upload.error}</p> : null}

      <div className="fm-creative-task__actions">
        <Button icon="Upload" disabled={disabled || upload?.busy} onClick={() => fileInput.current?.click()}>{assets.length ? "Subir otra toma" : actionLabel}</Button>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          accept={accept}
          capture={task.mediaKind === "video" ? "environment" : undefined}
          disabled={disabled || upload?.busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onUpload(task, file);
          }}
        />
        <span className="fm-field__hint">Máximo {Math.round(maxUploadBytes / (1024 * 1024))} MB. La validación técnica profunda se hará en la etapa siguiente.</span>
      </div>

      <AssetList task={task} assets={assets} busy={disabled || upload?.busy} onSelect={(assetId) => onSelect(task, assetId)} />
    </article>
  );
}

export default function MetaAdsCreativeWorkspace({ profile, campaign, onCampaignRefresh }) {
  const [state, setState] = useState({ status: "idle", data: null, error: "" });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState({});
  const canView = can(profile, "marketing", "metaAdsViewCreativeWorkspace");
  const canUpload = can(profile, "marketing", "metaAdsUploadCreative");

  const load = async () => {
    if (!canView || campaign.status !== "creative") return;
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await loadCreativeWorkspace(campaign.id);
      setState({ status: "ready", data, error: "" });
    } catch (error) {
      setState({ status: "error", data: null, error: googleDriveFriendlyError(error) });
    }
  };

  useEffect(() => { load(); }, [campaign.id, campaign.status, campaign.approvedPlanRevision, profile.id, canView]);

  const data = state.data;
  const groups = useMemo(() => groupRecordingTasks(data?.tasks || []), [data?.tasks]);
  const assetsByTask = useMemo(() => {
    const map = new Map();
    for (const asset of data?.assets || []) {
      if (!map.has(asset.recordingTaskId)) map.set(asset.recordingTaskId, []);
      map.get(asset.recordingTaskId).push(asset);
    }
    return map;
  }, [data?.assets]);

  if (!canView || campaign.status !== "creative") return null;
  if (state.status === "idle" || state.status === "loading") return <Panel title="Creatividades"><Skeleton lines={8} /></Panel>;
  if (state.status === "error") {
    return (
      <Panel title="Creatividades" description="Workspace de grabación y carga de material.">
        <EmptyState icon="AlertTriangle" title="No pudimos cargar el Workspace Creativo" description={state.error} action={<Button variant="secondary" onClick={load}>Reintentar</Button>} />
      </Panel>
    );
  }

  const prepare = async () => {
    setBusy(true); setNotice("");
    try {
      const next = await prepareCreativeWorkspace(campaign.id);
      setState({ status: "ready", data: next, error: "" });
      setNotice("Las tareas de grabación quedaron preparadas a partir del plan aprobado.");
    } catch (error) { setNotice(googleDriveFriendlyError(error)); }
    finally { setBusy(false); }
  };

  const upload = async (task, file) => {
    setUploads((current) => ({ ...current, [task.id]: { busy: true, progress: 0, error: "" } }));
    try {
      await uploadCreativeTake({
        campaignId: campaign.id,
        task,
        file,
        maxUploadBytes: data.maxUploadBytes,
        onProgress: (progress) => setUploads((current) => ({ ...current, [task.id]: { busy: true, progress, error: "" } })),
      });
      setUploads((current) => ({ ...current, [task.id]: { busy: false, progress: 100, error: "" } }));
      setNotice(`${task.title}: la toma quedó cargada en Google Drive y lista para validar.`);
      await load();
      await onCampaignRefresh?.();
    } catch (error) {
      setUploads((current) => ({ ...current, [task.id]: { busy: false, progress: 0, error: googleDriveFriendlyError(error) } }));
    }
  };

  const selectTake = async (task, assetId) => {
    setBusy(true); setNotice("");
    try {
      await selectCreativeAsset(campaign.id, task.id, assetId);
      setNotice(`${task.title}: cambiaste la toma preferida sin mover ni borrar archivos.`);
      await load();
    } catch (error) { setNotice(googleDriveFriendlyError(error)); }
    finally { setBusy(false); }
  };

  const tasks = data.tasks || [];
  const drive = data.drive || {};
  return (
    <div className="fm-creative-workspace">
      {notice ? <Toast>{notice}</Toast> : null}
      <Panel
        title="4. Creatividades para grabar"
        description="Cada tarea sale del CampaignPlan aprobado. Las categorías y cantidades cambian con la metodología, no con esta pantalla."
        action={tasks.length ? <Badge tone={data.progress?.allRequiredReady ? "success" : "warning"}>{data.progress?.completed || 0} de {data.progress?.total || 0} materiales listos</Badge> : null}
      >
        {!tasks.length ? (
          <EmptyState
            icon="Video"
            title="Convertí el plan aprobado en tareas de grabación"
            description="Flor Mía va a organizar cada CreativePiece como una tarea concreta, sin volver a usar IA. Si después aprobás otra revisión del plan, se crea un nuevo conjunto y el anterior se conserva."
            action={canUpload ? <Button loading={busy} onClick={prepare}>Preparar Workspace Creativo</Button> : null}
          />
        ) : null}

        {tasks.length && !drive.connected ? (
          <div className="fm-creative-drive-warning">
            <div>
              <strong>{drive.status === "error" ? "Google Drive necesita reconectarse" : "Google Drive todavía no está conectado"}</strong>
              <p>{drive.configured ? "Las tareas ya están listas. Conectá Drive para subir las grabaciones." : "La integración necesita primero la configuración segura del OAuth de Google en Netlify."}</p>
            </div>
            <Link className="fm-button fm-button--secondary" to="/gestion/settings">Ir a Configuración</Link>
          </div>
        ) : null}

        {tasks.length && drive.connected ? (
          <div className="fm-creative-drive-ok">
            <div><span>Destino</span><strong>{drive.rootFolderName || "Meta Ads"}</strong></div>
            <div><span>Cuenta</span><strong>{drive.accountEmail || "Cuenta de Flor Mía"}</strong></div>
            <Badge tone="success">Drive conectado</Badge>
          </div>
        ) : null}
      </Panel>

      {groups.map((group) => (
        <Panel key={group.key} title={group.label} description={`${group.tasks.length} ${group.tasks.length === 1 ? "material" : "materiales"} para producir.`}>
          <div className="fm-creative-task-list">
            {group.tasks.map((task) => (
              <TaskCard
                key={task.id}
                campaignId={campaign.id}
                task={task}
                assets={assetsByTask.get(task.id) || []}
                upload={uploads[task.id]}
                disabled={!canUpload || !drive.connected || busy}
                maxUploadBytes={data.maxUploadBytes}
                onUpload={upload}
                onSelect={selectTake}
              />
            ))}
          </div>
        </Panel>
      ))}

      {tasks.length ? (
        <Panel title="Próximo paso" description="Etapa 5 sólo organiza y carga el material. Todavía no decide si técnicamente está bien grabado.">
          <div className="fm-creative-next-step">
            <Badge tone={data.progress?.allRequiredReady ? "success" : "neutral"}>{data.progress?.allRequiredReady ? "Material obligatorio completo" : "Todavía faltan materiales"}</Badge>
            <p>Cuando todas las tareas obligatorias tengan una toma elegida, el contrato queda listo para que Etapa 6 ejecute el Validation Engine. La campaña permanece en estado Creativo.</p>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
