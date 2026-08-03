import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  Skeleton,
} from "../../design-system";
import { formatDateTime } from "../formatters";
import { useAsyncData } from "../hooks";
import { listAuditLogs } from "../services/managementService";

export default function AuditPage() {
  const result = useAsyncData(() => listAuditLogs(), []);
  return (
    <div className="fm-page-enter">
      <PageHeader eyebrow="Capa transversal" title="Auditoría" description="Operaciones sensibles, usuario, fecha y entidad relacionada, sin borrar el historial." />
      <Panel title="Registro reciente" description="La consulta está limitada a los 50 eventos más nuevos.">
        {result.status === "loading" ? <Skeleton lines={6} /> : null}
        {result.status === "error" ? <EmptyState icon="ShieldCheck" title="No se pudo consultar la auditoría" description="Revisá que el perfil tenga permisos de administración y que la colección esté disponible en App Integral FM." action={<Button variant="secondary" onClick={result.refresh}>Reintentar</Button>} /> : null}
        {result.status === "ready" ? <DataTable rows={result.data} columns={[
          { key: "action", label: "Acción", render: (log) => <Badge tone="neutral">{log.action || "Operación"}</Badge> },
          { key: "entity", label: "Entidad", render: (log) => log.entityType || log.moduleId || "Sistema" },
          { key: "user", label: "Usuario", render: (log) => log.userName || log.userEmail || "Sistema" },
          { key: "createdAt", label: "Fecha", render: (log) => formatDateTime(log.createdAt) },
        ]} empty={<EmptyState icon="ScrollText" title="Sin eventos de auditoría" description="Los eventos aparecerán cuando se active la nueva colección." />} /> : null}
      </Panel>
    </div>
  );
}

