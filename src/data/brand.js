export const brand = {
  name: "Flor Mía",
  tagline: "De Mendoza a tu mesa.",
  description:
    "Tienda premium de productos regionales mendocinos, con el aceite de oliva como gran especialidad.",
  logo: {
    src: "/images/flor-mia/logo-flor-mia.svg",
    width: 223,
    height: 247,
  },
  instagram: "https://www.instagram.com/flormia.mdz/",
  contact: {
    whatsapp: null,
    whatsappUrl: null,
    phone: null,
    phoneUrl: null,
    email: null,
    emailUrl: null,
    address: null,
    mapUrl: null,
    openingHours: null,
    pendingMessage:
      "Dirección, teléfono, email y horarios pendientes de confirmación.",
  },
};

export const announcementMessages = [
  "ENVÍOS A TODO EL PAÍS",
  "LOCAL EN CABA",
  "CUOTAS SIN INTERÉS",
];

export const navigation = [
  { label: "Inicio", to: "/" },
  { label: "Tienda", to: "/productos" },
  { label: "Aceites de oliva", to: "/productos?categoria=olive_oil" },
  { label: "Frutos secos", to: "/productos?categoria=nuts" },
  { label: "Aceitunas", to: "/productos?categoria=olives" },
  { label: "Mermeladas", to: "/productos?categoria=jams" },
  { label: "Regalos", to: "/productos?categoria=gifts" },
  { label: "Nosotros", to: "/nosotros" },
  { label: "Contacto", to: "/#contacto" },
];

export const mobileNavigation = [
  { label: "Inicio", to: "/" },
  { label: "Tienda", to: "/productos" },
  { label: "AOVE", to: "/productos?categoria=olive_oil" },
  { label: "Frutos secos", to: "/productos?categoria=nuts" },
  { label: "Vinos", to: "/productos?categoria=wines" },
  {
    label: "Productos Regionales Mdz",
    to: "/productos?coleccion=regionales",
  },
  { label: "Regalos pre-armados", to: "/productos?categoria=gifts" },
  { label: "Nosotros", to: "/nosotros" },
  { label: "Contacto", to: "/#contacto" },
];

export const footerNavigation = [
  {
    title: "Tienda",
    links: [
      { label: "Aceites de oliva", to: "/productos?categoria=olive_oil" },
      { label: "Frutos secos", to: "/productos?categoria=nuts" },
      { label: "Aceitunas", to: "/productos?categoria=olives" },
      { label: "Mermeladas", to: "/productos?categoria=jams" },
      {
        label: "Sales condimentadas",
        to: "/productos?categoria=seasoned_salts",
      },
      { label: "Regalos", to: "/productos?categoria=gifts" },
    ],
  },
  {
    title: "Información",
    links: [
      { label: "Nosotros", to: "/nosotros" },
      { label: "Nuestra historia", to: "/nosotros#origen" },
      { label: "Origen y selección", to: "/nosotros#origen" },
      { label: "Contacto", to: "/#contacto" },
    ],
  },
  {
    title: "Ayuda",
    links: [
      { label: "Envíos y retiros", to: "/checkout" },
      { label: "Medios de pago", to: "/checkout" },
      { label: "Contacto", to: "/#contacto" },
    ],
  },
];

export const trustItems = [
  {
    id: "shipping-amba",
    icon: "truck",
    title: "Envío sin cargo",
    subtitle: "En el AMBA",
    detail:
      "El envío no tiene cargo dentro del AMBA. Al coordinar la compra, confirmamos que tu domicilio esté incluido en la zona de entrega.",
  },
  {
    id: "installments",
    icon: "credit-card",
    title: "Hasta 3 cuotas sin interés",
    subtitle: "Miércoles y sábados",
    detail:
      "Los miércoles y sábados podés abonar en hasta 3 cuotas sin interés. La modalidad de pago se coordina antes de confirmar el pedido.",
  },
  {
    id: "producer-to-table",
    icon: "sprout",
    title: "Del productor a tu mesa",
    subtitle: "Directo del productor a tu mesa",
    detail:
      "Acercamos a tu mesa una selección de productos mendocinos directamente de sus productores, cuidando el origen y la elección de cada producto.",
  },
  {
    id: "personal-service",
    icon: "heart-handshake",
    title: "Atención personalizada",
    subtitle: "Te ayudamos a elegir",
    detail:
      "Te acompañamos para elegir según tus gustos, el uso o la ocasión: consumo diario, picadas, regalos y más.",
  },
];

export const purchaseInformation = [
  {
    icon: "truck",
    title: "Envíos",
    text: "Sin cargo dentro del AMBA. La cobertura exacta se confirma antes de coordinar la entrega.",
    linkLabel: "Ver condiciones",
  },
  {
    icon: "store",
    title: "Retiro en el local",
    text: "Dirección, horarios y tiempo de preparación pendientes de confirmación.",
    linkLabel: "Información pendiente",
  },
  {
    icon: "credit-card",
    title: "Medios de pago",
    text: "Hasta 3 cuotas sin interés los miércoles y sábados. El checkout online todavía no procesa cobros.",
    linkLabel: "Ver modalidad",
  },
  {
    icon: "package-check",
    title: "Estado y cuidado",
    text: "Las condiciones de cambios, roturas y faltantes se informarán aquí.",
    linkLabel: "Política pendiente",
  },
];