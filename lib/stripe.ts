import Stripe from 'stripe';
import { db } from './supabase/admin';

/**
 * 支払い（Stripe）
 *  - 1店舗あたりの月額 × 店舗数 を、毎月サブスクで請求する
 *  - カード自動払い：本部が Stripe の支払い画面でカードを登録
 *  - 請求書（振込）：毎月、請求書がメールで届き、会社ごとの専用口座に振り込む（入金は自動で消し込み）
 *  - 支払いが遅れても自動では止めない（止めるかは運営が決める）
 */
let client: Stripe | null = null;
export function stripeReady() { return !!process.env.STRIPE_SECRET_KEY; }
export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY が設定されていません');
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY));
}
export function stripeTestMode() { return (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_'); }
export function dashboardUrl(path: string) { return `https://dashboard.stripe.com/${stripeTestMode() ? 'test/' : ''}${path}`; }

export type BillingCompany = {
  id: string; name: string; status: string; trial_ends: string | null; price_per_store: number;
  billing_method: 'card' | 'invoice'; billing_email: string; invoice_days: number;
  stripe_customer_id: string | null; stripe_subscription_id: string | null;
};

async function company(id: string): Promise<BillingCompany> {
  const { data } = await db().from('companies').select('*').eq('id', id).single();
  if (!data) throw new Error('会社が見つかりません');
  return data as BillingCompany;
}
async function storeCount(companyId: string) {
  const { count } = await db().from('stores').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  return Math.max(1, count ?? 0);
}

/** 商品「AXIA Shift（1店舗の月額）」：なければ作る */
let productCache: string | null = null;
async function productId(): Promise<string> {
  if (productCache) return productCache;
  const found = await stripe().products.search({ query: "metadata['app']:'axia-shift' AND active:'true'" });
  productCache = found.data[0]?.id
    ?? (await stripe().products.create({ name: 'AXIA Shift（1店舗の月額）', metadata: { app: 'axia-shift' } })).id;
  return productCache;
}
async function priceData(c: BillingCompany) {
  return { currency: 'jpy', product: await productId(), unit_amount: Math.max(0, c.price_per_store), recurring: { interval: 'month' as const } };
}

/** お試しの終わり（2日以上先なら、その日まで請求しない） */
function trialEnd(c: BillingCompany): number | undefined {
  if (!c.trial_ends) return undefined;
  const t = Math.floor(new Date(`${c.trial_ends}T00:00:00+09:00`).getTime() / 1000);
  return t > Date.now() / 1000 + 2 * 86400 ? t : undefined;
}

async function ensureCustomer(c: BillingCompany, email: string): Promise<string> {
  const mail = (c.billing_email || email).trim();
  if (c.stripe_customer_id) {
    await stripe().customers.update(c.stripe_customer_id, { name: c.name, email: mail || undefined });
    return c.stripe_customer_id;
  }
  const cu = await stripe().customers.create({ name: c.name, email: mail || undefined, preferred_locales: ['ja'], metadata: { company_id: c.id } });
  await db().from('companies').update({ stripe_customer_id: cu.id, billing_email: mail }).eq('id', c.id);
  return cu.id;
}

function hasLiveSub(status: string | null | undefined) {
  return !!status && !['canceled', 'incomplete_expired'].includes(status);
}

/** カード自動払い：Stripe の支払い画面（Checkout）のURLを作る */
export async function cardCheckoutUrl(companyId: string, email: string, origin: string): Promise<string> {
  const c = await company(companyId);
  if (c.stripe_subscription_id) {
    const s = await stripe().subscriptions.retrieve(c.stripe_subscription_id).catch(() => null);
    if (s && hasLiveSub(s.status)) throw new Error('もう申し込み済みです。「お支払いの管理」から変えられます');
  }
  if (c.price_per_store <= 0) throw new Error('月額がまだ決まっていません。運営に連絡してください');
  const customer = await ensureCustomer(c, email);
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    locale: 'ja',
    line_items: [{ price_data: await priceData(c), quantity: await storeCount(c.id) }],
    subscription_data: { trial_end: trialEnd(c), metadata: { company_id: c.id } },
    metadata: { company_id: c.id },
    success_url: `${origin}/hq?company=${c.id}&billing=ok`,
    cancel_url: `${origin}/hq?company=${c.id}`,
  });
  return session.url!;
}

/** 請求書（振込）払いで始める：運営画面から */
export async function startInvoiceBilling(companyId: string): Promise<string> {
  const c = await company(companyId);
  if (c.price_per_store <= 0) throw new Error('先に1店舗の月額を決めてください');
  if (!c.billing_email) throw new Error('先に請求書の送り先メールを入れてください');
  if (c.stripe_subscription_id) {
    const s = await stripe().subscriptions.retrieve(c.stripe_subscription_id).catch(() => null);
    if (s && hasLiveSub(s.status)) throw new Error('もう始まっています');
  }
  const customer = await ensureCustomer(c, c.billing_email);
  const sub = await stripe().subscriptions.create({
    customer,
    collection_method: 'send_invoice',
    days_until_due: Math.min(90, Math.max(1, c.invoice_days || 30)),
    items: [{ price_data: await priceData(c), quantity: await storeCount(c.id) }],
    trial_end: trialEnd(c),
    payment_settings: {
      payment_method_types: ['customer_balance', 'card'],
      payment_method_options: { customer_balance: { funding_type: 'bank_transfer', bank_transfer: { type: 'jp_bank_transfer' } } },
    },
    metadata: { company_id: c.id },
  });
  await saveSubscription(sub);
  return trialEnd(c) ? 'お試しが終わる日に、最初の請求書が送られます' : '最初の請求書を送りました';
}

