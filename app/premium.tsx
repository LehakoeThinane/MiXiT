import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { openLegalPage } from '@/lib/legal';
import { getMyPurchases, getProducts, startCheckout, type Product, type Purchase } from '@/lib/payments-api';
import {
  describeSubscriptionPeriod,
  ensurePurchasesUser,
  getManageSubscriptionsUrl,
  getStoreProducts,
  isStoreBillingConfigured,
  isStoreBillingPlatform,
  purchaseStoreProduct,
  restoreStorePurchases,
} from '@/lib/purchases';
import { useAuthStore } from '@/stores/auth-store';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Payment pending',
  active: 'Active',
  failed: 'Payment failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

const storeName = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
const storeAccount = Platform.OS === 'ios' ? 'Apple ID' : 'Google Play account';

function formatUntil(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusText(purchase: Purchase) {
  const until = formatUntil(purchase.expiresAt);
  if (purchase.status === 'active' && until) {
    if (purchase.productType === 'subscription' && purchase.cancelledAt) return `Active until ${until} · won't renew`;
    return purchase.productType === 'subscription' && purchase.source === 'store'
      ? `Active · renews ${until}`
      : `Active until ${until}`;
  }
  return STATUS_LABEL[purchase.status] ?? purchase.status;
}

export default function PremiumScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const productsQuery = useQuery({ queryKey: ['products'], queryFn: getProducts, staleTime: 5 * 60_000 });
  const purchasesQuery = useQuery({ queryKey: ['purchases'], queryFn: getMyPurchases, staleTime: 15_000 });

  const storeProductIds = (productsQuery.data ?? [])
    .map((product) => product.storeProductId)
    .filter((id): id is string => Boolean(id));

  const storeProductsQuery = useQuery({
    queryKey: ['store-products', userId, storeProductIds.join(',')],
    enabled: isStoreBillingConfigured && Boolean(userId) && storeProductIds.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      await ensurePurchasesUser(userId as string);
      return getStoreProducts(storeProductIds);
    },
  });

  // The webhook from RevenueCat usually lands within a few seconds of a purchase.
  const refreshPurchasesSoon = () => {
    queryClient.invalidateQueries({ queryKey: ['purchases'] });
    [3_000, 8_000, 15_000].forEach((ms) =>
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['purchases'] }), ms)
    );
  };

  const purchaseFor = (slug: string) =>
    purchasesQuery.data?.purchases.find((p) => p.productSlug === slug && (p.status === 'active' || p.status === 'pending'));

  const storeProductFor = (product: Product) =>
    product.storeProductId ? storeProductsQuery.data?.get(product.storeProductId) ?? null : null;

  const handleStoreBuy = async (product: Product) => {
    if (!isStoreBillingConfigured || !userId) {
      Alert.alert('Purchases unavailable', 'In-app purchases are not available right now. Please try again later.');
      return;
    }
    const storeProduct = storeProductFor(product);
    if (!storeProduct) {
      Alert.alert('Not available', `${product.name} isn't available from the ${storeName} right now.`);
      return;
    }
    setBusySlug(product.slug);
    try {
      await ensurePurchasesUser(userId);
      const completed = await purchaseStoreProduct(storeProduct);
      if (completed) {
        refreshPurchasesSoon();
        Alert.alert('Purchase complete', `${product.name} will be active in a few seconds.`);
      }
    } catch (error) {
      Alert.alert('Purchase failed', error instanceof Error ? error.message : 'Try again');
    } finally {
      setBusySlug(null);
    }
  };

  // Web only — PayFast hosted checkout. Native builds must use store billing.
  const handleWebBuy = async (product: Product) => {
    setBusySlug(product.slug);
    try {
      const checkoutUrl = await startCheckout(product.slug);
      const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, 'mixit://payments/return');
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
      if (result.type === 'success') {
        Alert.alert('Payment submitted', "We're confirming it with PayFast — this can take a few seconds.");
      }
    } catch (error) {
      Alert.alert('Checkout failed', error instanceof Error ? error.message : 'Try again');
    } finally {
      setBusySlug(null);
    }
  };

  const handleBuy = (product: Product) => (isStoreBillingPlatform ? handleStoreBuy(product) : handleWebBuy(product));

  const handleManageSubscription = async () => {
    const url = await getManageSubscriptionsUrl();
    Linking.openURL(url).catch(() => Alert.alert('Could not open', `Open your ${storeName} subscription settings.`));
  };

  const handleRestore = async () => {
    if (!isStoreBillingConfigured || !userId) return;
    setIsRestoring(true);
    try {
      await ensurePurchasesUser(userId);
      await restoreStorePurchases();
      refreshPurchasesSoon();
      Alert.alert('Purchases restored', 'Any active purchases on this account will show here shortly.');
    } catch (error) {
      Alert.alert('Restore failed', error instanceof Error ? error.message : 'Try again');
    } finally {
      setIsRestoring(false);
    }
  };

  const isLoading = productsQuery.isLoading || (isStoreBillingConfigured && storeProductsQuery.isLoading);

  return (
    <SafeAreaView style={styles.container}>
      <LiquidBackdrop />
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>MiXiT Premium</Text>
        <View style={styles.backBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#ff6b35" />
        </View>
      ) : productsQuery.isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Couldn&apos;t load products</Text>
          <Pressable style={styles.retryBtn} onPress={() => productsQuery.refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {isStoreBillingPlatform && !isStoreBillingConfigured ? (
            <Text style={styles.noticeText}>In-app purchases aren&apos;t available in this build yet.</Text>
          ) : null}

          {(productsQuery.data ?? []).map((product) => {
            const purchase = purchaseFor(product.slug);
            const storeProduct = storeProductFor(product);
            const isBusy = busySlug === product.slug;
            const isSubscription = product.type === 'subscription';
            const period = isSubscription ? describeSubscriptionPeriod(storeProduct?.subscriptionPeriod) : null;
            const priceLabel = isStoreBillingPlatform
              ? storeProduct
                ? `${storeProduct.priceString}${period ? ` ${period}` : ''}`
                : null
              : `${product.price}${isSubscription ? ' for 30 days' : ''}`;
            const unavailable = isStoreBillingPlatform && !storeProduct;
            const isActive = purchase?.status === 'active';

            return (
              <View key={product.id} style={styles.card}>
                <Text style={styles.productName}>{product.name}</Text>
                {product.description ? <Text style={styles.productDescription}>{product.description}</Text> : null}
                {priceLabel ? <Text style={styles.productPrice}>{priceLabel}</Text> : null}

                {purchase ? (
                  <View style={styles.statusRow}>
                    <View style={[styles.statusDot, isActive && styles.statusDotActive]} />
                    <Text style={styles.statusText}>{statusText(purchase)}</Text>
                  </View>
                ) : null}

                {isActive && isSubscription && purchase?.source === 'store' ? (
                  <Pressable style={[styles.actionBtn, styles.cancelBtn]} onPress={handleManageSubscription}>
                    <Text style={styles.cancelBtnText}>Manage subscription</Text>
                  </Pressable>
                ) : isActive ? null : (
                  <Pressable
                    style={[styles.actionBtn, styles.buyBtn, (unavailable || purchase?.status === 'pending') && styles.buyBtnDisabled]}
                    disabled={isBusy || unavailable || purchase?.status === 'pending'}
                    onPress={() => handleBuy(product)}>
                    {isBusy ? (
                      <ActivityIndicator color="#111524" />
                    ) : (
                      <Text style={styles.buyBtnText}>
                        {purchase?.status === 'pending'
                          ? 'Waiting for confirmation…'
                          : unavailable
                          ? 'Not available'
                          : isSubscription
                          ? 'Subscribe'
                          : 'Buy'}
                      </Text>
                    )}
                  </Pressable>
                )}

                {isSubscription && isStoreBillingPlatform && storeProduct ? (
                  <Text style={styles.disclosureText}>
                    {`Auto-renews ${period} at ${storeProduct.priceString} until cancelled. Payment is charged to your ${storeAccount} when you confirm. Cancel any time in your ${storeName} account settings at least 24 hours before the end of the current period; you keep Premium until then.`}
                  </Text>
                ) : null}
              </View>
            );
          })}

          {isStoreBillingConfigured ? (
            <Pressable style={styles.restoreBtn} onPress={handleRestore} disabled={isRestoring}>
              {isRestoring ? <ActivityIndicator color="#ccd3f5" /> : <Text style={styles.restoreText}>Restore purchases</Text>}
            </Pressable>
          ) : null}

          <View style={styles.legalRow}>
            <Pressable onPress={() => openLegalPage('terms')}>
              <Text style={styles.legalLink}>Terms of Use</Text>
            </Pressable>
            <Text style={styles.legalSep}>·</Text>
            <Pressable onPress={() => openLegalPage('privacy')}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060710',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.14)',
  },
  backBtn: {
    width: 36,
  },
  backText: {
    color: '#e0e4f5',
    fontSize: 28,
  },
  headerTitle: {
    color: '#f6f8ff',
    fontWeight: '700',
    fontSize: 18,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorText: {
    color: '#d2d8ec',
    fontSize: 16,
  },
  retryBtn: {
    backgroundColor: 'rgba(255,107,53,0.8)',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryText: {
    color: '#111524',
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 14,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    padding: 18,
    gap: 6,
  },
  productName: {
    color: '#f4f6ff',
    fontSize: 20,
    fontWeight: '700',
  },
  productDescription: {
    color: '#c6cbe2',
    fontSize: 14,
    lineHeight: 20,
  },
  productPrice: {
    color: '#ffb08f',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffcc33',
  },
  statusDotActive: {
    backgroundColor: '#4cd964',
  },
  statusText: {
    color: '#d5d9ea',
    fontSize: 13,
    fontWeight: '600',
  },
  actionBtn: {
    marginTop: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  buyBtn: {
    backgroundColor: '#ff6b35',
  },
  buyBtnText: {
    color: '#111524',
    fontWeight: '700',
    fontSize: 16,
  },
  cancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  cancelBtnText: {
    color: '#ccd3f5',
    fontWeight: '700',
    fontSize: 16,
  },
  buyBtnDisabled: {
    opacity: 0.5,
  },
  noticeText: {
    color: '#d2d8ec',
    fontSize: 14,
    textAlign: 'center',
  },
  disclosureText: {
    color: '#9aa1c0',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  restoreBtn: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  restoreText: {
    color: '#ccd3f5',
    fontWeight: '700',
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  legalLink: {
    color: '#9aa1c0',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  legalSep: {
    color: '#6b7290',
  },
});
