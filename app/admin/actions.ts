'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { inviteUser } from '@/lib/invite';
import { db } from '@/lib/supabase/admin';
import { adminEmails } from '@/lib/auth';
import { cancelSubscription, deleteBilling, resendLastInvoice, startInvoiceBilling, syncBillingSettings, syncSubscription } from '@/lib/stripe';

export async function createCompany(f: FormData) {
  await requireAdmin();
  const name = String(f.get('name') || '').trim();
  if (!name) return { ok: false, message: '会社名を入れてください' };
  const trialDays = Number(f.get('trial_days') || 14);
  const trialEnds = new Date(Date.now() + trialDays * 864e5).toISOString().slice(0, 10);
  const { data: c, error } = await db().from('companies').insert({
    name, status: 'trial', trial_ends: trialEnds, price_per_store: Number(f.get('price') || 0),
  }).select('id').single();
  if (error || !c) return { ok: false, message: '作れませんでした' };
  const firstStore = String(f.get('store') || '').trim();
  if (firstStore) await db().from('stores').insert({ company_id: c.id, name: firstStore, sort: 1 });
  const email = String(f.get('email') || '').trim();
  let note = '';
  if (email) { const r = await inviteUser(email, c.id, 'hq', null); note = `（${r.message}）`; }
  revalidatePath('/admin');
  return { ok: true, message: `${name}を追加しました${note}`, id: c.id };
}

export async function updateCompany(id: string, patch: { status?: 'trial' | 'active' | 'stopped'; price_per_store?: number; note?: string; trial_ends?: string | null; name?: string; hq_can_edit?: boolean; billing_method?: 'card' | 'invoice'; billing_email?: string; invoice_days?: number }) {
  await requireAdmin();
  await db().from('companies').update(patch).eq('id', id);
  try {
    if (patch.price_per_store !== undefined) await syncSubscription(id);
    if (patch.billing_email !== undefined || patch.invoice_days !== undefined || patch.name !== undefined) await syncBillingSettings(id);
  } catch (e) { console.error('sync billing', e); }
  revalidatePath('/admin');
  revalidatePath(`/admin/${id}`);
  return { ok: true };
}

export async function inviteHq(companyId: string, email: string) {
  await requireAdmin();
  const r = await inviteUser(email, companyId, 'hq', null);
  revalidatePath(`/admin/${companyId}`);
  return r;
}

export async function removeAccount(companyId: string, userId: string) {
  await requireAdmin();
  await db().from('profiles').delete().eq('user_id', userId).eq('company_id', companyId);
  revalidatePath(`/admin/${companyId}`);
  return { ok: true };
}

/** 請求書（振込）払いを始める */
export async function beginInvoiceBilling(companyId: string) {
  await requireAdmin();
  try { const m = await startInvoiceBilling(companyId); revalidatePath(`/admin/${companyId}`); return { ok: true, message: m }; }
  catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** 未払いの対応：お知らせ・停止予定日・今すぐ停止・再開・請求書の再送・解約 */
export async function billingAction(companyId: string, act: 'notice' | 'clear' | 'stop' | 'resume' | 'resend' | 'cancel', stopOn?: string | null) {
  await requireAdmin();
  const up = (patch: Record<string, unknown>) => db().from('companies').update(patch).eq('id', companyId);
  try {
    switch (act) {
      case 'notice':
        if (stopOn && !/^\d{4}-\d{2}-\d{2}$/.test(stopOn)) return { ok: false, message: '停止予定日がおかしいです' };
        await up({ billing_notice: true, stop_on: stopOn || null });
        break;
      case 'clear':
        await up({ billing_notice: false, stop_on: null });
        break;
      case 'stop':
        await up({ status: 'stopped', stopped_reason: 'unpaid', stop_on: null });
        break;
      case 'resume':
        await up({ status: 'active', stopped_reason: null, stop_on: null, billing_notice: false });
        break;
      case 'resend':
        await resendLastInvoice(companyId);
        break;
      case 'cancel':
        await cancelSubscription(companyId);
        break;
    }
  } catch (e) { return { ok: false, message: (e as Error).message }; }
  revalidatePath('/admin'); revalidatePath(`/admin/${companyId}`);
  const msg = { notice: stopOn ? `お知らせを出しました。${stopOn.replace(/-/g, '/')} に自動で停止します（支払いがあれば自動で取り消し）` : 'お知らせを出しました',
    clear: 'お知らせと停止予定を取り消しました', stop: '停止しました（支払いがあれば自動で再開します）', resume: '再開しました',
    resend: '請求書をもう一度送りました', cancel: 'Stripe のサブスクを解約しました' }[act];
  return { ok: true, message: msg };
}

/**
 * 会社を消す：その会社のデータをすべて消す（元に戻せない）
 *  店舗・メンバー・希望・シフト・ヘルプ・LINE登録・送信記録・店長／本部のアカウント・Stripe の申し込み
 */
export async function deleteCompany(companyId: string, confirmName: string) {
  await requireAdmin();
  const { data: c } = await db().from('companies').select('id, name').eq('id', companyId).maybeSingle();
  if (!c) return { ok: false, message: '見つかりません' };
  if (confirmName.trim() !== c.name.trim()) return { ok: false, message: '会社名が一致しません' };
  try { await deleteBilling(companyId); }
  catch (e) { return { ok: false, message: `Stripe の解約でエラーになりました。先に Stripe を確認してください（${(e as Error).message}）` }; }

  const { data: stores } = await db().from('stores').select('id').eq('company_id', companyId);
  const storeIds = (stores ?? []).map(s => s.id);
  if (storeIds.length) await db().from('line_users').delete().in('store_id', storeIds);

  // 店長・本部のアカウント（運営のメールは残す）
  const { data: profs } = await db().from('profiles').select('user_id').eq('company_id', companyId);
  const admins = adminEmails();
  for (const p of profs ?? []) {
    const { data: u } = await db().auth.admin.getUserById(p.user_id);
    const email = (u?.user?.email ?? '').toLowerCase();
    if (admins.includes(email)) await db().from('profiles').delete().eq('user_id', p.user_id);
    else await db().auth.admin.deleteUser(p.user_id);
  }

  // 会社を消すと、店舗・メンバー・希望・シフト・ヘルプ・確定・送信記録もまとめて消える
  const { error } = await db().from('companies').delete().eq('id', companyId);
  if (error) return { ok: false, message: `消せませんでした（${error.message}）` };
  revalidatePath('/admin');
  return { ok: true, message: `${c.name}を消しました` };
}
