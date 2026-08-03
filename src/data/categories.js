const productImage = (fileName) => `/images/flor-mia/products/${fileName}`;

export const categories = [
  {
    id: "olive_oil",
    slug: "aceites",
    name: "Aceites de oliva",
    shortName: "Aceites de oliva",
    subtitle: "Presentaciones y varietales",
    description:
      "Aceites de oliva en presentaciones y varietales identificados en el catálogo real.",
    status: "principal",
    featured: false,
    composition: false,
    image: productImage("aceite-oliva-5l.webp"),
    imageLabel: "Aceite de oliva Flor Mía de 5 L",
    facets: ["variedad", "intensidad", "uso", "tamaño"],
  },
  {
    id: "nuts",
    slug: "frutos-secos",
    name: "Frutos secos",
    shortName: "Frutos secos",
    subtitle: "Almendras y pistachos",
    description:
      "Almendras naturales y pistachos con cáscara en presentaciones verificadas.",
    status: "principal",
    featured: false,
    composition: false,
    image: productImage("almendras-500g.webp"),
    imageLabel: "Almendras naturales Flor Mía de 500 g",
    facets: ["tipo", "preparación", "sal", "cáscara", "uso", "tamaño"],
  },
  {
    id: "olives",
    slug: "aceitunas",
    name: "Aceitunas",
    shortName: "Aceitunas",
    subtitle: "Aceitunas griegas",
    description: "Aceitunas griegas en la presentación disponible en el catálogo.",
    status: "principal",
    featured: false,
    composition: false,
    image: productImage("aceitunas-griegas.webp"),
    imageLabel: "Aceitunas griegas Flor Mía",
    facets: ["variedad", "color", "carozo", "uso", "tamaño"],
  },
  {
    id: "jams",
    slug: "mermeladas",
    name: "Mermeladas",
    shortName: "Mermeladas",
    subtitle: "Mermelada de pera",
    description:
      "Mermelada de pera; otras variedades se incorporarán cuando estén confirmadas.",
    status: "principal",
    featured: false,
    composition: false,
    image: productImage("mermelada-pera.webp"),
    imageLabel: "Mermelada de pera Flor Mía",
    facets: ["sabor", "fruta", "uso", "tamaño"],
  },
  {
    id: "seasoned_salts",
    slug: "sales",
    name: "Sales condimentadas",
    shortName: "Sales condimentadas",
    subtitle: "Sal de Malbec",
    description:
      "Sal de Malbec; otras variedades se incorporarán cuando estén confirmadas.",
    status: "complementaria",
    featured: false,
    composition: false,
    image: productImage("sal-malbec.webp"),
    imageLabel: "Sal de Malbec Flor Mía",
    facets: ["condimento", "intensidad", "uso", "tamaño"],
  },
  {
    id: "gifts",
    slug: "regalos",
    name: "Regalos",
    shortName: "Regalos",
    subtitle: "Una composición de productos reales",
    description:
      "Composición editorial con productos reales; no representa un pack comercial.",
    status: "estrategica",
    featured: false,
    composition: true,
    image: productImage("aceite-blend-500cc.webp"),
    compositionImages: [
      {
        src: productImage("aceite-blend-500cc.webp"),
        width: 900,
        height: 1350,
      },
      {
        src: productImage("almendras-500g.webp"),
        width: 900,
        height: 900,
      },
      {
        src: productImage("mermelada-pera.webp"),
        width: 720,
        height: 960,
      },
    ],
    imageLabel: "Composición editorial de productos Flor Mía",
    facets: ["ocasión", "formato"],
  },
];

export const categoryById = Object.fromEntries(
  categories.map((category) => [category.id, category]),
);
