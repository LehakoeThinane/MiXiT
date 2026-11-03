import { Platform } from 'react-native';
import Purchases, { PRODUCT_CATEGORY, type PurchasesStoreProduct } from 'react-native-purchases';

// Native in-app purchases (App Store 3.1.1 / Google Play Payments policy) via
// RevenueCat. RevenueCat validates receipts with Apple/Google and notifies the
// backend webhook (POST /payments/revenuecat/webhook), which grants access.
// PayFast remains for the web build only.

const API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
  default: undefined,
});

export const isStoreBillingPlatform = Platform.OS === 'ios' || Platform.OS === 'android';
export const isStoreBillingConfigured = isStoreBillingPlatform && Boolean(API_KEY);

let configuredForUser: string | null = null;

/** Configures RevenueCat (once) and makes sure purchases are attributed to our user id. */
export async function ensurePurchasesUser(userId: string): Promise<void> {
  if (!isStoreBillingConfigured || !API_KEY) return;
  if (configuredForUser === null) {
    Purchases.configure({ apiKey: API_KEY, appUserID: userId });
    configuredForUser = userId;
    return;
  }
  if (configuredForUser !== userId) {
    await Purchases.logIn(userId);
    configuredForUser = userId;
  }
}

export async function resetPurchasesUser(): Promise<void> {
  if (configuredForUser === null) return;
  try {
    await Purchases.logOut();
  } catch {
    // logOut throws for anonymous users — nothing to reset.
  }
  configuredForUser = null;
}

/** Store products keyed by their base store product id (Android ids carry a ":basePlan" suffix). */
export async function getStoreProducts(storeProductIds: string[]): Promise<Map<string, PurchasesStoreProduct>> {
  const result = new Map<string, PurchasesStoreProduct>();
  if (!isStoreBillingConfigured || storeProductIds.length === 0) return result;

  const [subscriptions, oneOff] = await Promise.all([
    Purchases.getProducts(storeProductIds, PRODUCT_CATEGORY.SUBSCRIPTION),
    Purchases.getProducts(storeProductIds, PRODUCT_CATEGORY.NON_SUBSCRIPTION),
  ]);
  for (const product of [...subscriptions, ...oneOff]) {
    const baseId = product.identifier.split(':')[0];
    if (!result.has(baseId)) result.set(baseId, product);
  }
  return result;
}

/** Returns false if the user cancelled the store sheet. */
export async function purchaseStoreProduct(product: PurchasesStoreProduct): Promise<boolean> {
  try {
    await Purchases.purchaseStoreProduct(product);
    return true;
  } catch (error) {
    if ((error as { userCancelled?: boolean })?.userCancelled) return false;
    throw error;
  }
}

export async function restoreStorePurchases(): Promise<void> {
  await Purchases.restorePurchases();
}

export async function getManageSubscriptionsUrl(): Promise<string> {
  if (isStoreBillingConfigured) {
    try {
      const info = await Purchases.getCustomerInfo();
      if (info.managementURL) return info.managementURL;
    } catch {
      // fall through to the platform default
    }
  }
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}

/** e.g. "per month" for P1M — shown next to the price as required for subscriptions. */
export function describeSubscriptionPeriod(period: string | null | undefined): string {
  switch (period) {
    case 'P1W':
      return 'per week';
    case 'P1M':
      return 'per month';
    case 'P3M':
      return 'every 3 months';
    case 'P6M':
      return 'every 6 months';
    case 'P1Y':
      return 'per year';
    default:
      return 'per month';
  }
}
