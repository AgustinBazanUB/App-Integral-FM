const source = (path) => `Productos/${path}`;
const publicPath = (path) => `/images/flor-mia/${path}`;

const imageAsset = ({ path, width, height, alt, sourcePath }) =>
  Object.freeze({
    src: publicPath(path),
    width,
    height,
    alt,
    source: source(sourcePath),
  });

const localFallback = imageAsset({
  path: "local/flor-mia-local.jpeg",
  width: 1600,
  height: 1200,
  alt: "Vidriera del local Flor Mía en Mendoza",
  sourcePath: "Flor-mia-local.jpeg",
});

const localHero = Object.freeze({
  ...imageAsset({
    path: "local/flor-mia-local-1600.webp",
    width: 1600,
    height: 1200,
    alt: "Vidriera del local Flor Mía con productos regionales mendocinos",
    sourcePath: "Flor-mia-local.jpeg",
  }),
  fallback: localFallback.src,
  srcSet: [
    `${publicPath("local/flor-mia-local-768.webp")} 768w`,
    `${publicPath("local/flor-mia-local-1200.webp")} 1200w`,
    `${publicPath("local/flor-mia-local-1600.webp")} 1600w`,
  ].join(", "),
  sizes: "100vw",
  variants: Object.freeze([
    Object.freeze({
      src: publicPath("local/flor-mia-local-768.webp"),
      width: 768,
      height: 576,
      type: "image/webp",
    }),
    Object.freeze({
      src: publicPath("local/flor-mia-local-1200.webp"),
      width: 1200,
      height: 900,
      type: "image/webp",
    }),
    Object.freeze({
      src: publicPath("local/flor-mia-local-1600.webp"),
      width: 1600,
      height: 1200,
      type: "image/webp",
    }),
  ]),
});

const products = Object.freeze({
  oliveOil5L: imageAsset({
    path: "products/aceite-oliva-5l.webp",
    width: 1024,
    height: 1536,
    alt: "Bidón de 5 litros de aceite de oliva Flor Mía",
    sourcePath: "fotosFinalesFlorMia/AOVE/Oliva5LBlend.png",
  }),
  oliveOil2L: imageAsset({
    path: "products/aceite-oliva-2l.webp",
    width: 1024,
    height: 1536,
    alt: "Botellón de 2 litros de aceite de oliva Flor Mía",
    sourcePath: "fotosFinalesFlorMia/AOVE/Oliva2LBlend.png",
  }),
  almonds500g: imageAsset({
    path: "products/almendras-500g.webp",
    width: 1122,
    height: 1402,
    alt: "Almendras naturales Flor Mía de 500 gramos",
    sourcePath: "fotosFinalesFlorMia/productosMendocinos/ALmendras500grPrincipal.png",
  }),
  pistachios400g: imageAsset({
    path: "products/pistachos-400g.webp",
    width: 1122,
    height: 1402,
    alt: "Pistachos con cáscara Flor Mía de 400 gramos",
    sourcePath: "fotosFinalesFlorMia/productosMendocinos/Pistachos400gr.png",
  }),
  pistachios1kg: imageAsset({
    path: "products/pistachos-1kg.webp",
    width: 1122,
    height: 1402,
    alt: "Pistachos con cáscara Flor Mía de 1 kilogramo",
    sourcePath: "fotosFinalesFlorMia/productosMendocinos/Pistachos800gr.png",
  }),
  greekOlives: imageAsset({
    path: "products/aceitunas-griegas.webp",
    width: 1086,
    height: 1448,
    alt: "Aceitunas negras tipo griegas Flor Mía",
    sourcePath: "fotosFinalesFlorMia/productosMendocinos/AceitunasGriegas500gr.png",
  }),
  pearJam: imageAsset({
    path: "products/mermelada-pera.webp",
    width: 1086,
    height: 1448,
    alt: "Frasco de mermelada de pera Tía Clara",
    sourcePath: "fotosFinalesFlorMia/productosMendocinos/MermeladaPeraTiaClara.png",
  }),
  malbecSalt: imageAsset({
    path: "products/sal-malbec.webp",
    width: 1086,
    height: 1448,
    alt: "Frasco de sal de Malbec Flor Mía",
    sourcePath: "fotosFinalesFlorMia/productosMendocinos",
  }),
  bazanWine: imageAsset({
    path: "products/vino-bazan.webp",
    width: 1086,
    height: 1448,
    alt: "Botella de vino Bazán Malbec",
    sourcePath: "fotosFinalesFlorMia/Vino/VinoBazan750ml.png",
  }),
  oliveOilTrio500cc: imageAsset({
    path: "products/aceite-trio-500cc.webp",
    width: 900,
    height: 1350,
    alt: "Tres botellas de aceite de oliva virgen extra Flor Mía de 500 mililitros",
    sourcePath: "Aceite de Oliva 500cc/PHOTO-2025-03-11-22-28-14(1).jpg",
  }),
});

