'use server';
import { revalidatePath } from 'next/cache';
import { requireViewer, storeForManage } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';

async function guard(storeId: string) {
  const v = await requireViewer();
  await storeForManage(v, storeId);
}

export async function addMember(storeId: string, name: string, kind: 'part' | 'staff') {
  await guard(storeId);
  const n = String(name ?? '').trim();
  if (!n || n.length > 20) return { ok: false, message: '名前は1〜20文字で入れてください' };
  if (kind !== 'part' && kind !== 'staff') return { ok: false, message: '種類がおかしいです' };
  const { data: last } = await db().from('members').select('sort').eq('store_id', storeId).order('sort', { ascending: false }).limit(1).maybeSingle();
  await db().from('members').insert({ store_id: storeId, name: n, kind, sort: (last?.sort ?? 0) + 1 });
  revalidatePath(`/store/${storeId}/members`);
  return { ok: true };
}

export async function updateMember(storeId: string, id: string, patch: { name?: string; kind?: 'part' | 'staff' }) {
  await guard(storeId);
  // 名前と種類だけ（ほかの項目は画面から変えさせない）
  const clean: { name?: string; kind?: 'part' | 'staff' } = {};
  if (typeof patch?.name === 'string') {
    const n = patch.name.trim();
    if (!n || n.length > 20) return { ok: false, message: '名前は1〜20文字で入れてください' };
    clean.name = n;
  }
  if (patch?.kind === 'part' || patch?.kind === 'staff') clean.kind = patch.kind;
  if (!Object.keys(clean).length) return { ok: false, message: '変える内容がありません' };
  await db().from('members').update(clean).eq('id', id).eq('store_id', storeId);
  revalidatePath(`/store/${storeId}/members`);
  return { ok: true };
}

/** 並び順を保存（上から順番の id の配列） */
export async function reorderMembers(storeId: string, ids: string[]) {
  await guard(storeId);
  await Promise.all(ids.map((id, i) => db().from('members').update({ sort: i + 1 }).eq('id', id).eq('store_id', storeId)));
  revalidatePath(`/store/${storeId}/members`);
  return { ok: true };
}

/** 辞めた人：表から外す（過去のシフトは残る） */
export async function retireMember(storeId: string, id: string) {
  await guard(storeId);
  await db().from('members').update({ active: false, line_user_id: null }).eq('id', id).eq('store_id', storeId);
  revalidatePath(`/store/${storeId}/members`);
  return { ok: true };
}

/** LINEの登録を外す（別の人が登録してしまった時など） */
export async function unlinkLine(storeId: string, id: string) {
  await guard(storeId);
  await db().from('members').update({ line_user_id: null }).eq('id', id).eq('store_id', storeId);
  revalidatePath(`/store/${storeId}/members`);
  return { ok: true };
}

/** 社員のかけもち：兼務する店（同じ会社の店だけ）。空にすると外す */
export async function setExtraStores(storeId: string, id: string, ids: string[]) {
  const v = await requireViewer();
  const store = await storeForManage(v, storeId);
  const { data: m } = await db().from('members').select('id, kind').eq('id', id).eq('store_id', storeId).maybeSingle();
  if (!m || m.kind !== 'staff') return { ok: false, message: '社員だけ設定できます' };
  const { data: ok } = await db().from('stores').select('id').eq('company_id', store.company_id).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const clean = (ok ?? []).map(r => r.id as string).filter(x => x !== storeId);
  await db().from('members').update({ extra_store_ids: clean.length ? clean : null }).eq('id', id);
  revalidatePath(`/store/${storeId}`, 'layout');
  return { ok: true, message: clean.length ? '兼務する店を保存しました' : '兼務を外しました' };
}

