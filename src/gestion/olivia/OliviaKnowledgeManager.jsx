import { useEffect, useRef, useState } from "react";
import { Button, Panel, Modal } from "../../design-system";
import { oliviaClient } from "./service";
import { requestId } from "./client.mjs";
export default function OliviaKnowledgeManager() {
  const [documents, setDocuments] = useState([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(null), [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null), [module, setModule] = useState("locations"), [audience, setAudience] = useState("admin"), [review, setReview] = useState(null);
  const request = useRef(null), mounted = useRef(true);
  const load = async (more = false) => {
    if (loading) return;
    setLoading(true);
    const controller = new AbortController(); request.current = controller;
    try { const result = await oliviaClient.knowledge({ operation: "list", cursor: more ? cursor : null }, { signal: controller.signal }); if (mounted.current) { setDocuments((current) => more ? [...current, ...result.documents] : result.documents); setCursor(result.nextCursor); } }
    catch (failure) { if (mounted.current && failure.name !== "AbortError") setError(failure.message); }
    finally { if (mounted.current) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const confirm = async () => {
    if (busy || !review) return;
    setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      if (review.kind === "publish") await oliviaClient.publishKnowledge(review.file, { module: review.module, audience: review.audience, confirmed: true, requestId: review.requestId }, { signal: controller.signal });
      else await oliviaClient.knowledge({ operation: "remove", id: review.id, confirmed: true, requestId: review.requestId }, { signal: controller.signal });
      if (!mounted.current) return;
      setReview(null); setFile(null); await load();
    } catch (failure) { if (mounted.current && failure.name !== "AbortError") setError(failure.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <Panel title="Conocimiento permanente de Olivia">
    <p>Publicá procedimientos oficiales. Los adjuntos del chat se usan solo en esa conversación. La biblioteca aporta información; los permisos y confirmaciones siguen en el backend.</p>
    <label>Documento <input type="file" accept=".pdf,.docx,.txt" disabled={busy} onChange={(event) => setFile(event.target.files[0] || null)} /></label>
    <label>Audiencia <select value={audience} disabled={busy} onChange={(event) => { setAudience(event.target.value); setModule(event.target.value === "seller" ? "seller" : "locations"); }}><option value="admin">Administrador con permiso del módulo</option><option value="seller">Ayuda del Panel Vendedor</option></select></label>
    {audience === "admin" ? <label>Módulo <select value={module} disabled={busy} onChange={(event) => setModule(event.target.value)}>{["locations", "products", "quick-sales", "loyal-customers", "metrics", "finance", "warehouse", "ecommerce", "shipping", "alerts", "suppliers", "marketing", "social", "ai"].map((id) => <option key={id} value={id}>{id}</option>)}</select></label> : null}
    <Button disabled={!file || busy} onClick={() => setReview({ kind: "publish", file, module, audience, name: file.name, requestId: requestId() })}>Revisar publicación</Button>
    <Button variant="secondary" disabled={busy || loading} onClick={() => load()}>Actualizar biblioteca</Button>
    {cursor ? <Button variant="secondary" disabled={busy || loading} onClick={() => load(true)}>Cargar más documentos</Button> : null}
    {documents.length ? <ul>{documents.map((doc) => <li key={doc.id}><strong>{doc.name}</strong> · {doc.module} · {doc.audience} · {doc.active ? doc.status === "completed" ? "Disponible" : doc.status === "failed" ? "Error de indexación" : "Indexando…" : "Retirado"} {doc.active || doc.deletionPending ? <Button variant="secondary" disabled={busy} onClick={() => setReview({ kind: "remove", id: doc.id, name: doc.name, requestId: requestId() })}>{doc.deletionPending ? "Reintentar limpieza" : "Retirar"}</Button> : null}</li>)}</ul> : <p>No hay documentos publicados.</p>}
    <p>El almacenamiento semántico puede generar cargos de OpenAI. Su importe no se calcula sin medición del proveedor.</p>
    {error ? <p role="alert">{error}</p> : null}
    <Modal open={Boolean(review)} title={review?.kind === "publish" ? "Publicar conocimiento permanente" : "Retirar documento"} onClose={() => { if (!busy) setReview(null); }} footer={<><Button variant="secondary" disabled={busy} onClick={() => setReview(null)}>Cancelar</Button><Button loading={busy} onClick={confirm}>Confirmar</Button></>}><p>{review?.name}</p>{review?.kind === "publish" ? <p>Audiencia: {review.audience}. Módulo: {review.module}. El contenido se incorpora a la biblioteca hasta que un Administrador lo retire.</p> : <p>Olivia dejará de recuperar este contenido.</p>}{error ? <p role="alert">{error}</p> : null}</Modal>
  </Panel>;
}
