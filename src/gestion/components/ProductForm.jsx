import { useEffect, useMemo, useState } from "react";
import {
  Button,
  FormField,
  Modal,
  SearchInput,
  Select,
  Toast,
} from "../../design-system";
import { productImages } from "../../data/productImages";
import HelpTooltip from "./HelpTooltip";
import { saveMasterProduct } from "../services/inventoryService";

const emptyForm = {
  name: "",
  abbreviation: "",
  categoryId: "",
  description: "",
  defaultPrice: 0,
  yellowAlertQty: 0,
  redAlertQty: 0,
  active: true,
  imageId: "product-placeholder",
  buttonKey: "",
  buttonCode: "",
  buttonLocation: 0,
  buttonLabel: "",
};

function initialForm(product) {
  if (!product) return emptyForm;
  const selectedImage = productImages.find((image) => image.imageUrl === product.imageUrl);
  return {
    ...emptyForm,
    name: product.name || product.productName || "",
    abbreviation: product.abbreviation || "",
    categoryId: product.categoryId || "",
    description: product.description || "",
    defaultPrice: Number(product.defaultPrice || 0),
    yellowAlertQty: Number(product.yellowAlertQty || 0),
    redAlertQty: Number(product.redAlertQty || 0),
    active: product.active !== false,
    imageId: selectedImage?.id || "product-placeholder",
    buttonKey: product.buttonKey || "",
    buttonCode: product.buttonCode || "",
    buttonLocation: Number(product.buttonLocation || 0),
    buttonLabel: product.buttonLabel || "",
  };
}

