import { wholeInventoryQuantity } from "../modules/inventory/domain/inventory.js";
const userName = (profile) => profile.name || profile.email || "Usuario";
const normalizedText = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es-AR");
export function buildMasterProductPayload(values, categoryName, profile, editing, stamp) {
  const name = String(values.name || "").trim();
  const abbreviation = String(values.abbreviation || "").trim().toUpperCase();
  const defaultPrice = wholeInventoryQuantity(values.defaultPrice || 0, "El precio predeterminado");
  const yellowAlertQty = wholeInventoryQuantity(values.yellowAlertQty || 0, "La alerta amarilla");
  const redAlertQty = wholeInventoryQuantity(values.redAlertQty || 0, "La alerta roja");
  const arcaVatRate = values.arcaVatRate === "" || values.arcaVatRate == null ? null : Number(values.arcaVatRate);
  if (arcaVatRate != null && ![0, 10.5, 21, 27].includes(arcaVatRate)) throw new Error("La alícuota IVA ARCA no es válida.");
  if (!name) throw new Error("Ingresá el nombre del producto.");
  if (!abbreviation) throw new Error("Ingresá una abreviación.");
  if (abbreviation.length > 8) throw new Error("La abreviación admite hasta 8 caracteres.");
  if (yellowAlertQty < redAlertQty) throw new Error("La alerta amarilla debe ser mayor o igual a la roja.");
  return {
    name,
    nameKey: normalizedText(name),
    abbreviation,
    abbreviationKey: normalizedText(abbreviation),
    description: String(values.description || "").trim(),
    defaultPrice,
    arcaVatRate,
    yellowAlertQty,
    redAlertQty,
    categoryId: String(values.categoryId || "").trim(),
    categoryName,
    imageUrl: String(values.imageUrl || "").trim(),
    thumbUrl: String(values.thumbUrl || values.imageUrl || "").trim(),
    imageAlt: String(values.imageAlt || name).trim(),
    imageStatus: values.imageStatus || "available",
    originalImageFileName: String(values.originalImageFileName || "").trim(),
    buttonKey: String(values.buttonKey || "").trim(),
    buttonCode: String(values.buttonCode || "").trim(),
    buttonLocation: Number(values.buttonLocation || 0),
    buttonLabel: String(values.buttonLabel || values.buttonKey || "").trim(),
    active: values.active !== false,
    deleted: false,
    updatedAt: stamp,
    updatedBy: profile.id,
    updatedByName: userName(profile),
    ...(editing ? {} : {
      createdAt: stamp,
      createdBy: profile.id,
      createdByName: userName(profile),
    }),
  };
}
