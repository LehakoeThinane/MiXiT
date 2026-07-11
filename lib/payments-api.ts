import { apiRequest } from '@/lib/api-client';

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: string;
  priceInCents: number;
  currency: string;
  type: 'subscription' | 'boost' | 'feature';
};

export type Purchase = {
  id: string;
  productSlug: string;
  productName: string;
  productType: string;
  status: 'pending' | 'active' | 'failed' | 'expired' | 'cancelled';
  price: string;
  expiresAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
};

type ProductsResponse = {
  ok: boolean;
  products: Product[];
};

type CheckoutResponse = {
  ok: boolean;
  checkoutUrl: string;
};

type PurchasesResponse = {
  ok: boolean;
  premium: boolean;
  purchases: Purchase[];
};

export async function getProducts() {
  const response = await apiRequest<ProductsResponse>('/payments/products');
  return response.products;
}

export async function startCheckout(productSlug: string) {
  const response = await apiRequest<CheckoutResponse>('/payments/subscribe', {
    method: 'POST',
    auth: true,
    body: { productSlug },
  });
  return response.checkoutUrl;
}

export async function getMyPurchases() {
  const response = await apiRequest<PurchasesResponse>('/payments/me', {
    auth: true,
  });
  return { premium: response.premium, purchases: response.purchases };
}

export async function cancelPurchase(purchaseId: string) {
  await apiRequest(`/payments/me/${purchaseId}`, {
    method: 'DELETE',
    auth: true,
  });
}
