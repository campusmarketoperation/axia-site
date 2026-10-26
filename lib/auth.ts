import { redirect } from 'next/navigation';
import { authClient } from './supabase/server';
import { db } from './supabase/admin';
import type { Store } from './shift';
import { isStopped } from './companyState';

export type Viewer = {
  userId: string;
  email: string;
  name: string;                     // 名前（未設定ならメールの@より前）
  title: string;                    // 店長／社員／本部／運営
  isAdmin: boolean;                 // 運営（AXIA）
  role: 'manager' | 'hq' | null;    // 店長／本部
  companyId: string | null;
  storeId: string | null;           // 店長の自店
  storeIds: string[];               // 店長・社員が使える店（自店＋兼務する店）
  companyStopped: boolean;
  hqCanEdit: boolean;               // 本部も店のシフトなどを変えられる会社か
  managerNeighbors: boolean;        // 店長も自分の店の近隣を選べる会社か
  billingNotice: { stopOn: string | null; invoiceUrl: string | null } | null; // 未払いのお知らせ
};

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export async function getViewer(): Promise<Viewer | null> {
  const { data } = await authClient().auth.getUser();
  const user = data.user;
  if (!user || !user.email) return null;
  const isAdmin = adminEmails().includes(user.email.toLowerCase());
  const { data: p } = await db().from('profiles').select('role, company_id, store_id, person_name, title, extra_store_ids').eq('user_id', user.id).maybeSingle();
  let companyStopped = false, hqCanEdit = true, managerNeighbors = false;
  let billingNotice: Viewer['billingNotice'] = null;
  if (p?.company_id) {
    const { data: c } = await db().from('companies').select('status, hq_can_edit, manager_neighbors, stop_on, billing_notice, last_invoice_status, last_invoice_url').eq('id', p.company_id).maybeSingle();
    companyStopped = isStopped(c);
    hqCanEdit = c?.hq_can_edit !== false;
    managerNeighbors = c?.manager_neighbors === true;
    if (c && (c.billing_notice || c.stop_on)) billingNotice = { stopOn: c.stop_on ?? null, invoiceUrl: c.last_invoice_status === 'open' ? c.last_invoice_url ?? null : null };
  }
  return {
    userId: user.id, email: user.email, isAdmin,
    name: (p as any)?.person_name || user.email.split('@')[0],
    title: p?.role === 'hq' ? '本部' : p?.role === 'manager' ? ((p as any)?.title || '店長') : isAdmin ? '運営' : '',
    role: (p?.role as Viewer['role']) ?? null,
    companyId: p?.company_id ?? null,
    storeId: p?.store_id ?? null,
    storeIds: p?.role === 'manager' ? Array.from(new Set([p.store_id, ...(((p as any).extra_store_ids ?? []) as string[])].filter(Boolean))) as string[] : [],
    companyStopped,
    hqCanEdit,
    managerNeighbors,
    billingNotice,
  };
}

/** ログイン必須の画面で使う */
export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect('/login');
  if (!v.isAdmin && (!v.role || v.companyStopped)) redirect('/no-access');
  return v;
}

export async function requireAdmin(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect('/login');
  if (!v.isAdmin) redirect('/');
  return v;
}

/** 店の画面を開ける（見るだけを含む）：自分の店・本部（自分の会社）・運営 */
export function canViewStore(v: Viewer, s: Pick<Store, 'id' | 'company_id'>): boolean {
  if (v.isAdmin) return true;
  if (v.role === 'hq') return s.company_id === v.companyId;
  return v.role === 'manager' && v.storeIds.includes(s.id) && s.company_id === v.companyId;
}

/** 店のシフト表・メンバー・設定を変えられる：自分の店。本部は会社の設定でオンの時だけ。運営は見るだけ */
export function canEditStore(v: Viewer, s: Pick<Store, 'id' | 'company_id'>): boolean {
  if (v.isAdmin) return false;
  if (v.role === 'hq') return s.company_id === v.companyId && v.hqCanEdit;
  return v.role === 'manager' && v.storeIds.includes(s.id) && s.company_id === v.companyId;
}

/** メンバー・店舗の設定を変えられる：店長と本部（社員のアカウントは見るだけ） */
export function canManageStore(v: Viewer, s: Pick<Store, 'id' | 'company_id'>): boolean {
  return canEditStore(v, s) && !(v.role === 'manager' && v.title === '社員');
}

/** ヘルプの依頼・承認・貸し出し：その店の店長・社員だけ（本部は見るだけ） */
export function canHelpStore(v: Viewer, s: Pick<Store, 'id' | 'company_id'>): boolean {
  return canEditStore(v, s) && v.role === 'manager';
}

/** 本部の操作（会社の中の全店） */
export function canManageCompany(v: Viewer, companyId: string): boolean {
  return v.isAdmin || (v.role === 'hq' && v.companyId === companyId);
}

/** 店舗を取り出して、編集できるか確かめる（できなければ止める） */
export async function storeForEdit(v: Viewer, storeId: string): Promise<Store> {
  const { data } = await db().from('stores').select('*').eq('id', storeId).maybeSingle();
  if (!data || !canEditStore(v, data as Store)) throw new Error('この店舗を操作する権限がありません');
  return data as Store;
}

export async function storeForManage(v: Viewer, storeId: string): Promise<Store> {
  const s = await storeForEdit(v, storeId);
  if (!canManageStore(v, s)) throw new Error('メンバーと店舗の設定は、店長が変えます');
  return s;
}
export async function storeForHelp(v: Viewer, storeId: string): Promise<Store> {
  const s = await storeForEdit(v, storeId);
  if (!canHelpStore(v, s)) throw new Error('本部の画面では、ヘルプは見るだけです');
  return s;
}

/** 近隣の店を選べる：本部。会社の設定がオンなら、その店の店長も */
export function canEditNeighbors(v: Viewer, s: Pick<Store, 'id' | 'company_id'>): boolean {
  if (v.isAdmin) return false; // 運営は店ごとの設定を見るだけ
  if (canManageCompany(v, s.company_id)) return true;
  return v.role === 'manager' && v.storeIds.includes(s.id) && v.companyId === s.company_id && v.managerNeighbors && !v.companyStopped;
}

/** 左の「店舗」に出す店：店長・社員は自店と兼務する店、本部・運営は全店 */
export function storesFor<T extends { id: string }>(v: Viewer, all: T[]): T[] {
  return v.role === 'manager' ? all.filter(s => v.storeIds.includes(s.id)) : all;
}
