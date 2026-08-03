const STOP_WORDS = new Set([
  "a",
  "al",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "los",
  "para",
  "por",
  "una",
  "un",
  "y",
]);

const OCCASION_ALIASES = {
  breakfast: "desayuno desayunos merienda",
  everyday: "diario cotidiana cotidiano todos los días",
  gift: "regalo regalos regalar obsequio",
  picada: "picada picadas aperitivo",
};

export function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );

  for (let row = 0; row <= a.length; row += 1) matrix[row][0] = row;
  for (let column = 0; column <= b.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function flattenSearchValues(product, category) {
  return [
    product.name,
    category?.name,
    category?.shortName,
    product.subcategory,
    product.description,
    product.badge,
    product.formats,
    product.tags,
    product.uses,
    product.occasions?.map(
      (occasion) => `${occasion} ${OCCASION_ALIASES[occasion] ?? ""}`,
    ),
    Object.values(product.attributes ?? {}),
  ]
    .flat(Infinity)
    .filter(Boolean)
    .join(" ");
}

export function matchesSearch(product, category, rawQuery) {
  const query = normalizeText(rawQuery);
  if (!query) return true;

  const haystack = normalizeText(flattenSearchValues(product, category));
  if (haystack.includes(query)) return true;

  const haystackWords = haystack.split(" ");
  const queryWords = query
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word));

  return queryWords.every((queryWord) => {
    if (haystackWords.some((word) => word.includes(queryWord))) return true;
    const tolerance = queryWord.length >= 7 ? 2 : 1;
    return haystackWords.some(
      (word) =>
        Math.abs(word.length - queryWord.length) <= tolerance &&
        editDistance(word, queryWord) <= tolerance,
    );
  });
}

export function filterProducts(products, categoriesById, query) {
  return products.filter((product) =>
    matchesSearch(product, categoriesById[product.categoryId], query),
  );
}

export function groupProductsByCategory(products) {
  return products.reduce((groups, product) => {
    const current = groups[product.categoryId] ?? [];
    return { ...groups, [product.categoryId]: [...current, product] };
  }, {});
}
