import {
  listLocations,
} from "./managementService";
import {
  listAssignableSellers,
  listDiscounts,
  listMasterProducts,
  listProductCategories,
} from "./locationManagementService";
import { invalidateRuntimeCache, withRuntimeCache } from "./runtimeCache";
import { normalizedRole } from "../permissions";

const profileScope = (profile) => [
  profile?.id || "anonymous",
  normalizedRole(profile),
  [...new Set(profile?.allowedLocationIds || [])].sort().join(","),
].join("|");

export const listLocationsShared = (profile) => withRuntimeCache(
  `locations:${profileScope(profile)}`,
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

export function invalidateSharedLocations() {
  invalidateRuntimeCache("locations:");
}

export function invalidateSharedProducts() {
  invalidateRuntimeCache("products:");
}

export function invalidateSharedCategories() {
  invalidateRuntimeCache("categories:");
}

export function invalidateSharedDiscounts() {
  invalidateRuntimeCache("discounts:");
}

export function invalidateSharedSellers() {
  invalidateRuntimeCache("sellers:");
}

export function invalidateSharedResources() {
  invalidateSharedLocations();
  invalidateSharedProducts();
  invalidateSharedCategories();
  invalidateSharedDiscounts();
  invalidateSharedSellers();
}
