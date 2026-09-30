import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { productById, productsByOccasion } from "../data/products";
import ProductCard from "./ProductCard";

const defaultOccasions = [
  {
    id: "picada",
    label: "Para una picada",
    description: "Aceites, aceitunas, frutos secos y sales.",
    productIds: productsByOccasion.picada,
  },
  {
    id: "breakfast",
    label: "Para desayuno o merienda",
    description: "Mermeladas y frutos secos.",
    productIds: productsByOccasion.breakfast,
  },
  {
    id: "gift",
    label: "Para regalar",
    description: "Una selección individual; no es un pack comercial.",
    productIds: productsByOccasion.gift,
  },
  {
    id: "everyday",
    label: "Para todos los días",
    description: "Productos versátiles para la compra cotidiana.",
    productIds: productsByOccasion.everyday,
  },
];

export default function OccasionBuilder({
  occasions = defaultOccasions,
  note = "Agregá cada producto por separado. Precios, stock y formatos siguen pendientes de confirmación.",
}) {
  const [occasionId, setOccasionId] = useState(occasions[0]?.id);
  const selectedOccasion =
    occasions.find((occasion) => occasion.id === occasionId) ?? occasions[0];
  const selectedProducts = useMemo(
    () =>
      (selectedOccasion?.productIds ?? [])
        .map((productId) => productById[productId])
        .filter(Boolean),
    [selectedOccasion],
  );

  if (!selectedOccasion) return null;

  return (
    <div className="occasion-builder">
      <div className="occasion-selector" role="tablist" aria-label="Elegir ocasión">
        {occasions.map((occasion) => (
          <button
            type="button"
            role="tab"
            aria-selected={occasion.id === selectedOccasion.id}
            className={occasion.id === selectedOccasion.id ? "is-selected" : ""}
            onClick={() => setOccasionId(occasion.id)}
            key={occasion.id}
          >
            <span>
              {occasion.id === selectedOccasion.id ? (
                <Check size={16} aria-hidden="true" />
              ) : null}
              {occasion.label}
            </span>
            {occasion.description ? <small>{occasion.description}</small> : null}
          </button>
        ))}
      </div>

      <div className="occasion-result" role="tabpanel">
        <header>
          <p className="eyebrow">SELECCIÓN CONFIGURABLE</p>
          <h3>{selectedOccasion.label}</h3>
          <p>{note}</p>
        </header>
        <div className="product-row product-row--compact">
          {selectedProducts.map((product) => (
            <ProductCard product={product} compact key={product.id} />
          ))}
        </div>
      </div>
    </div>
  );
}
