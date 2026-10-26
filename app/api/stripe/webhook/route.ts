import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { saveInvoice, saveSubscription, stripe } from '@/lib/stripe';
import { logEvent } from '@/lib/events';
import { db } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Stripe の Webhook：「https://<公開URL>/api/stripe/webhook」を登録する
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: 'not configured' }, { status: 400 });
  let ev: Stripe.Event;
  try { ev = stripe().webhooks.constructEvent(body, sig, secret); }
  catch { return NextResponse.json({ error: 'bad signature' }, { status: 400 }); }

  try {
    switch (ev.type) {
      case 'checkout.session.completed': {
        const s = ev.data.object;
        if (s.subscription) await saveSubscription(await stripe().subscriptions.retrieve(String(s.subscription)));
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await saveSubscription(ev.data.object);
        break;
      case 'invoice.finalized':
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.overdue':
      case 'invoice.voided':
      case 'invoice.marked_uncollectible':
        await saveInvoice(ev.data.object);
        if (ev.type === 'invoice.payment_failed' || ev.type === 'invoice.overdue') await logEvent('stripe', ev.type === 'invoice.overdue' ? '請求書の支払い期限が過ぎました' : 'カードの支払いに失敗しました', await companyOfCustomer(ev.data.object.customer), 'warn');
        break;
    }
  } catch (e) {
    console.error('stripe webhook', ev.type, e);
    await logEvent('stripe', `Stripe の通知（${ev.type}）を処理できませんでした：${String(e)}`);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function companyOfCustomer(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): Promise<string | null> {
  const id = typeof customer === 'string' ? customer : customer?.id;
  if (!id) return null;
  const { data } = await db().from('companies').select('id').eq('stripe_customer_id', id).maybeSingle();
  return data?.id ?? null;
}
