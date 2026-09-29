import Storefront from "../Storefront";
import { CartProvider } from "../context/CartContext";

export default function EcommerceSurface() {
  return (
    <CartProvider>
      <Storefront />
    </CartProvider>
  );
}
