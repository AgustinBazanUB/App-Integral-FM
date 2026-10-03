import { Toast } from "../../design-system";

export default function SaleStockWarning({ discrepancies = [] }) {
  if (!discrepancies.length) return null;
  return <Toast tone="warning"><div>
    <strong>Stock registrado insuficiente</strong>
    <p>Si tenés la mercadería física, podés continuar con la venta. El saldo negativo indica que hay que revisar y corregir el inventario.</p>
    <ul>{discrepancies.map(item => <li key={item.productId}>{item.name}: disponible {item.previousStock} · Quedará {item.newStock}</li>)}</ul>
  </div></Toast>;
}
