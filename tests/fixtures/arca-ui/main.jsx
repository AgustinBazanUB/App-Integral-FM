import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import FiscalInvoiceDialog from "../../../src/gestion/fiscal/FiscalInvoiceDialog.jsx";
import { resolveArcaFiscalReceiver } from "../../../src/gestion/services/arcaService.js";
import "../../../src/styles/tokens.css";
import "../../../src/styles/theme.css";
import "../../../src/styles/management.css";
import "../../../src/styles/responsive.css";

const receiver = { vatConditionId: 5, documentType: 99, documentNumber: "0", anonymousConsumerFinal: true, concept: 1 };
async function fixture({ mode, saleTotal }) {
  if (saleTotal >= 1000) throw { category: "VALIDATION_ERROR", message: "Por el total de la venta se requiere identificar al receptor antes de continuar." };
  return { mode, receiver: mode === "consumer_final" ? receiver : { ...receiver, vatConditionId: 1, documentType: 80, documentNumber: "20123456786", anonymousConsumerFinal: false },
    review: { displayName: mode === "consumer_final" ? "Consumidor Final" : "CONTRIBUYENTE FICTICIO", cuit: mode === "cuit" ? "20123456786" : null, keyStatus: mode === "cuit" ? "ACTIVO" : null,
      fiscalAddress: null, vatCondition: { id: mode === "cuit" ? 1 : 5, description: mode === "cuit" ? "IVA Responsable Inscripto" : "Consumidor Final" } } };
}
function Preview() {
  const [open, setOpen] = useState(false); const [total, setTotal] = useState(500); const [result, setResult] = useState(""); const [live, setLive] = useState(false);
  return <main style={{padding: 24}}><h1>Etapa 2 · prueba local</h1><p>{live ? "Consulta real mediante la Function local. Requiere sesión de administrador en este mismo origen y Netlify Dev de homologación. No emite ni crea facturas." : "Datos ficticios. Sin consultas externas, credenciales ni emisión. Umbral ficticio: $1.000."}</p>
    <label><input type="checkbox" checked={live} onChange={e=>{setOpen(false);setLive(e.target.checked);}}/>Usar Function local de homologación</label><br/>
    <label>Total ficticio <input aria-label="Total ficticio" type="number" value={total} onChange={e=>setTotal(Number(e.target.value))}/></label>
    <button onClick={()=>setOpen(true)}>Abrir receptor fiscal</button><p role="status">{result}</p>
    <FiscalInvoiceDialog open={open} saleTotal={total} onClose={()=>setOpen(false)} resolveReceiver={live ? resolveArcaFiscalReceiver : fixture} onResolved={()=>setResult("Receptor revisado; no se creó factura ni CAE.")}/></main>;
}
createRoot(document.getElementById("root")).render(<Preview/>);
