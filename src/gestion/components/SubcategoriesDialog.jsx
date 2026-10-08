import { useState } from "react";
import { Button, FormField, Modal, Select, Toast } from "../../design-system";
import { categorySubcategories } from "../../shared/productSubcategories.mjs";
import { createProductSubcategory, organizeExistingCatalog } from "../services/catalogOrganizationService";

export default function SubcategoriesDialog({ open, onClose, categories, profile, onSaved }) {
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState({ busy: false, error: "", message: "" });
  const category = categories.find(row => row.id === categoryId);
  async function run(work) {
    setState({ busy: true, error: "", message: "" });
    try { const message = await work(); await onSaved(); setState({ busy: false, error: "", message }); }
    catch (error) { setState({ busy: false, error: error.message, message: "" }); }
  }
  return <Modal open={open} title="Subcategorías" description="Al abrir una categoría, sus subcategorías quedan visibles. Cada producto conserva su categoría principal." onClose={() => !state.busy && onClose()} footer={<Button variant="secondary" disabled={state.busy} onClick={onClose}>Listo</Button>}>
    <FormField label="Categoría"><Select value={categoryId} disabled={state.busy} onChange={event => { setCategoryId(event.target.value); setName(""); setState({ busy: false, error: "", message: "" }); }}><option value="">Elegir categoría</option>{categories.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</Select></FormField>
    {category ? <>
      <ul>{categorySubcategories(category).map(row => <li key={row.id}>{row.name}</li>)}</ul>
      <form onSubmit={event => { event.preventDefault(); run(async () => { await createProductSubcategory({ categoryId, name, profile }); setName(""); return "Subcategoría creada. Ya podés asignarla al editar un producto."; }); }}>
        <FormField label="Nueva subcategoría"><input value={name} disabled={state.busy} maxLength={80} onChange={event => setName(event.target.value)} /></FormField>
        <Button type="submit" disabled={!name.trim() || state.busy}>Crear subcategoría</Button>
      </form>
    </> : null}
    <p>La organización sugerida agrupa los productos existentes por tipo y presentación. Conserva tus asignaciones manuales, precios y cantidades.</p>
    <Button variant="secondary" disabled={state.busy} onClick={() => run(async () => `${await organizeExistingCatalog(profile)} productos asignados a sus subcategorías.`)}>Aplicar organización sugerida</Button>
    {state.error ? <Toast tone="error">{state.error}</Toast> : null}
    {state.message ? <Toast tone="success">{state.message}</Toast> : null}
  </Modal>;
}
