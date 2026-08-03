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

export const promotionById = Object.fromEntries(
  promotions.map((promotion) => [promotion.id, promotion]),
);
