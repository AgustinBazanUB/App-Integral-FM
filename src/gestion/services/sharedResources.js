import { doc, getDoc } from "firebase/firestore";
import { normalizedRole } from "../permissions";
import { listActiveCustomerZones } from "./customerService";
import { db } from "./firebase";
import {
  listAssignableSellers,
  listDiscounts,
  listMasterProducts,
  listProductCategories,
} from "./locationManagementService";
import { listLocations } from "./managementService";
import {
  getRuntimeCachedValue,
  invalidateRuntimeCache,
  withRuntimeCache,
} from "./runtimeCache";

const profileScope = (profile) => [
  profile?.id || "anonymous",
  normalizedRole(profile),
  [...new Set(profile?.allowedLocationIds || [])].sort().join(","),
].join("|");

const locationsKey = (profile) => `locations:${profileScope(profile)}`;
const sellerResourcesKey = (profile) => `seller-resources:${profileScope(profile)}`;

export const getLocationsSharedCached = (profile) =>
  getRuntimeCachedValue(locationsKey(profile));

export const getSellerResourcesSharedCached = (profile) =>
  getRuntimeCachedValue(sellerResourcesKey(profile));

export const listLocationsShared = (profile) => withRuntimeCache(
  locationsKey(profile),
  () => listLocations(profile),
  30_000,
);

export const listProductCategoriesShared = (profile) => withRuntimeCache(
  `categories:${profileScope(profile)}`,
  () => listProductCategories(profile),
  90_000,
);

export const listDiscountsShared = (profile) => withRuntimeCache(
  `discounts:${profileScope(profile)}`,
  () => listDiscounts(profile),
  60_000,
);

export const listMasterProductsShared = (profile) => withRuntimeCache(
  `products:${profileScope(profile)}`,
  () => listMasterProducts(profile),
  60_000,
);

export const listAssignableSellersShared = (profile) => withRuntimeCache(
  `sellers:${profileScope(profile)}`,
  () => listAssignableSellers(),
  60_000,
);

export const loadSellerResourcesShared = (profile) => withRuntimeCache(
  sellerResourcesKey(profile),
  async () => {
    const [categories, discounts, shortcutsSnapshot, zones] = await Promise.all([
      listProductCategoriesShared(profile),
      listDiscountsShared(profile),
      getDoc(doc(db, "settings", "keyboardShortcuts")),
      listActiveCustomerZones(),
    ]);
    return {
      categories,
      discounts,
      zones,
      shortcuts: shortcutsSnapshot.exists() ? shortcutsSnapshot.data() : { sellerActions: {} },
    };
  },
  60_000,
);

export function invalidateSharedLocations() {
  invalidateRuntimeCache("locations:");
}

export function invalidateSharedProducts() {
  invalidateRuntimeCache("products:");
}

export function invalidateSharedCategories() {
  invalidateRuntimeCache("categories:");
  invalidateRuntimeCache("seller-resources:");
}

export function invalidateSharedDiscounts() {
  invalidateRuntimeCache("discounts:");
  invalidateRuntimeCache("seller-resources:");
}

export function invalidateSharedSellers() {
  invalidateRuntimeCache("sellers:");
}

export function invalidateSellerResources() {
  invalidateRuntimeCache("seller-resources:");
}

export function invalidateSharedResources() {
  invalidateSharedLocations();
  invalidateSharedProducts();
  invalidateSharedCategories();
  invalidateSharedDiscounts();
  invalidateSharedSellers();
  invalidateSellerResources();
}
