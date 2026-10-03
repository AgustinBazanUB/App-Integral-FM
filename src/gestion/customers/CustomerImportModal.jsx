import { useState } from "react";
import { readSheet } from "read-excel-file/browser";
import { Button, Modal, Toast } from "../../design-system";
import { formatPhoneForDisplay } from "./customerDomain";
import {
  markExistingImportedCustomers,
  parseFlorMiaContactImport,
} from "./customerImport";
import {
  findCustomerByPhone,
  mergeCustomerFromAdmin,
} from "../services/customerService";

const emptyImport = {
  fileName: "",
  rows: [],
  invalidRows: [],
  summary: null,
};

export default function CustomerImportModal({ open, onClose, profile, zones, onImported }) {
  const [parsed, setParsed] = useState(emptyImport);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);

  const reset = () => {
    setParsed(emptyImport);
    setError("");
    setProgress(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose?.();
  };

  const chooseFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress(null);
    try {
      const rows = await readSheet(file);
      const initial = parseFlorMiaContactImport(rows, zones);
      const withExisting = await markExistingImportedCustomers(initial, findCustomerByPhone, 8);
      setParsed({ ...withExisting, fileName: file.name });
    } catch (cause) {
      setParsed(emptyImport);
      setError(cause?.message || "No se pudo leer el Excel.");
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    const pending = parsed.rows;
    if (!pending.length) return;
    setBusy(true); setError("");
    let created = 0; let updated = 0; let skipped = 0;
    const conflicts = pending.flatMap(row => (row.importConflicts || []).map(conflict => ({ ...conflict, phone: row.phone })));
    const failures = [];
    try {
      for (let index = 0; index < pending.length; index += 1) {
        const row = pending[index];
        try {
          const result = await mergeCustomerFromAdmin(profile, row);
          if (result.created) created++;
          else if (result.updated) updated++;
          else skipped++;
          conflicts.push(...result.conflicts.map(conflict => ({ ...conflict, phone: row.phone })));
        } catch (cause) { failures.push(`Fila ${row.sourceRows.join(", ")}: ${cause.message}`); }
        setProgress({ completed: index + 1, total: pending.length, created, updated, skipped, conflicts: conflicts.length });
      }
      await onImported?.({ created, updated, skipped, conflicts: conflicts.length, invalid: parsed.summary?.invalid || 0 });
      if (failures.length) setError(`Importación parcial. ${failures.join(" · ")}`);
      else {
        setParsed(current => ({ ...current, summary: { ...current.summary, readyToImport: 0, conflicts: conflicts.length }, resultConflicts: conflicts }));
      }
    } catch (cause) { setError(cause?.message || "No se pudo actualizar el resumen de importación."); }
    finally { setBusy(false); }
  };

  const visibleConflicts = parsed.resultConflicts || (parsed.rows || []).flatMap(row => [...(row.importConflicts || []), ...(row.enrichment?.conflicts || [])].map(conflict => ({ ...conflict, phone: row.phone })));
  const footer = (
    <div className="fm-dialog-actions">
      <Button variant="secondary" disabled={busy} onClick={close}>Cerrar</Button>
      <Button
        loading={busy && Boolean(parsed.summary)}
        disabled={!parsed.summary || parsed.summary.readyToImport === 0 || busy}
        onClick={confirmImport}
      >
        Procesar {parsed.summary?.readyToImport || 0} cliente(s)
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title="Agregar Clientes"
      description="Cargá el Excel generado por Flor Mía WhatsApp Sender con las columnas Telefono, Nombre y Apellido y Zona. Sólo Telefono es obligatoria."
      footer={footer}
    >
      <div className="fm-customer-import">
        <div className="fm-customer-import__guide">
          <strong>Cómo generar el archivo</strong>
          <span>En Flor Mía WhatsApp Sender abrí Contactos, elegí la etiqueta, analizá los contactos y exportá el Excel. Después seleccioná ese archivo .xlsx acá.</span>
        </div>

        <label className="fm-customer-import__file">
          <span>Seleccionar archivo .xlsx</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }}
          />
        </label>

        {error ? <Toast tone="error">{error}</Toast> : null}
        {busy && !parsed.summary ? <p>Analizando archivo y comprobando clientes existentes…</p> : null}

        {parsed.summary ? (
          <>
            <p><strong>{parsed.fileName}</strong></p>
            <div className="fm-customer-import__summary">
              <span><b>{parsed.summary.total}</b>Total</span>
              <span><b>{parsed.summary.valid}</b>Válidos únicos</span>
              <span><b>{parsed.summary.duplicates}</b>Duplicados en archivo</span>
              <span><b>{parsed.summary.existing}</b>Ya existentes</span>
              <span><b>{parsed.summary.invalid}</b>Inválidos</span>
              <span><b>{parsed.summary.conflicts || 0}</b>Conflictos para revisar</span>
              <span><b>{parsed.summary.readyToImport}</b>Listos para importar</span>
            </div>

            <div className="fm-customer-import__preview" aria-label="Vista previa de clientes a importar">
              <table>
                <thead><tr><th>Telefono</th><th>Nombre y Apellido</th><th>Zona</th><th>Resultado</th></tr></thead>
                <tbody>
                  {parsed.rows.slice(0, 20).map((row) => (
                    <tr key={`${row.phoneNormalized}-${row.sourceRows.join("-")}`}>
                      <td>{row.phone.startsWith("+") ? row.phone : formatPhoneForDisplay(row.phone)}</td>
                      <td>{row.name || "—"}</td>
                      <td>{row.zone}</td>
                      <td>{row.existingCustomer ? Object.keys(row.enrichment?.patch || {}).length ? "Completar campos vacíos" : "Ya existe · conservar datos" : "Nuevo"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <small>Vista previa de hasta 20 clientes válidos. Sólo se completan campos vacíos. Los valores distintos se informan y conservan para una edición explícita.</small>
            </div>

            {parsed.invalidRows.length ? (
              <div className="fm-customer-import__errors" role="alert">
                <strong>Filas que no se importarán:</strong>
                <ul>{parsed.invalidRows.slice(0, 20).map((row) => <li key={row.row}>Fila {row.row}: {row.errors.join(" · ")}</li>)}</ul>
              </div>
            ) : null}
          </>
        ) : null}

        {visibleConflicts.length ? <div className="fm-customer-import__errors"><strong>Conflictos de datos (sin reemplazo automático)</strong><ul>{visibleConflicts.slice(0, 30).map((conflict, index) => <li key={index}>{formatPhoneForDisplay(conflict.phone)} · {conflict.field}: «{conflict.existing}» / archivo «{conflict.incoming}»</li>)}</ul></div> : null}
        {progress ? (
          <p aria-live="polite">
            Importando {progress.completed} / {progress.total} · creados {progress.created} · completados {progress.updated || 0} · omitidos {progress.skipped} · conflictos {progress.conflicts || 0}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
