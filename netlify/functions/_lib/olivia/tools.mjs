import {
  OLIVIA_TOOL_SCHEMAS,
  validateSchema,
  oliviaError,
} from "../../../../src/shared/oliviaContracts.mjs";
import {
  assertCapability,
  capabilities,
  userContext,
  permittedLocations,
  permittedLocation,
  resolveLocation,
  navigationFor,
  sellerProfile,
} from "./guards.mjs";
import { effectiveLocationPrice } from "../../../../src/modules/inventory/domain/inventory.js";
import { isDiscountAvailable } from "../../../../src/modules/locations/domain/dashboard.js";
import {
  argentinaDateKey,
  argentinaStartOfDay,
  argentinaParts,
  addArgentinaDays,
} from "../../../../src/modules/locations/domain/time.js";
import { prepareOperation } from "./operations.mjs";
import { OLIVIA_CAPABILITIES, selectCapabilities } from "../../../../src/shared/oliviaCapabilities.mjs";
import { runExtendedTool } from "./extendedTools.mjs";
const descriptions = {
  get_current_user_context:
    "Permisos y capacidades actuales del usuario autenticado, sin credenciales.",
  list_locations:
    "Ubicaciones activas permitidas. No devuelve ubicaciones ajenas.",
  search_products:
    "Buscar por comienzo del nombre en catálogo/local, devuelve IDs, precio y stock. Query vacío lista hasta 30; límite declarado.",
  get_stock:
    "Stock y precio actuales de un producto autorizado en una ubicación.",
  get_promotions:
    "Descuentos y promociones vigentes disponibles en la ubicación. Aplicabilidad a carrito se revalida al preparar venta.",
  get_today_sales:
    "Ventas de HOY del propio usuario en la ubicación, máximo 150; sin datos de otros vendedores ni historia.",
  navigate_to_module:
    "Abrir pantalla permitida sin modificar datos. Vendedor sale/sales/pending/stock/prices/help; administrador IDs reales de módulos.",
  prepare_sale:
    "Preparar venta con precios vivos y reglas del Panel Vendedor. Requiere decisiones explícitas sobre promoción, factura y cliente. NO ejecuta. Para correcciones enviar propuesta completa nueva.",
  prepare_stock_load:
    "Preparar ingreso positivo de stock en ubicación activa para administrador autorizado. El motivo es opcional: usá reason null si no se indicó, sin pedirlo como dato faltante. NO ejecuta, pide tarjeta de confirmación.",
};
export function toolDefinitions(session, { query, context = {}, required = [], loaded = [] } = {}) {
  const selected = query === undefined ? null : new Set([...selectCapabilities(session, query, context, required), ...loaded]);
  return capabilities(session).filter((name) => !selected || !OLIVIA_CAPABILITIES[name] || selected.has(name)).map((name) => ({
    type: "function",
    name,
    description: descriptions[name] || OLIVIA_CAPABILITIES[name]?.description,
    strict: true,
    parameters: OLIVIA_TOOL_SCHEMAS[name] || OLIVIA_CAPABILITIES[name]?.parameters,
  }));
}
const publicStock = (product, item, location) => ({
  productId: product.id,
  name: product.name || item.productName,
  locationId: location.id,
  locationName: location.name,
  price: effectiveLocationPrice(product, item),
  currentStock: Number(item.currentStock || 0),
  observedAt: new Date().toISOString(),
});
async function liveProduct(session, args, store, context) {
  const locationId = await resolveLocation(
      session,
      args.locationId,
      context,
      store,
    ),
    location = await permittedLocation(session, locationId, store),
    product = await store.get(`products/${args.productId}`),
    item = await store.get(
      `locationStock/${locationId}/items/${args.productId}`,
    );
  if (
    !product ||
    product.active === false ||
    product.deleted ||
    !item ||
    item.active === false ||
    item.deleted ||
    item.productDeleted
  )
    throw oliviaError(
      "product-unavailable",
      "El producto no está habilitado en esta ubicación.",
      409,
    );
  return publicStock(product, item, location);
}
export async function runTool({
  session,
  name,
  args,
  store,
  context,
  now = new Date(),
  provider,
  env,
}) {
  const liveProfile = await store.get(`users/${session.uid}`);
  if (!liveProfile)
    throw oliviaError(
      "unauthenticated",
      "Tu perfil ya no está disponible.",
      401,
    );
  session = { ...session, profile: { ...liveProfile, id: session.uid } };
  assertCapability(session, name);
  validateSchema(args, OLIVIA_TOOL_SCHEMAS[name] || OLIVIA_CAPABILITIES[name]?.parameters);
  if (OLIVIA_CAPABILITIES[name]) return runExtendedTool({ session, name, args, store, context, now, provider, env });
  if (name === "get_current_user_context")
    return { data: userContext(session) };
  if (name === "list_locations")
    return {
      data: { locations: await permittedLocations(session, store), limit: 100 },
    };
  if (name === "navigate_to_module") {
    const navigation = navigationFor(session, args);
    if (args.entityId && args.module === "locations")
      await permittedLocation(session, args.entityId, store);
    return { navigation, data: { navigation } };
  }
  if (name === "get_stock")
    return { data: await liveProduct(session, args, store, context) };
  if (name === "search_products") {
    if (
      !args.locationId &&
      !context.locationId &&
      !sellerProfile(session.profile)
    ) {
      // Global product names/prices are exposed only through a global product permission.
      const { can } = await import("../../../../src/gestion/permissions.js");
      if (!can(session.profile, "products", "view"))
        throw oliviaError(
          "permission-denied",
          "Elegí una ubicación permitida.",
          403,
        );
      const q = args.query.trim();
      const variants = [
        ...new Set([q, q.charAt(0).toLocaleUpperCase("es") + q.slice(1)]),
      ];
      const result = [];
      for (const prefix of variants) {
        const docs = await store.query(
          "products",
          prefix
            ? [
                ["name", "GREATER_THAN_OR_EQUAL", prefix],
                ["name", "LESS_THAN_OR_EQUAL", `${prefix}\uf8ff`],
              ]
            : [],
          30,
        );
        for (const p of docs)
          if (!p.deleted && p.active !== false)
            result.push({
              productId: p.id,
              name: p.name,
              defaultPrice: p.defaultPrice,
            });
      }
      return {
        data: {
          products: [
            ...new Map(result.map((p) => [p.productId, p])).values(),
          ].slice(0, 30),
          limit: 30,
          search: "prefix",
        },
      };
    }
    const locationId = await resolveLocation(
        session,
        args.locationId,
        context,
        store,
      ),
      location = await permittedLocation(session, locationId, store, {
        action: "viewLocationProducts",
      }),
      q = args.query.trim();
    const variants = [
      ...new Set([q, q.charAt(0).toLocaleUpperCase("es") + q.slice(1)]),
    ];
    const items = [];
    for (const prefix of variants)
      items.push(
        ...(await store.query(
          `locationStock/${locationId}/items`,
          prefix
            ? [
                ["productName", "GREATER_THAN_OR_EQUAL", prefix],
                ["productName", "LESS_THAN_OR_EQUAL", `${prefix}\uf8ff`],
              ]
            : [],
          30,
        )),
      );
    const unique = [...new Map(items.map((i) => [i.id, i])).values()]
      .filter((i) => !i.deleted && i.active !== false && !i.productDeleted)
      .slice(0, 30);
    const products = await Promise.all(
      unique.map(async (item) => {
        const p = await store.get(`products/${item.id}`);
        return p && !p.deleted && p.active !== false
          ? publicStock(p, item, location)
          : null;
      }),
    );
    return {
      data: { products: products.filter(Boolean), limit: 30, search: "prefix" },
    };
  }
  if (name === "get_promotions") {
    const locationId = await resolveLocation(
        session,
        args.locationId,
        context,
        store,
      ),
      location = await permittedLocation(session, locationId, store);
    const discounts = Array.isArray(location.enabledDiscountIds)
      ? await Promise.all(
          location.enabledDiscountIds
            .slice(0, 30)
            .map((id) => store.get(`discounts/${id}`)),
        )
      : await store.query("discounts", [], 30);
    return {
      data: {
        discounts: discounts
          .filter(
            (d) =>
              d &&
              isDiscountAvailable(
                { ...d, productIds: [], categoryIds: [] },
                location,
                now,
                { profile: session.profile, items: [] },
              ),
          )
          .map((d) => ({
            discountId: d.id,
            name: d.name,
            type: d.type,
            value: d.value,
            productIds: d.productIds || [],
            categoryIds: d.categoryIds || [],
            minimumQuantity: d.minimumQuantity || null,
            requiresCartValidation: true,
          })),
        limit: 30,
        observedAt: now.toISOString(),
      },
    };
  }
  if (name === "get_today_sales") {
    const locationId = await resolveLocation(
      session,
      args.locationId,
      context,
      store,
    );
    const parts = argentinaParts(now),
      start = argentinaStartOfDay(parts.year, parts.month, parts.day),
      end = addArgentinaDays(start, 1);
    const sales = await store.query(
      "sales",
      [
        ["locationId", "EQUAL", locationId],
        ["sellerId", "EQUAL", session.uid],
        ["createdAt", "GREATER_THAN_OR_EQUAL", start],
        ["createdAt", "LESS_THAN", end],
      ],
      150,
      [["createdAt", "DESCENDING"]],
    );
    const active = sales.filter((s) => s.status === "active" && !s.deleted);
    return {
      data: {
        date: argentinaDateKey(now),
        locationId,
        count: active.length,
        total: active.reduce((sum, s) => sum + Number(s.total || 0), 0),
        limit: 150,
        partial: sales.length === 150,
        sales: active
          .slice(0, 30)
          .map((s) => ({
            saleId: s.id,
            saleCode: s.saleCode,
            total: s.total,
            paymentMethod: s.paymentMethod,
            payments: s.payments,
            createdAt: s.createdAt,
          })),
        observedAt: now.toISOString(),
      },
    };
  }
  if (name.startsWith("prepare_")) {
    const effective = { ...args };
    if (!effective.locationId) {
      try {
        effective.locationId = await resolveLocation(
          session,
          null,
          context,
          store,
        );
      } catch (e) {
        if (e.code !== "location-required") throw e;
        return {
          state: "DATOS_INCOMPLETOS",
          data: { missing: ["locationId"], message: e.message },
        };
      }
    }
    if (
      name === "prepare_stock_load" &&
      !effective.productId &&
      context.productId
    )
      effective.productId = context.productId;
    const prepared = await prepareOperation({
      session,
      args: effective,
      toolName: name,
      store,
      now,
    });
    return prepared.canonicalArgs
      ? {
          prepared,
          data: { state: "ESPERANDO_CONFIRMACION", summary: prepared.summary },
        }
      : { state: prepared.state || "DATOS_INCOMPLETOS", data: prepared };
  }
  throw oliviaError("permission-denied", "Herramienta no habilitada.", 403);
}
