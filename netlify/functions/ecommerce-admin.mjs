import { requireFirebaseAdmin } from "./_lib/firebaseAuth.mjs";
import {
  adminGetDocument,
  adminListDocuments,
} from "./_lib/firestoreAdminRest.mjs";
import {
  configureWebChannel,
  manageWebOrder,
} from "./_lib/ecommerce/orderManagement.mjs";
import { publicEcommerceError } from "./_lib/ecommerce/publicError.mjs";
import { originStockPath } from "./_lib/ecommerce/channelService.mjs";
import { reservedStockQuantity } from "../../src/shared/stockReservations.mjs";
import { canAccessAdministration } from "../../src/gestion/permissions.js";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false }, 405);
  try {
    const session = await requireFirebaseAdmin(request),
      body = await request.json();
    let result;
    if (body.mode === "resources") {
      const [channel, locations, warehouses, orders, sales, users] =
        await Promise.all([
          adminGetDocument("channels/ecommerce"),
          adminListDocuments("locations"),
          adminListDocuments("warehouses"),
          adminListDocuments("orders"),
          adminListDocuments("sales"),
          adminListDocuments("users"),
        ]);
      result = {
        channel: channel?.data || null,
        locations: locations.filter(
          (row) => row.active !== false && row.deleted !== true,
        ),
        warehouses: warehouses.filter(
          (row) => row.active !== false && row.deleted !== true,
        ),
        users: users
          .filter((row) => row.active === true && canAccessAdministration(row))
          .map((row) => ({ id: row.id, name: row.name })),
        orders: orders.filter((row) => row.sourceType === "ecommerce"),
        sales: sales.filter((row) => row.sourceType === "ecommerce"),
      };
    } else if (body.mode === "availability") {
      const order = /^ecommerce_order_[A-Za-z0-9_-]{8,96}$/.test(
        body.orderId || "",
      )
        ? (await adminGetDocument(`orders/${body.orderId}`))?.data
        : null;
      const channel = (await adminGetDocument("channels/ecommerce"))?.data;
      if (!order || !channel)
        return json(
          { ok: false, message: "Pedido o canal no disponible." },
          409,
        );
      result = await Promise.all(
        channel.authorizedOrigins.map(async (origin) => {
          const source = (
            await adminGetDocument(
              `${origin.type === "warehouse" ? "warehouses" : "locations"}/${origin.id}`,
            )
          )?.data;
          return {
            ...origin,
            name: source?.name || origin.id,
            availability: await Promise.all(
              order.items.map(async (item) => {
                const stock = (
                  await adminGetDocument(
                    originStockPath(origin, item.productId),
                  )
                )?.data;
                return {
                  name: item.name,
                  required: item.quantity,
                  available: stock
                    ? Math.max(
                        0,
                        stock.currentStock -
                          reservedStockQuantity(
                            stock,
                            new Date(),
                            body.orderId,
                          ),
                      )
                    : 0,
                };
              }),
            ),
          };
        }),
      );
    } else if (body.mode === "configure")
      result = await configureWebChannel({ body, session });
    else result = await manageWebOrder({ body, session });
    return json({ ok: true, result });
  } catch (error) {
    const safe = publicEcommerceError(error);
    if (error.code === "ecommerce-management-blocked")
      safe.message = error.message;
    return json({ ok: false, ...safe }, safe.status);
  }
}
