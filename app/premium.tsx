import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { cancelPurchase, getMyPurchases, getProducts, startCheckout, type Product } from '@/lib/payments-api';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Payment pending',
  active: 'Active',
  failed: 'Payment failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export default function PremiumScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [checkingOutSlug, setCheckingOutSlug] = useState<string | null>(null);

  const productsQuery = useQuery({ queryKey: ['products'], queryFn: getProducts, staleTime: 5 * 60_000 });
  const purchasesQuery = useQuery({ queryKey: ['purchases'], queryFn: getMyPurchases, staleTime: 15_000 });

  const cancelMutation = useMutation({
    mutationFn: cancelPurchase,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchases'] }),
    onError: (error) => Alert.alert('Could not cancel', error instanceof Error ? error.message : 'Try again'),
  });

  const purchaseFor = (slug: string) =>
    purchasesQuery.data?.purchases.find((p) => p.productSlug === slug && (p.status === 'active' || p.status === 'pending'));

  const handleBuy = async (product: Product) => {
    setCheckingOutSlug(product.slug);
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
      setCheckingOutSlug(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <LiquidBackdrop />
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>MiXiT Premium</Text>
        <View style={styles.backBtn} />
      </View>

      {productsQuery.isLoading ? (
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
          {(productsQuery.data ?? []).map((product) => {
            const purchase = purchaseFor(product.slug);
            const isCheckingOut = checkingOutSlug === product.slug;

            return (
              <View key={product.id} style={styles.card}>
                <Text style={styles.productName}>{product.name}</Text>
                {product.description ? <Text style={styles.productDescription}>{product.description}</Text> : null}
                <Text style={styles.productPrice}>{product.price}</Text>

                {purchase ? (
                  <View style={styles.statusRow}>
                    <View style={[styles.statusDot, purchase.status === 'active' && styles.statusDotActive]} />
                    <Text style={styles.statusText}>{STATUS_LABEL[purchase.status] ?? purchase.status}</Text>
                  </View>
                ) : null}

                {purchase?.status === 'active' ? (
                  <Pressable
                    style={[styles.actionBtn, styles.cancelBtn]}
                    disabled={cancelMutation.isPending}
                    onPress={() => cancelMutation.mutate(purchase.id)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[styles.actionBtn, styles.buyBtn]}
                    disabled={isCheckingOut || purchase?.status === 'pending'}
                    onPress={() => handleBuy(product)}>
                    {isCheckingOut ? (
                      <ActivityIndicator color="#111524" />
                    ) : (
                      <Text style={styles.buyBtnText}>
                        {purchase?.status === 'pending' ? 'Waiting for confirmation…' : 'Buy'}
                      </Text>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}
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
});
