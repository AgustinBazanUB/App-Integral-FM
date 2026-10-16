export function filterSellerProductGroups(groups, query) {
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return groups;
  return groups.map(group => ({ ...group, items: group.items.filter(product => {
    const text = normalize([group.name, product.productName, product.name, product.abbreviation, product.subcategoryName].filter(Boolean).join(" "));
    return terms.every(term => text.includes(term));
  }) })).filter(group => group.items.length);
}
