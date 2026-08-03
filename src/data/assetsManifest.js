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
    width: 900,
    height: 900,
    alt: "Bidón de 5 litros de aceite de oliva virgen extra Flor Mía",
    sourcePath: "Aceite de Oliva Bidon 5L/producto-img-7395.jpg",
  }),
  oliveOil2L: imageAsset({
    path: "products/aceite-oliva-2l.webp",
    width: 900,
    height: 900,
    alt: "Botellón de 2 litros de aceite de oliva virgen extra Flor Mía",
    sourcePath: "Aceite de Oliva Botellon 2L/producto-img-7394.jpg",
  }),
  almonds500g: imageAsset({
    path: "products/almendras-500g.webp",
    width: 900,
    height: 900,
    alt: "Bolsa de almendras naturales Finca Divisadero de 500 gramos",
    sourcePath: "Almendras naturales 500g/producto-img-7390.jpg",
  }),
  pistachios400g: imageAsset({
    path: "products/pistachos-400g.webp",
    width: 480,
    height: 480,
    alt: "Bolsa de pistachos con cáscara Finca Divisadero de 400 gramos",
    sourcePath: "Pistachos con cascara 400g/producto-img-7384-thumb.jpg",
  }),
  greekOlives: imageAsset({
    path: "products/aceitunas-griegas.webp",
    width: 720,
    height: 960,
    alt: "Frasco de aceitunas negras tipo griegas Gema Oliv",
    sourcePath:
      "Aceituna Griega 500g/WhatsApp Image 2026-07-28 at 9.17.45 PM.jpeg",
  }),
  pearJam: imageAsset({
    path: "products/mermelada-pera.webp",
    width: 720,
    height: 960,
    alt: "Frasco de mermelada artesanal de peras Tía Clara",
    sourcePath:
      "Mermelada de Pera/WhatsApp Image 2026-07-29 at 12.20.14 PM (2).jpeg",
  }),
  malbecSalt: imageAsset({
    path: "products/sal-malbec.webp",
    width: 720,
    height: 960,
    alt: "Frasco de sal gourmet con Malbec elaborada en Mendoza",
    sourcePath: "Sal de Malbec/WhatsApp Image 2026-07-29 at 12.20.14 PM.jpeg",
  }),
  bazanWine: imageAsset({
    path: "products/vino-bazan.webp",
    width: 720,
    height: 960,
    alt: "Botella de vino Bazán Malbec 2024",
    sourcePath: "Vino BAZAN/WhatsApp Image 2026-07-29 at 12.20.13 PM (2).jpeg",
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
    width: 900,
    height: 1350,
    alt: "Botella de aceite de oliva virgen extra Arbequina Flor Mía de 500 mililitros",
    sourcePath: "Aceite de Oliva 500cc/PHOTO-2025-03-11-22-28-13.jpg",
  }),
  coratina: imageAsset({
    path: "products/aceite-coratina-500cc.webp",
    width: 900,
    height: 1350,
    alt: "Botella de aceite de oliva virgen extra Coratina Flor Mía de 500 mililitros",
    sourcePath: "Aceite de Oliva 500cc/PHOTO-2025-03-11-22-28-13(1).jpg",
  }),
  blend: imageAsset({
    path: "products/aceite-blend-500cc.webp",
    width: 900,
    height: 1350,
    alt: "Botella de aceite de oliva virgen extra Blend Flor Mía de 500 mililitros",
    sourcePath: "Aceite de Oliva 500cc/DSC_0084.JPG",
  }),
});

const categories = Object.freeze({
  olive_oil: products.oliveOilTrio500cc,
  nuts: products.almonds500g,
  olives: products.greekOlives,
  jams: products.pearJam,
  seasoned_salts: products.malbecSalt,
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
  "oil-arbosana": products.oliveOilTrio500cc,
  "oil-coratina": oliveVarieties.coratina,
  "oil-blend": oliveVarieties.blend,
  "oil-picual": products.oliveOilTrio500cc,
  "oil-arauco": products.oliveOilTrio500cc,
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
