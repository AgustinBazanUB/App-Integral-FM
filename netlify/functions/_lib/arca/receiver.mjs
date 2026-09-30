export const ARCA_RECEIVER_VAT_CONDITIONS = Object.freeze({
  RESPONSABLE_INSCRIPTO: Object.freeze({ id: 1, description: "IVA Responsable Inscripto" }),
  EXENTO: Object.freeze({ id: 4, description: "IVA Sujeto Exento" }),
  CONSUMIDOR_FINAL: Object.freeze({ id: 5, description: "Consumidor Final" }),
  MONOTRIBUTO: Object.freeze({ id: 6, description: "Responsable Monotributo" }),
  NO_CATEGORIZADO: Object.freeze({ id: 7, description: "Sujeto No Categorizado" }),
  PROVEEDOR_EXTERIOR: Object.freeze({ id: 8, description: "Proveedor del Exterior" }),
  CLIENTE_EXTERIOR: Object.freeze({ id: 9, description: "Cliente del Exterior" }),
  IVA_LIBERADO: Object.freeze({ id: 10, description: "IVA Liberado - Ley N° 19.640" }),
  MONOTRIBUTISTA_SOCIAL: Object.freeze({ id: 13, description: "Monotributista Social" }),
  IVA_NO_ALCANZADO: Object.freeze({ id: 15, description: "IVA No Alcanzado" }),
  MONOTRIBUTO_PROMOVIDO: Object.freeze({ id: 16, description: "Monotributo Trabajador Independiente Promovido" }),
});

const activeStatus = (value) => ["AC", "ACTIVO", "ACTIVE"].includes(String(value || "").trim().toUpperCase());

function hasActiveTax(person, taxId) {
  return (person?.taxes || []).some((tax) => Number(tax?.id) === Number(taxId) && activeStatus(tax?.status));
}

function hasActiveMonotributo(person) {
  if (!person?.monotributoData) return false;
  return (person.monotributoData.taxes || []).some((tax) => Number(tax?.id) === 20 && activeStatus(tax?.status));
}

function normalized(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function inferReceiverVatCondition(person = {}) {
  if (!person?.found) {
    return {
      resolved: false,
      condition: null,
      reason: "taxpayer-not-found",
    };
  }

  if (person.keyStatus && normalized(person.keyStatus) !== "ACTIVO") {
    return {
      resolved: false,
      condition: null,
      reason: "taxpayer-not-active",
    };
  }

  if (hasActiveTax(person, 30)) {
    return {
      resolved: true,
      condition: ARCA_RECEIVER_VAT_CONDITIONS.RESPONSABLE_INSCRIPTO,
      reason: "active-vat-tax",
    };
  }

  if (person.monotributo && hasActiveMonotributo(person)) {
    const description = normalized(person.monotributoData?.category?.description);
    if (description.includes("MONOTRIBUTO SOCIAL")) {
      return {
        resolved: true,
        condition: ARCA_RECEIVER_VAT_CONDITIONS.MONOTRIBUTISTA_SOCIAL,
        reason: "monotributo-social-category",
      };
    }
    if (description.includes("TRABAJADOR INDEPENDIENTE PROMOVIDO")) {
      return {
        resolved: true,
        condition: ARCA_RECEIVER_VAT_CONDITIONS.MONOTRIBUTO_PROMOVIDO,
        reason: "monotributo-promoted-category",
      };
    }
    return {
      resolved: true,
      condition: ARCA_RECEIVER_VAT_CONDITIONS.MONOTRIBUTO,
      reason: "active-monotributo-tax",
    };
  }

  return {
    resolved: false,
    condition: null,
    reason: "registry-insufficient-for-vat-condition",
  };
}

export function consumerFinalReceiver() {
  return {
    resolved: true,
    condition: ARCA_RECEIVER_VAT_CONDITIONS.CONSUMIDOR_FINAL,
    reason: "consumer-final-without-tax-registry",
  };
}

export function validateReceiverConditionAgainstTable(conditionId, rows = [], voucherClass = "") {
  const id = Number(conditionId);
  const normalizedClass = normalized(voucherClass);
  const matches = rows.filter((row) => Number(row?.id) === id);
  if (!matches.length) return false;
  if (!normalizedClass) return true;
  return matches.some((row) =>
    (row.voucherClasses || []).some((value) => normalized(value) === normalizedClass)
  );
}
