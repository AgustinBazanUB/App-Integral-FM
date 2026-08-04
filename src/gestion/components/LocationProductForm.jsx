import { useEffect, useMemo, useState } from "react";
import {
  Button,
  ConfirmationDialog,
  FormField,
  Modal,
  SearchInput,
  Select,
  Toast,
} from "../../design-system";
import { productImages } from "../../data/productImages";
import {
  canAssignGlobally,
  saveMasterProductFromLocation,
} from "../services/locationEnhancementsService";

const emptyForm = {
  name: "",
  abbreviation: "",
  categoryId: "",
  description: "",
  defaultPrice: 0,
  yellowAlertQty: 0,
  redAlertQty: 0,
  active: true,
  scope: "current",
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
    defaultPrice: Number(product.defaultPrice ?? product.price ?? 0),
    yellowAlertQty: Number(product.yellowAlertQty || 0),
    redAlertQty: Number(product.redAlertQty || 0),
    active: product.masterActive !== false && product.active !== false,
    imageId: selectedImage?.id || "product-placeholder",
    buttonKey: product.buttonKey || "",
    buttonCode: product.buttonCode || "",
    buttonLocation: Number(product.buttonLocation || 0),
    buttonLabel: product.buttonLabel || "",
  };
}

export default function LocationProductForm({
  open,
  product,
  categories,
  location,
  profile,
  onClose,
  onSaved,
}) {
  const editing = Boolean(product?.id);
  const allowGlobal = canAssignGlobally(profile);
  const [form, setForm] = useState(() => initialForm(product));
  const [imageSearch, setImageSearch] = useState("");
  const [imageCategory, setImageCategory] = useState("");
  const [recording, setRecording] = useState(false);
  const [pendingGlobal, setPendingGlobal] = useState(false);
  const [state, setState] = useState({ busy: false, error: "", success: "" });

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(product));
    setImageSearch("");
    setImageCategory("");
    setRecording(false);
    setPendingGlobal(false);
    setState({ busy: false, error: "", success: "" });
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

  const save = async () => {
    setState({ busy: true, error: "", success: "" });
    try {
      const result = await saveMasterProductFromLocation({
        location,
        productId: editing ? product.id : "",
        values: {
          ...form,
          imageUrl: selectedImage.imageUrl,
          thumbUrl: selectedImage.thumbUrl,
          imageAlt: selectedImage.alt,
          imageStatus: selectedImage.status,
          originalImageFileName: selectedImage.originalFileName,
        },
        scope: editing ? "current" : form.scope,
        profile,
      });
      setPendingGlobal(false);
      setState({ busy: false, error: "", success: editing ? "Producto maestro actualizado." : "Producto creado y asignado correctamente." });
      await onSaved?.(result);
      onClose?.();
    } catch (error) {
      setPendingGlobal(false);
      setState({ busy: false, error: error.message, success: "" });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!editing && form.scope === "all") {
      setPendingGlobal(true);
      return;
    }
    await save();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={() => !state.busy && onClose?.()}
        title={editing ? `Editar ${product?.productName || product?.name || "producto"}` : "Agregar nuevo producto"}
        description="Se guarda una única definición maestra. Firestore conserva únicamente la ruta de la imagen local."
      >
        <form className="fm-form-grid fm-product-form" onSubmit={handleSubmit}>
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
          <FormField label="Precio predeterminado" hint="Número entero, sin decimales." required>
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

          {!editing ? (
            <fieldset className="fm-product-scope fm-form-grid__full">
              <legend>Disponible en</legend>
              <label><input type="radio" name="product-scope" value="current" checked={form.scope === "current"} onChange={() => setForm({ ...form, scope: "current" })} /><span><strong>Solo esta ubicación</strong><small>Se crea en el catálogo maestro y comienza con stock 0 en {location?.name}.</small></span></label>
              <label className={!allowGlobal ? "is-disabled" : ""}><input type="radio" name="product-scope" value="all" checked={form.scope === "all"} disabled={!allowGlobal} onChange={() => setForm({ ...form, scope: "all" })} /><span><strong>Todas las ubicaciones activas</strong><small>{allowGlobal ? "Se asigna sin duplicar el producto y cada ubicación comienza con stock 0." : "Disponible únicamente para administración autorizada."}</small></span></label>
            </fieldset>
          ) : null}

          <section className="fm-image-picker-section fm-form-grid__full" aria-labelledby="product-image-title">
            <header>
              <div><h3 id="product-image-title">Imagen del catálogo local</h3><p>Las imágenes se publican con GitHub y Netlify; no se usa Firebase Storage.</p></div>
              <div className="fm-image-picker-preview"><img src={selectedImage.thumbUrl} alt={selectedImage.alt} /><span>{selectedImage.name}</span></div>
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
                  <input type="radio" name="product-image" value={image.id} checked={form.imageId === image.id} onChange={() => setForm({ ...form, imageId: image.id })} />
                  <img src={image.thumbUrl} alt="" loading="lazy" />
                  <span>{image.name}</span>
                  <small>{image.status === "pending" ? "Imagen pendiente" : image.originalFileName}</small>
                </label>
              ))}
            </div>
          </section>

          <section className="fm-key-recorder fm-form-grid__full">
            <div><strong>Tecla de botonera</strong><p>{form.buttonLabel ? `Tecla asignada: ${form.buttonLabel}` : "Sin tecla asignada."}</p></div>
            <div className="fm-dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setRecording(true)}>{recording ? "Presioná una tecla…" : "Grabar tecla"}</Button>
              <Button type="button" variant="ghost" onClick={() => setForm({ ...form, buttonKey: "", buttonCode: "", buttonLocation: 0, buttonLabel: "" })}>Quitar tecla</Button>
            </div>
          </section>

          <label className="fm-check-row fm-form-grid__full"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span>Producto activo</span></label>
          {state.error ? <Toast tone="error">{state.error}</Toast> : null}
          {state.success ? <Toast tone="success">{state.success}</Toast> : null}
          <div className="fm-dialog-actions fm-form-grid__full">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={state.busy}>{editing ? "Guardar producto" : "Crear producto"}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmationDialog
        open={pendingGlobal}
        onClose={() => !state.busy && setPendingGlobal(false)}
        onConfirm={save}
        busy={state.busy}
        title="Agregar a todas las ubicaciones"
        description="Este producto quedará disponible en todas las ubicaciones activas. El stock inicial será 0. ¿Querés continuar?"
      />
    </>
  );
}
