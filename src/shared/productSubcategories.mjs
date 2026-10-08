const text = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const presets = {
  "aceite de oliva": [["500ml", "Botellas de 500 ml"], ["2l", "Botellones de 2 litros"], ["5l", "Bidones de 5 litros"]],
  almendras: [["naturales", "Naturales"], ["saladas", "Con sal"]],
  pistachos: [["pelados", "Pelados"], ["cascara-salados", "Con cáscara, tostados y salados"]],
  "pasas de uva": [["morochas", "Morochas"], ["rubias", "Rubias"]],
  aceitunas: [["verdes", "Verdes"], ["negras", "Negras"]],
  nueces: [["mariposas", "Mariposas"], ["pecanas", "Pecanas"]],
  vinos: [["santa-brasa", "Línea Santa Brasa"], ["gritos", "Línea Gritos"], ["blancos", "Línea Blancos"], ["reserva", "Reserva"], ["gran-reserva", "Gran Reserva"]],
  mermeladas: [["400g", "Frascos de 400 gramos"], ["220g", "Frascos de 220 gramos"]],
  "cremas corporales": [["oliva", "Oliva"], ["malbec", "Malbec"]],
};

export function categorySubcategories(category = {}) {
  if (Array.isArray(category.subcategories)) return category.subcategories.filter(row => row.active !== false && row.deleted !== true);
  return (presets[text(category.name)] || []).map(([id, name], sortOrder) => ({ id, name, sortOrder }));
}

// Only classify clear presentations/types. Unknown products stay visible and can be assigned manually.
export function suggestSubcategory(product = {}, category = {}) {
  const name = text(`${product.name || product.productName || ""} ${product.description || ""}`);
  const abbreviation = text(product.abbreviation).replace(/\s/g, "");
  switch (text(category.name || product.categoryName)) {
    case "aceite de oliva":
      if (/500\s*(ml|cc)/.test(name) || /500$/.test(abbreviation)) return "500ml";
      if (/\b2\s*(l|litros?)\b/.test(name) || /2l$/.test(abbreviation)) return "2l";
      if (/\b5\s*(l|litros?)\b/.test(name) || /5l$/.test(abbreviation)) return "5l";
      return "";
    case "almendras": return /almendr/.test(name) ? (/salad|\bsal\b/.test(name) ? "saladas" : "naturales") : "";
    case "pistachos":
      if (/pelad|sin cascara/.test(name)) return "pelados";
      return /tostad|salad|con cascara/.test(name) ? "cascara-salados" : "";
    case "pasas de uva": return /rubia/.test(name) ? "rubias" : "morochas";
    case "aceitunas":
      if (/griega|portugues|negra/.test(name)) return "negras";
      return /verde|descarozad/.test(name) ? "verdes" : "";
    case "nueces": return /pecan/.test(name) ? "pecanas" : /mariposa/.test(name) ? "mariposas" : "";
    case "vinos":
      if (/gran reserva/.test(name)) return "gran-reserva";
      if (/santa brasa/.test(name)) return "santa-brasa";
      if (/gritos/.test(name)) return "gritos";
      if (/blanco|chardonnay|sauvignon blanc|torrontes/.test(name)) return "blancos";
      return /reserva|suipacha|zuipacha|bazan/.test(name) ? "reserva" : "";
    case "mermeladas":
      if (/400\s*(g|gr|gramos)/.test(name) || abbreviation === "merm400") return "400g";
      if (/220\s*(g|gr|gramos)/.test(name)) return "220g";
      return "";
    case "cremas corporales": return /malbec/.test(name) ? "malbec" : /oliva/.test(name) ? "oliva" : "";
    default: return "";
  }
}

export function productSubcategory(product, category) {
  const id = typeof product.subcategoryId === "string" ? product.subcategoryId : suggestSubcategory(product, category);
  return categorySubcategories(category).find(row => row.id === id) || null;
}

export function groupProductSubcategories(items = [], category = {}) {
  const definitions = categorySubcategories(category);
  if (!definitions.length) return [{ id: "__all", name: "", items }];
  const groups = definitions.map(row => ({ ...row, items: [] }));
  const byId = new Map(groups.map(row => [row.id, row]));
  const others = { id: "__unassigned", name: "Sin subcategoría", items: [] };
  for (const product of items) (byId.get(productSubcategory(product, category)?.id) || others).items.push(product);
  if (others.items.length) groups.push(others);
  return groups;
}

export function validateSubcategories(rows) {
  if (!Array.isArray(rows) || rows.length > 50) throw new Error("Podés crear hasta 50 subcategorías por categoría.");
  const ids = new Set(), names = new Set();
  return rows.map((row, sortOrder) => {
    const id = String(row.id || "").trim(), name = String(row.name || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !name || name.length > 80) throw new Error("Ingresá un nombre de subcategoría de hasta 80 caracteres.");
    if (ids.has(id) || names.has(text(name))) throw new Error("Esa subcategoría ya existe dentro de la categoría.");
    ids.add(id); names.add(text(name));
    return { id, name, sortOrder };
  });
}
