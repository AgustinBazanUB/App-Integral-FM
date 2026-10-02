import App from "../App";
import { CartProvider } from "../context/CartContext";
import { CommerceCatalogProvider } from "../context/CommerceCatalogContext";

export default function UnifiedSurface() {
  return (
    <CommerceCatalogProvider>
      <CartProvider>
        <App />
      </CartProvider>
    </CommerceCatalogProvider>
  );
}