export default function ProductForm({ open, product, categories, profile, onClose, onSaved }) {
  const editing = Boolean(product?.id);
  const [form, setForm] = useState(() => initialForm(product));
  const [imageSearch, setImageSearch] = useState("");
  const [imageCategory, setImageCategory] = useState("");
  const [recording, setRecording] = useState(false);
  const [state, setState] = useState({ busy: false, error: "" });

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(product));
    setImageSearch("");
    setImageCategory("");
    setRecording(false);
    setState({ busy: false, error: "" });
  }, [open, product?.id]);

  useEffect(() => {
    if (!recording) return undefined;
    const onKeyDown = (event) => {
      event.preventDefault();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }
      setForm((current) => ({
        ...current,
        buttonKey: event.key,
        buttonCode: event.code,
        buttonLocation: event.location || 0,
        buttonLabel: event.key === " " ? "Espacio" : event.key,
      }));
      setRecording(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording]);

  const filteredImages = useMemo(() => {
    const term = imageSearch.trim().toLocaleLowerCase("es");
    return productImages.filter((image) => {
      if (imageCategory && image.categoryId !== imageCategory) return false;
      if (term && !`${image.name} ${image.originalFileName}`.toLocaleLowerCase("es").includes(term)) return false;
      return true;
    });
  }, [imageCategory, imageSearch]);

  const selectedImage = productImages.find((image) => image.id === form.imageId) || productImages[0];

  const submit = async (event) => {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      await saveMasterProduct({
        productId: product?.id || "",
        values: {
          ...form,
          imageUrl: selectedImage?.imageUrl || "",
          thumbUrl: selectedImage?.thumbUrl || selectedImage?.imageUrl || "",
          imageAlt: selectedImage?.alt || form.name,
          imageStatus: selectedImage?.status || "available",
          originalImageFileName: selectedImage?.originalFileName || "",
        },
        profile,
      });
      await onSaved?.();
      onClose?.();
    } catch (error) {
      setState({ busy: false, error: error.message });
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !state.busy && onClose?.()}
      title={editing ? `Editar ${product?.name || "producto"}` : "Nuevo producto"}
      description="Este producto se guarda una sola vez en el catálogo general. El stock se carga después en cada ubicación o depósito."
    >
      <form className="fm-form-grid fm-product-form" onSubmit={submit}>
        <FormField label="Nombre" required>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </FormField>
        <FormField label="Abreviación" hint="Hasta 8 caracteres." required>
          <input maxLength="8" value={form.abbreviation} onChange={(event) => setForm({ ...form, abbreviation: event.target.value.toUpperCase() })} />
        </FormField>
        <FormField label="Categoría">
          <Select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
            <option value="">Sin categoría</option>
            {(categories || []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Precio predeterminado" hint="Las ubicaciones que usen este precio se actualizarán automáticamente." required>
          <input type="number" min="0" step="1" inputMode="numeric" value={form.defaultPrice} onChange={(event) => setForm({ ...form, defaultPrice: event.target.value })} />
        </FormField>
        <FormField label="Descripción" className="fm-form-grid__full">
          <textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </FormField>
        <FormField label="Alerta amarilla" required>
          <input type="number" min="0" step="1" inputMode="numeric" value={form.yellowAlertQty} onChange={(event) => setForm({ ...form, yellowAlertQty: event.target.value })} />
        </FormField>
        <FormField label="Alerta roja" required>
          <input type="number" min="0" step="1" inputMode="numeric" value={form.redAlertQty} onChange={(event) => setForm({ ...form, redAlertQty: event.target.value })} />
        </FormField>

        <section className="fm-image-picker-section fm-form-grid__full" aria-labelledby="master-product-image-title">
          <header>
            <div>
              <h3 id="master-product-image-title">Imagen del producto</h3>
              <p>Elegí una imagen disponible en el catálogo visual actual.</p>
            </div>
            {selectedImage ? <div className="fm-image-picker-preview"><img src={selectedImage.thumbUrl} alt={selectedImage.alt} /><span>{selectedImage.name}</span></div> : null}
          </header>
          <div className="fm-image-picker-filters">
            <SearchInput label="Buscar imagen" value={imageSearch} onChange={(event) => setImageSearch(event.target.value)} />
            <Select aria-label="Filtrar imágenes por categoría" value={imageCategory} onChange={(event) => setImageCategory(event.target.value)}>
              <option value="">Todas las categorías</option>
              {(categories || []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </div>
          <div className="fm-image-picker-grid">
            {filteredImages.map((image) => (
              <label key={image.id} className={form.imageId === image.id ? "is-selected" : ""}>
                <input type="radio" name="master-product-image" value={image.id} checked={form.imageId === image.id} onChange={() => setForm({ ...form, imageId: image.id })} />
                <img src={image.thumbUrl} alt="" loading="lazy" />
                <span>{image.name}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="fm-key-recorder fm-form-grid__full">
          <div><strong>Tecla de botonera</strong><p>{form.buttonLabel ? `Tecla asignada: ${form.buttonLabel}` : "Sin tecla asignada."}</p></div>
          <div className="fm-dialog-actions">
            <HelpTooltip label="Guarda la próxima tecla que presiones para usarla como acceso rápido en venta.">
              <Button type="button" variant="secondary" onClick={() => setRecording(true)}>{recording ? "Presioná una tecla…" : "Grabar tecla"}</Button>
            </HelpTooltip>
            <HelpTooltip label="Quita el acceso rápido de teclado de este producto.">
              <Button type="button" variant="ghost" onClick={() => setForm({ ...form, buttonKey: "", buttonCode: "", buttonLocation: 0, buttonLabel: "" })}>Quitar tecla</Button>
            </HelpTooltip>
          </div>
        </section>

        <label className="fm-check-row fm-form-grid__full"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span>Producto activo</span></label>
        {state.error ? <Toast tone="error">{state.error}</Toast> : null}
        <div className="fm-dialog-actions fm-form-grid__full">
          <HelpTooltip label="Cierra esta ventana sin guardar los cambios."><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button></HelpTooltip>
          <HelpTooltip label={editing ? "Guarda los cambios del producto en el catálogo general." : "Crea este producto en el catálogo general de Flor Mía."}>
            <Button type="submit" loading={state.busy}>{editing ? "Guardar producto" : "Crear producto"}</Button>
          </HelpTooltip>
        </div>
      </form>
    </Modal>
  );
}
