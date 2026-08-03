export const faqItems = [
  {
    question: "¿Qué tipo de productos vende Flor Mía?",
    answer:
      "Flor Mía reúne aceites de oliva, frutos secos, aceitunas, mermeladas, sales condimentadas y opciones para regalo. El catálogo final se publicará con datos verificados.",
  },
  {
    question: "¿Todos los productos son originarios de Mendoza?",
    answer:
      "Flor Mía se especializa en productos regionales mendocinos. La procedencia específica de cada producto se informará en su ficha cuando esté verificada.",
  },
  {
    question: "¿Qué diferencia hay entre los varietales de aceite?",
    answer:
      "Cada varietal puede expresar perfiles distintos de frutado, amargor y picor. Las fichas técnicas definitivas están pendientes de validación por Flor Mía.",
  },
  {
    question: "¿Cuál es el aceite más suave o más intenso?",
    answer:
      "El comparador ya está preparado, pero no publica valores técnicos hasta que Flor Mía los valide.",
  },
  {
    question: "¿Qué frutos secos y tamaños están disponibles?",
    answer:
      "El sitio contempla almendras, pistachos y pasas de uva. Los tamaños y el stock se mostrarán cuando se cargue el catálogo real.",
  },
  {
    question: "¿Qué tipos de aceitunas tienen?",
    answer:
      "La selección contempla griegas, verdes y negras, con carozo o descarozadas. La disponibilidad se confirmará producto por producto.",
  },
  {
    question: "¿Qué sabores de mermelada están disponibles?",
    answer:
      "Los sabores todavía no fueron cargados. Para evitar información incorrecta, se publicarán únicamente cuando estén confirmados.",
  },
  {
    question: "¿Qué sales condimentadas tienen?",
    answer:
      "La información recibida menciona sal con Malbec y sal con ajo. Formatos, stock y otras variedades siguen pendientes.",
  },
  {
    question: "¿Cómo conservar cada producto una vez abierto?",
    answer:
      "Las indicaciones de conservación se incorporarán a cada ficha según el envase y la información real del producto.",
  },
  {
    question: "¿Puedo armar una selección para regalo o una picada?",
    answer:
      "Sí, podés combinar productos individualmente en el carrito. Los packs comerciales solo aparecerán si están realmente disponibles.",
  },
  {
    question: "¿Cómo funcionan los envíos y el retiro?",
    answer:
      "El envío es sin cargo dentro del AMBA. La cobertura exacta y la coordinación de la entrega se confirman antes de completar la compra. La información de retiro en el local continúa pendiente.",
  },
  {
    question: "¿Qué medios de pago aceptan?",
    answer:
      "Los miércoles y sábados podés abonar en hasta 3 cuotas sin interés. El checkout online todavía no procesa pagos: la modalidad disponible se coordina antes de confirmar el pedido.",
  },
  {
    question: "¿Realizan ventas corporativas o mayoristas?",
    answer:
      "Esta modalidad está pendiente de confirmación. Cuando exista información comercial real se publicará en contacto.",
  },
];

export const regionalShowcase = [
  {
    categoryId: "nuts",
    title: "Frutos secos",
    summary: "Almendras, pistachos y pasas en formatos reales por confirmar.",
    examples: ["Almendras naturales", "Pistachos", "Pasas de uva"],
    image: "/images/placeholders/editorial-frutos-secos-mendoza.webp",
  },
  {
    categoryId: "olives",
    title: "Aceitunas",
    summary: "Opciones verdes, negras, griegas, con carozo y descarozadas.",
    examples: ["Griegas", "Verdes", "Negras", "Descarozadas"],
    image: "/images/placeholders/editorial-aceitunas-mendoza.webp",
  },
  {
    categoryId: "jams",
    title: "Mermeladas",
    summary: "Sabores para desayunos, tablas y regalos; catálogo pendiente.",
    examples: ["Sabores reales pendientes"],
    image: "/images/placeholders/editorial-mermeladas-mendoza.webp",
  },
  {
    categoryId: "seasoned_salts",
    title: "Sales condimentadas",
    summary: "Detalles mendocinos para terminar preparaciones simples.",
    examples: ["Sal con Malbec", "Sal con ajo"],
    image: "/images/placeholders/editorial-sales-mendoza.webp",
  },
];

export const gallerySlots = [
  "Interior y frente del local",
  "Degustación de aceite",
  "Botellas de aceite",
  "Almendras y pistachos",
  "Aceitunas",
  "Mermeladas",
  "Sales condimentadas",
  "Regalos o mesas armadas",
].map((label, index) => ({
  label,
  image: `/images/placeholders/galeria-flor-mia-${index + 1}.webp`,
}));
