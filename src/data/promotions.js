export const promotions = [
  {
    id: "shipping-amba",
    icon: "truck",
    title: "¡Promociones!",
    subtitle: "Envío sin cargo AMBA",
    approved: true,
  },
  {
    id: "installments",
    icon: "credit-card",
    title: "3 cuotas sin interés",
    subtitle: "Miércoles y sábados",
    approved: true,
  },
];

// Sección protagonista de la home. Se edita por entrada, sin tocar el diseño:
// - offers: ofertas de producto; sólo se muestran cuando el producto tiene
//   precio confirmado y promoPrice numérico.
// - campaigns: promociones temporales; sólo se muestran con active: true.
// Los beneficios comerciales permanentes se leen desde trustItems (brand.js).
export const promoShowcase = {
  offers: [
    // { productId: "oil-5l", promoPrice: 0, label: "Oferta", endsAt: null },
  ],
  campaigns: [
    // {
    //   id: "semana-del-oliva",
    //   badge: "Sólo esta semana",
    //   title: "Semana del oliva",
    //   body: "Descripción de la promoción vigente.",
    //   ctaLabel: "Ver aceites",
    //   ctaTo: "/productos?categoria=olive_oil",
    //   active: false,
    // },
  ],
};

export const promotionById = Object.fromEntries(
  promotions.map((promotion) => [promotion.id, promotion]),
);
