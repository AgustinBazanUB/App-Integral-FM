import { requireFirebaseAdmin } from "./_lib/firebaseAuth.mjs";
import {
  adminGetDocument,
  adminListDocuments,
} from "./_lib/firestoreAdminRest.mjs";
import {
  configureWebChannel,
  configureWebProduct,
  configureWebPromotion,
  manageWebOrder,
} from "./_lib/ecommerce/orderManagement.mjs";
import { publicEcommerceError } from "./_lib/ecommerce/publicError.mjs";
import {
  channelIncludesOrigin,
  isActiveWebStock,
  originStockPath,
  physicalStockOrigins,
  resolveChannelOrigins,
  stockCollectionPath,
  webStockAvailability,
} from "./_lib/ecommerce/channelService.mjs";
import { reservedStockQuantity } from "../../src/shared/stockReservations.mjs";
import { canAccessAdministration } from "../../src/gestion/permissions.js";
import { processPaywayPayment } from "./_lib/ecommerce/paywayService.mjs";
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
      const [channel, locations, warehouses, orders, sales, users, products, categories, productSettings, promotions] =
        await Promise.all([
          adminGetDocument("channels/ecommerce"),
          adminListDocuments("locations"),
          adminListDocuments("warehouses"),
          adminListDocuments("orders"),
          adminListDocuments("sales"),
          adminListDocuments("users"),
          adminListDocuments("products"),
          adminListDocuments("productCategories"),
          adminListDocuments("ecommerceProductSettings"),
          adminListDocuments("ecommercePromotions"),
        ]);
      const now = new Date();
      const stockOrigins = physicalStockOrigins(locations, warehouses, now);
      const activeProducts = products
        .filter((row) => row.active !== false && row.deleted !== true)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
      const stockRowsByOrigin = await Promise.all(stockOrigins.map(async (origin) => {
        const rows = await adminListDocuments(stockCollectionPath(origin), { maxDocuments: 5000 });
        return rows.map((row) => ({
          productId: row.id,
          type: origin.type,
          originId: origin.id,
          originName: origin.name || origin.id,
          currentStock: Number(row.currentStock) || 0,
          reservedStock: reservedStockQuantity(row, now),
          active: isActiveWebStock(row),
        }));
      }));
      const stockByProduct = {};
      for (const row of stockRowsByOrigin.flat()) {
        if (!stockByProduct[row.productId]) stockByProduct[row.productId] = [];
        stockByProduct[row.productId].push(row);
      }
      result = {
        channel: channel?.data || null,
        locations: stockOrigins.filter((row) => row.type === "location" && row.locationType === "store"),
        warehouses: stockOrigins.filter((row) => row.type === "warehouse"),
        users: users
          .filter((row) => row.active === true && canAccessAdministration(row))
          .map((row) => ({ id: row.id, name: row.name })),
        products: activeProducts,
        categories: categories.filter((row) => row.active !== false && row.deleted !== true),
        productSettings: Object.fromEntries(productSettings.map((row) => [row.productId || row.id, row])),
        promotions: Object.fromEntries(promotions.map((row) => [row.productId || row.id, row])),
        stockOrigins,
        configuredStockOrigins: channel?.data
          ? stockOrigins.filter((row) => channelIncludesOrigin(channel.data, row))
          : [],
        stockByProduct,
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
      const now = new Date();
      const origins = await resolveChannelOrigins(channel, { now });
      result = await Promise.all(
        origins.map(async (origin) => {
          return {
            ...origin,
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
                  available: webStockAvailability(stock, now, body.orderId),
                };
              }),
            ),
          };
        }),
      );
    } else if (body.mode === "payway-reconcile")
      result = await processPaywayPayment({ body: { mode: "reconcile", orderId: body.orderId }, adminActor: session });
    else if (body.mode === "configure")
      result = await configureWebChannel({ body, session });
    else if (body.mode === "save-product")
      result = await configureWebProduct({ body, session });
    else if (body.mode === "save-promotion")
      result = await configureWebPromotion({ body, session });
    else result = await manageWebOrder({ body, session });
    return json({ ok: true, result });
  } catch (error) {
    const safe = publicEcommerceError(error);
    if (error.code === "ecommerce-management-blocked")
      safe.message = error.message;
    return json({ ok: false, ...safe }, safe.status);
  }
}
