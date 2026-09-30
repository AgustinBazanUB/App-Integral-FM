const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function normalizeCuit(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function cuitCheckDigit(value) {
  const digits = normalizeCuit(value);
  const body = digits.length === 11 ? digits.slice(0, 10) : digits;
  if (!/^\d{10}$/.test(body)) return null;
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * CUIT_WEIGHTS[index],
    0,
  );
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return 0;
  if (remainder === 10) return 9;
  return remainder;
}

export function isValidCuit(value) {
  const digits = normalizeCuit(value);
  if (!/^\d{11}$/.test(digits)) return false;
  return cuitCheckDigit(digits) === Number(digits.at(-1));
}

export function formatCuit(value) {
  const digits = normalizeCuit(value);
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

export function assertValidCuit(value, label = "CUIT") {
  const digits = normalizeCuit(value);
  if (!isValidCuit(digits)) {
    const error = new Error(`${label} inválido.`);
    error.code = "arca-cuit-invalid";
    throw error;
  }
  return digits;
}
