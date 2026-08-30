import { useState } from "react";
import readXlsxFile from "read-excel-file";
import { Button, Modal, Toast } from "../../design-system";
import { formatPhoneForDisplay } from "./customerDomain";
import {
  markExistingImportedCustomers,
  parseFlorMiaContactImport,
} from "./customerImport";
import {
  findCustomerByPhone,
  saveCustomerFromAdmin,
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
      const rows = await readXlsxFile(file);
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
    const pending = parsed.rows.filter((row) => !row.existingCustomer);
    if (!pending.length) return;
    setBusy(true);
    setError("");
    setProgress({ completed: 0, total: pending.length, created: 0, skipped: 0 });
    let created = 0;
    let skipped = 0;
    try {
      for (let index = 0; index < pending.length; index += 1) {
        const row = pending[index];
        const existing = await findCustomerByPhone(row.phone);
        if (existing) {
          skipped += 1;
        } else {
          await saveCustomerFromAdmin(profile, {
            phone: row.phone,
            name: row.name,
            zoneId: row.zoneId,
            zoneName: row.zoneName,
            customZone: row.customZone,
          });
          created += 1;
        }
        setProgress({ completed: index + 1, total: pending.length, created, skipped });
      }
      await onImported?.({ created, skipped, invalid: parsed.summary?.invalid || 0 });
      reset();
      onClose?.();
    } catch (cause) {
      setError(cause?.message || "La importación se interrumpió.");
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <div className="fm-dialog-actions">
      <Button variant="secondary" disabled={busy} onClick={close}>Cerrar</Button>
      <Button
        loading={busy && Boolean(parsed.summary)}
        disabled={!parsed.summary || parsed.summary.readyToImport === 0 || busy}
        onClick={confirmImport}
      >
        Importar {parsed.summary?.readyToImport || 0} cliente(s)
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title="Agregar Clientes"
      description="Cargá el Excel generado por Flor Mía WhatsApp Sender con las columnas Telefono, Nombre y Apellido y Zona."
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
                      <td>{row.existingCustomer ? "Ya existe · no se importará" : "Listo"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <small>Vista previa de hasta 20 clientes válidos. Los existentes se omiten; nunca se duplican ni se pisan desde esta importación.</small>
            </div>

            {parsed.invalidRows.length ? (
              <div className="fm-customer-import__errors" role="alert">
                <strong>Filas que no se importarán:</strong>
                <ul>{parsed.invalidRows.slice(0, 20).map((row) => <li key={row.row}>Fila {row.row}: {row.errors.join(" · ")}</li>)}</ul>
              </div>
            ) : null}
          </>
        ) : null}

        {progress ? (
          <p aria-live="polite">
            Importando {progress.completed} / {progress.total} · creados {progress.created} · omitidos {progress.skipped}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
