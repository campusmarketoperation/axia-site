'use server';
import { revalidatePath } from 'next/cache';
import { canManageCompany, requireViewer } from '@/lib/auth';
import { inviteUser } from '@/lib/invite';
import { deleteHelpRow, requestHelpRow } from '@/lib/help';
import { headers } from 'next/headers';
import { cardCheckoutUrl, portalUrl, stripeReady, syncSubscription } from '@/lib/stripe';
import { db } from '@/lib/supabase/admin';
import { actorOf, logChange } from '@/lib/history';

/** 同じ会社の店だけに絞る（兼務する店） */
async function sameCompany(companyId: string, ids?: string[]): Promise<string[]> {
  if (!ids?.length) return [];
  const { data } = await db().from('stores').select('id').eq('company_id', companyId).in('id', ids);
  return (data ?? []).map(r => r.id as string);
}

async function guard(companyId: string) {
  const v = await requireViewer();
  if (!canManageCompany(v, companyId)) throw new Error('権限がありません');
  return v;
}

/** 本部はヘルプを見るだけ（依頼・取り消しは店どうしで行う） */
export async function assignHelp(companyId: string, _memberId?: string, _toStore?: string, _date?: string, _startLabel?: string) {
  await guard(companyId);
  return { ok: false, message: '本部の画面では、ヘルプは見るだけです（ヘルプの依頼は店どうしで行います）' };
}

export async function cancelHelp(companyId: string, _helpId?: string) {
  await guard(companyId);
  return { ok: false };
}

export async function createStore(companyId: string, name: string) {
  await guard(companyId);
  const n = name.trim();
  if (!n) return { ok: false, message: '店舗名を入れてください' };
  const { data: first } = await db().from('stores').select('split1, split2, time_from, time_to, time_step, staff_options, staff_off_options, sort')
    .eq('company_id', companyId).order('sort', { ascending: false }).limit(1).maybeSingle();
  // 期間の区切りなどは、同じ会社の店にそろえる
  await db().from('stores').insert({ company_id: companyId, name: n, ...(first ? { ...first, sort: first.sort + 1 } : {}) });
  try { await syncSubscription(companyId); } catch (e) { console.error('sync billing', e); }
  revalidatePath('/hq');
  return { ok: true, message: `${n}を追加しました` };
}

export async function inviteManager(companyId: string, email: string, role: 'manager' | 'hq', storeId: string | null, name?: string, title?: string, extras?: string[]) {
  await guard(companyId);
  if (role === 'manager') {
    const { data: s } = await db().from('stores').select('company_id').eq('id', storeId ?? '').maybeSingle();
    if (!s || s.company_id !== companyId) return { ok: false, message: '店舗を選んでください' };
  }
  const r = await inviteUser(email, companyId, role, storeId, name, title, await sameCompany(companyId, extras));
  revalidatePath('/hq');
  return r;
}

/** 本部も店のシフト表・メンバー・設定を変えられるか（会社ごと） */
export async function setHqCanEdit(companyId: string, value: boolean) {
  // 本部が自分の権限を変えられないよう、運営だけが変えられる（運営の管理画面から）
  const v = await guard(companyId);
  if (!v.isAdmin) throw new Error('この設定は運営だけが変えられます');
  await db().from('companies').update({ hq_can_edit: value }).eq('id', companyId);
  revalidatePath('/hq');
  return { ok: true, message: value ? '本部も店のシフトを変えられるようにしました' : '本部は店のシフトを見るだけにしました（店長が決めます）' };
}

function origin() {
  const h = headers();
  return process.env.NEXT_PUBLIC_SITE_URL || `https://${h.get('host')}`;
}

/** カードで申し込む：Stripe の支払い画面へ */
export async function startCardBilling(companyId: string) {
  const v = await guard(companyId);
  if (!stripeReady()) return { ok: false, message: 'お支払いの準備ができていません。運営に連絡してください' };
  try { return { ok: true, url: await cardCheckoutUrl(companyId, v.email, origin()) }; }
  catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** カード変更・請求書・解約（Stripe の管理ページ） */
export async function openBillingPortal(companyId: string) {
  await guard(companyId);
  try { return { ok: true, url: await portalUrl(companyId, `${origin()}/hq?company=${companyId}`) }; }
  catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** 店長・本部のアカウント：役割・店舗を変える */
export async function updateAccount(companyId: string, userId: string, role: 'manager' | 'hq', storeId: string | null, name?: string, title?: string, extras?: string[]) {
  const v = await guard(companyId);
  if (role !== 'manager' && role !== 'hq') return { ok: false, message: '役割がおかしいです' };
  const { data: p } = await db().from('profiles').select('user_id').eq('user_id', userId).eq('company_id', companyId).maybeSingle();
  if (!p) return { ok: false, message: '見つかりません' };
  if (userId === v.userId && role !== 'hq' && !v.isAdmin) return { ok: false, message: '自分を店長に変えると本部の画面に入れなくなります。ほかの本部の人に変えてもらってください' };
  if (role === 'manager') {
    const { data: s } = await db().from('stores').select('company_id').eq('id', storeId ?? '').maybeSingle();
    if (!s || s.company_id !== companyId) return { ok: false, message: '店舗を選んでください' };
  }
  await db().from('profiles').update({ role, store_id: role === 'manager' ? storeId : null, person_name: name?.trim().slice(0, 30) || null, title: role === 'manager' ? (title === '社員' ? '社員' : '店長') : null, extra_store_ids: role === 'manager' ? ((await sameCompany(companyId, extras)).filter(x => x !== storeId).length ? (await sameCompany(companyId, extras)).filter(x => x !== storeId) : null) : null }).eq('user_id', userId).eq('company_id', companyId);
  revalidatePath('/hq');
  return { ok: true, message: '変更しました' };
}

/** 店長・本部のアカウントを外す（その人はログインしても使えなくなる） */
export async function removeAccountHq(companyId: string, userId: string) {
  const v = await guard(companyId);
  if (userId === v.userId && !v.isAdmin) return { ok: false, message: '自分は外せません。ほかの本部の人に外してもらってください' };
  await db().from('profiles').delete().eq('user_id', userId).eq('company_id', companyId);
  revalidatePath('/hq');
  return { ok: true, message: '外しました' };
}

/** 店長も自分の店の近隣を選べるか（会社ごと） */
export async function setManagerNeighbors(companyId: string, value: boolean) {
  await guard(companyId);
  await db().from('companies').update({ manager_neighbors: value }).eq('id', companyId);
  revalidatePath('/hq');
  return { ok: true, message: value ? '店長も自分の店の近隣を選べるようにしました' : '近隣の店は本部だけが選べるようにしました' };
}
