import App from "../App";
import { CartProvider } from "../context/CartContext";

export default function UnifiedSurface() {
  return (
    <CartProvider>
      <App />
    </CartProvider>
  );
}
