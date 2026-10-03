import Storefront from "../Storefront";
import { CartProvider } from "../context/CartContext";
import { CommerceCatalogProvider } from "../context/CommerceCatalogContext";

export default function EcommerceSurface() {
  return (
    <CommerceCatalogProvider>
      <CartProvider>
        <Storefront />
      </CartProvider>
    </CommerceCatalogProvider>
  );
}