/** 本部がカード変更・請求書の確認・解約をする Stripe の管理ページ */
export async function portalUrl(companyId: string, returnUrl: string): Promise<string> {
  const c = await company(companyId);
  if (!c.stripe_customer_id) throw new Error('まだ申し込みがありません');
  const s = await stripe().billingPortal.sessions.create({ customer: c.stripe_customer_id, return_url: returnUrl, locale: 'ja' });
  return s.url;
}

/** 店舗数・月額が変わったら、次の請求から反映（日割りはしない） */
export async function syncSubscription(companyId: string) {
  if (!stripeReady()) return;
  const c = await company(companyId);
  if (!c.stripe_subscription_id) return;
  const sub = await stripe().subscriptions.retrieve(c.stripe_subscription_id).catch(() => null);
  if (!sub || !hasLiveSub(sub.status)) return;
  const item = sub.items.data[0];
  const qty = await storeCount(c.id);
  if (item && item.quantity === qty && item.price.unit_amount === c.price_per_store) return;
  await stripe().subscriptions.update(sub.id, {
    items: [{ id: item.id, price_data: await priceData(c), quantity: qty }],
    proration_behavior: 'none',
  });
}

/** 請求書払いの期限・送り先を Stripe にも反映 */
export async function syncBillingSettings(companyId: string) {
  if (!stripeReady()) return;
  const c = await company(companyId);
  if (c.stripe_customer_id && c.billing_email) await stripe().customers.update(c.stripe_customer_id, { email: c.billing_email, name: c.name });
  if (c.stripe_subscription_id && c.billing_method === 'invoice') {
    const sub = await stripe().subscriptions.retrieve(c.stripe_subscription_id).catch(() => null);
    if (sub && hasLiveSub(sub.status) && sub.collection_method === 'send_invoice') {
      await stripe().subscriptions.update(sub.id, { days_until_due: Math.min(90, Math.max(1, c.invoice_days || 30)) });
    }
  }
}

// ---- Webhook から ----
async function companyIdOf(meta: Stripe.Metadata | null | undefined, customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  if (meta?.company_id) return meta.company_id;
  const cid = typeof customer === 'string' ? customer : customer?.id;
  if (!cid) return null;
  const { data } = await db().from('companies').select('id').eq('stripe_customer_id', cid).maybeSingle();
  return data?.id ?? null;
}

export async function saveSubscription(sub: Stripe.Subscription) {
  const id = await companyIdOf(sub.metadata, sub.customer);
  if (!id) return;
  const end = sub.current_period_end ?? (sub.items.data[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  const patch: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    billing_status: sub.status,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
  };
  // 支払いが始まったら「お試し」→「契約中」。止めるのは運営が手で決める
  if (sub.status === 'active') {
    const { data: c } = await db().from('companies').select('status').eq('id', id).single();
    if (c?.status === 'trial') patch.status = 'active';
  }
  await db().from('companies').update(patch).eq('id', id);
}

export async function saveInvoice(inv: Stripe.Invoice) {
  const id = await companyIdOf(inv.subscription_details?.metadata ?? inv.metadata, inv.customer);
  if (!id) return;
  await db().from('companies').update({
    last_invoice_status: inv.status,
    last_invoice_amount: inv.amount_due,
    last_invoice_due: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
    last_invoice_url: inv.hosted_invoice_url ?? null,
    last_invoice_id: inv.id,
  }).eq('id', id);
  // 支払われたら、お知らせ・停止予定を消す。未払いで止めていたら再開する
  if (inv.status === 'paid') {
    const { data: c } = await db().from('companies').select('status, stopped_reason').eq('id', id).single();
    const patch: Record<string, unknown> = { billing_notice: false, stop_on: null };
    if (c?.status === 'stopped' && c.stopped_reason === 'unpaid') { patch.status = 'active'; patch.stopped_reason = null; }
    await db().from('companies').update(patch).eq('id', id);
  }
}

/** 最新の請求書をもう一度メールで送る */
export async function resendLastInvoice(companyId: string) {
  const c = await company(companyId) as BillingCompany & { last_invoice_id: string | null };
  if (!c.last_invoice_id) throw new Error('送れる請求書がありません');
  const inv = await stripe().invoices.retrieve(c.last_invoice_id);
  if (inv.status !== 'open') throw new Error('支払い待ちの請求書ではありません');
  if (inv.collection_method !== 'send_invoice') throw new Error('カード自動払いの請求書は再送できません（カードの再試行は Stripe が自動で行います）');
  await stripe().invoices.sendInvoice(inv.id);
}

/** Stripe のサブスクを解約（今すぐ） */
export async function cancelSubscription(companyId: string) {
  const c = await company(companyId);
  if (!c.stripe_subscription_id) throw new Error('申し込みがありません');
  const sub = await stripe().subscriptions.cancel(c.stripe_subscription_id);
  await saveSubscription(sub);
}

/** 会社を消す時：サブスクを止めて、Stripe の顧客も消す（発行済みの請求書の記録は Stripe 側に残る） */
export async function deleteBilling(companyId: string) {
  if (!stripeReady()) return;
  const c = await company(companyId);
  if (c.stripe_subscription_id) {
    const s = await stripe().subscriptions.retrieve(c.stripe_subscription_id).catch(() => null);
    if (s && hasLiveSub(s.status)) await stripe().subscriptions.cancel(s.id);
  }
  if (c.stripe_customer_id) await stripe().customers.del(c.stripe_customer_id).catch(() => null);
}
