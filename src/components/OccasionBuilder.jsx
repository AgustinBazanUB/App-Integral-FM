import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { productById, productsByOccasion } from "../data/products";
import ProductCard from "./ProductCard";

const occasions = [
  {
    id: "picada",
    label: "Para una picada",
    description: "Aceites, aceitunas, frutos secos y sales.",
  },
  {
    id: "breakfast",
    label: "Para desayuno o merienda",
    description: "Mermeladas y frutos secos.",
  },
  {
    id: "gift",
    label: "Para regalar",
    description: "Una selección individual; no es un pack comercial.",
  },
  {
    id: "everyday",
    label: "Para todos los días",
    description: "Productos versátiles para la compra cotidiana.",
  },
];

export default function OccasionBuilder() {
  const [occasionId, setOccasionId] = useState("picada");
  const selectedOccasion = occasions.find(
    (occasion) => occasion.id === occasionId,
  );
  const selectedProducts = useMemo(
    () =>
      productsByOccasion[occasionId]
        .map((productId) => productById[productId])
        .filter(Boolean),
    [occasionId],
  );

  return (
    <div className="occasion-builder">
      <div className="occasion-selector" role="tablist" aria-label="Elegir ocasión">
        {occasions.map((occasion) => (
          <button
            type="button"
            role="tab"
            aria-selected={occasion.id === occasionId}
            className={occasion.id === occasionId ? "is-selected" : ""}
            onClick={() => setOccasionId(occasion.id)}
            key={occasion.id}
          >
            <span>
              {occasion.id === occasionId ? (
                <Check size={16} aria-hidden="true" />
              ) : null}
              {occasion.label}
            </span>
            <small>{occasion.description}</small>
          </button>
        ))}
      </div>

      <div className="occasion-result" role="tabpanel">
        <header>
          <p className="eyebrow">SELECCIÓN CONFIGURABLE</p>
          <h3>{selectedOccasion.label}</h3>
          <p>
            Agregá cada producto por separado. Precios, stock y formatos siguen
            pendientes de confirmación.
          </p>
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
