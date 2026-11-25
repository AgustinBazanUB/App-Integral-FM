const productImage = (fileName) => `/images/flor-mia/products/${fileName}`;

// Los perfiles describen el carácter típico de cada variedad de aceituna.
// `verified` pasa a true cuando Flor Mía confirme el perfil de su aceite.
// Escalas de frutado/amargor/picor: 0 a 5 (cata estándar).
export const oliveProfiles = [
  {
    id: "arbequina",
    name: "Arbequina",
    descriptor: "Suave y dulce",
    summary:
      "Frutado maduro con notas de manzana, banana y almendra. Amargor y picor muy leves: entra fácil a cualquier paladar.",
    use: "Ensaladas, pescados, repostería y platos delicados.",
    intensity: "Suave",
    fruitiness: 4,
    bitterness: 2,
    pungency: 2,
    image: productImage("aceite-arbequina-500cc.webp"),
    imageStatus: "verified-product",
    productId: "oil-arbequina",
    verified: false,
  },
  {
    id: "arbosana",
    name: "Arbosana",
    descriptor: "Delicado y almendrado",
    summary:
      "Aromático y cremoso, con notas de piel de manzana, banana y almendra fresca. Un cierre herbal apenas picante lo pone un paso por encima de la Arbequina, sin dejar de ser suave.",
    use: "Ensaladas, vegetales, carnes blancas y uso diario.",
    intensity: "Suave",
    fruitiness: 4,
    bitterness: 2.5,
    pungency: 2.5,
    image: productImage("aceite-arbosana-500cc.webp"),
    imageStatus: "verified-product",
    productId: "oil-arbosana",
    verified: false,
  },
  {
    id: "blend",
    name: "Blend IG",
    descriptor: "Equilibrio mendocino",
    summary:
      "Blend con Indicación Geográfica Mendoza: 50% Arbequina aporta la base suave y frutada, 30% Arauco el carácter criollo y 20% Coratina el amargor y picor que lo ubican en intensidad media.",
    use: "Versátil: cocina, picadas, panes y finalización de platos.",
    intensity: "Intermedio",
    fruitiness: 4,
    bitterness: 3,
    pungency: 3,
    image: productImage("aceite-blend-500cc.webp"),
    imageStatus: "verified-product",
    productId: "oil-blend",
    verified: true,
  },
  {
    id: "coratina",
    name: "Coratina",
    descriptor: "Intenso y herbal",
    summary:
      "La variedad más rica en polifenoles: frutado medio-alto con notas de hoja, alcaucil y almendra verde, y un amargor-picor pronunciado que se siente en garganta.",
    use: "Carnes a la parrilla, panes, guisos y platos de sabor fuerte.",
    intensity: "Intenso",
    fruitiness: 4,
    bitterness: 4.5,
    pungency: 4.5,
    image: productImage("aceite-coratina-500cc.webp"),
    imageStatus: "verified-product",
    productId: "oil-coratina",
    verified: false,
  },
  {
    id: "picual",
    name: "Picual",
    descriptor: "Frutado equilibrado",
    summary:
      "La variedad más plantada del mundo: frutado alto con notas de higuera y hoja de tomate, amargor y picor medios. Muy estable para cocinar.",
    use: "Cocciones, carnes, vegetales y uso cotidiano de mayor carácter.",
    intensity: "Intermedio",
    fruitiness: 4.5,
    bitterness: 3.5,
    pungency: 3.5,
    image: productImage("aceite-picual-500cc.webp"),
    imageStatus: "verified-product",
    productId: "oil-picual",
    verified: false,
  },
  {
    id: "arauco",
    name: "Arauco",
    descriptor: "Criollo y picante",
    summary:
      "La variedad criolla emblemática de Argentina: frutado verde intenso con notas de tomate, hierbas y manzana. Rico en polifenoles, con amargor y picor medios-altos.",
    use: "Asados, empanadas, platos de carácter y acabado en crudo.",
    intensity: "Intenso",
    fruitiness: 4.5,
    bitterness: 4,
    pungency: 4.5,
    image: productImage("aceite-arauco-500cc.webp"),
    imageStatus: "verified-product",
    productId: "oil-arauco",
    verified: false,
  },
];

export const oliveProfileById = Object.fromEntries(
  oliveProfiles.map((profile) => [profile.id, profile]),
);

export const sensoryDimensions = [
  "Frutado",
  "Amargor",
  "Picor",
  "Intensidad general",
  "Uso sugerido",
];