const oliveVarieties = Object.freeze({
  arbequina: imageAsset({
    path: "products/aceite-arbequina-500cc.webp",
    width: 1122,
    height: 1402,
    alt: "Botella de aceite de oliva Arbequina Flor Mía de 500 cc",
    sourcePath: "fotosFinalesFlorMia/AOVE/Arbequina500cc.png",
  }),
  arbosana: imageAsset({
    path: "products/aceite-arbosana-500cc.webp",
    width: 1086,
    height: 1448,
    alt: "Botella de aceite de oliva Arbosana Flor Mía de 500 cc",
    sourcePath: "fotosFinalesFlorMia/AOVE/Arbosana500cc.png",
  }),
  coratina: imageAsset({
    path: "products/aceite-coratina-500cc.webp",
    width: 1122,
    height: 1402,
    alt: "Botella de aceite de oliva Coratina Flor Mía de 500 cc",
    sourcePath: "fotosFinalesFlorMia/AOVE/Coratina500cc.png",
  }),
  blend: imageAsset({
    path: "products/aceite-blend-500cc.webp",
    width: 1122,
    height: 1402,
    alt: "Botella de aceite de oliva Blend IG Flor Mía de 500 cc",
    sourcePath: "fotosFinalesFlorMia/AOVE/Blend500cc.png",
  }),
  picual: imageAsset({
    path: "products/aceite-picual-500cc.webp",
    width: 1122,
    height: 1402,
    alt: "Botella de aceite de oliva Picual Flor Mía de 500 cc",
    sourcePath: "fotosFinalesFlorMia/AOVE/Picual500cc.png",
  }),
  arauco: imageAsset({
    path: "products/aceite-arauco-500cc.webp",
    width: 1122,
    height: 1402,
    alt: "Botella de aceite de oliva Arauco Flor Mía de 500 cc",
    sourcePath: "fotosFinalesFlorMia/AOVE/Arauco500cc.png",
  }),
});

const categories = Object.freeze({
  olive_oil: products.oliveOilTrio500cc,
  nuts: products.almonds500g,
  olives: products.greekOlives,
  jams: products.pearJam,
  seasoned_salts: products.malbecSalt,
  wines: products.bazanWine,
  gifts: products.oliveOilTrio500cc,
});

const productAssetById = Object.freeze({
  "oil-5l": products.oliveOil5L,
  "oil-2l": products.oliveOil2L,
  "nuts-almonds-500g": products.almonds500g,
  "nuts-almonds": products.almonds500g,
  "nuts-pistachios-400g": products.pistachios400g,
  "nuts-pistachios": products.pistachios400g,
  "olives-greek": products.greekOlives,
  "olives-selection": products.greekOlives,
  "jam-pear": products.pearJam,
  "jam-pending": products.pearJam,
  "salt-malbec": products.malbecSalt,
  "wine-bazan": products.bazanWine,
  "oil-trio-500cc": products.oliveOilTrio500cc,
  "oil-arbequina": oliveVarieties.arbequina,
  "oil-arbosana": oliveVarieties.arbosana,
  "oil-coratina": oliveVarieties.coratina,
  "oil-blend": oliveVarieties.blend,
  "oil-picual": oliveVarieties.picual,
  "oil-arauco": oliveVarieties.arauco,
});

export const assetsManifest = Object.freeze({
  brand: Object.freeze({
    logo: imageAsset({
      path: "logo-flor-mia.svg",
      width: 223,
      height: 247,
      alt: "Flor Mía",
      sourcePath: "logo-flor-mia.svg",
    }),
  }),
  local: Object.freeze({
    hero: localHero,
    story: localFallback,
  }),
  products,
  categories,
  oliveVarieties,
  editorial: Object.freeze({
    table: products.oliveOilTrio500cc,
  }),
  featured: Object.freeze([
    products.oliveOil5L,
    products.oliveOil2L,
    products.almonds500g,
    products.pistachios400g,
    products.greekOlives,
    products.pearJam,
  ]),
});

export const getCategoryAsset = (categoryId) =>
  assetsManifest.categories[categoryId] ?? null;

export const getProductAsset = (productId) =>
  productAssetById[productId] ?? null;

export const getOliveVarietyAsset = (variety) =>
  assetsManifest.oliveVarieties[variety?.toLowerCase()] ?? null;
