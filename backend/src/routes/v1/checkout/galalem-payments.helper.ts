import { randomUUID } from 'node:crypto';
import { requireEnv } from '~/config';

// Bespoke client for Galalem Payments (https://payments.galalem.tn/v1).
// Two mutations only: create-customer on first purchase, then
// create-checkout-session. Both take an Idempotency-Key. Both return
// the mutation envelope `{status, message, id}`.
const HOST = 'https://payments.galalem.tn';
const API_BASE = `${HOST}/v1`;

function apiKey(): string {
  return requireEnv('GALALEM_PAYMENTS_API_KEY');
}

interface MutationResponse {
  status: number;
  message: string;
  id: string;
}

async function post(path: string, body: unknown, idempotencyKey: string): Promise<MutationResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey(),
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as MutationResponse | null;
  if (!res.ok || !json?.id) {
    throw new Error(`Galalem Payments ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

export interface CreateCustomerParams {
  userId: string;
  email: string;
  name: string;
}

export async function createCustomer(params: CreateCustomerParams): Promise<{ id: string }> {
  const { id } = await post(
    '/customers',
    {
      email: params.email,
      name: params.name,
      country: 'TN',
      metadata: { user_id: params.userId },
    },
    `customer:${params.userId}`,
  );
  return { id };
}

export interface CheckoutLineItem {
  name: string;
  amount_minor: number;
  quantity?: number;
  description?: string;
  image_url?: string;
}

export interface CreateCheckoutSessionParams {
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  locale: string;
  currency: string;
  lineItems: CheckoutLineItem[];
  metadata: Record<string, string>;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

// The hosted checkout page lives at `<host>/checkout/{id}` — the API
// only returns the id, so we build the redirect URL ourselves.
export async function createCheckoutSession(
  params: CreateCheckoutSessionParams,
): Promise<CheckoutSession> {
  const { id } = await post(
    '/checkout/sessions',
    {
      customer_id: params.customerId,
      currency: params.currency,
      country: 'TN',
      locale: params.locale,
      line_items: params.lineItems,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    },
    randomUUID(),
  );
  return { id, url: `${HOST}/checkout/${id}` };
}
