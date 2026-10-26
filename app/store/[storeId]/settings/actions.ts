'use server';
import { revalidatePath } from 'next/cache';
import { canEditNeighbors, requireViewer, storeForEdit, storeForManage } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';

const time = (s: string) => (/^\d{1,2}:\d{2}$/.test(s) ? s : null);

export async function saveSettings(storeId: string, f: FormData) {
  const v = await requireViewer();
  await storeForManage(v, storeId);
  const split1 = Number(f.get('split1')), split2 = Number(f.get('split2'));
  const from = time(String(f.get('time_from'))), to = time(String(f.get('time_to')));
  if (!(split1 >= 1 && split2 > split1 && split2 <= 28)) return { ok: false, message: '期間の区切りは「1つ目 < 2つ目 ≦ 28」にしてください' };
  if (!from || !to) return { ok: false, message: '入り時間は「14:30」の形で入れてください' };
  const list = (s: FormDataEntryValue | null) => String(s ?? '').split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean);
  await db().from('stores').update({
    name: String(f.get('name') || '').trim() || undefined,
    split1, split2, time_from: from, time_to: to,
    time_step: Math.max(5, Number(f.get('time_step')) || 30),
    staff_options: list(f.get('staff_options')),
    staff_off_options: list(f.get('staff_off_options')),
    need_weekday: Math.max(0, Number(f.get('need_weekday')) || 0),
    need_weekend: Math.max(0, Number(f.get('need_weekend')) || 0),
    help_enabled: f.get('help_enabled') === 'on',
  }).eq('id', storeId);
  revalidatePath(`/store/${storeId}`, 'layout');
  return { ok: true, message: '保存しました' };
}

/** 近隣として見れる店（本部・運営だけ変えられる） */
export async function saveNeighbors(storeId: string, ids: string[]) {
  const v = await requireViewer();
  const { data: store } = await db().from('stores').select('id, company_id').eq('id', storeId).maybeSingle();
  if (!store || !canEditNeighbors(v, store)) return { ok: false, message: '近隣の店は本部が設定します' };
  const { data: same } = await db().from('stores').select('id').eq('company_id', store.company_id).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const ok = (same ?? []).map(s => s.id).filter(id => id !== storeId);
  await db().from('store_neighbors').delete().eq('store_id', storeId);
  if (ok.length) await db().from('store_neighbors').insert(ok.map(id => ({ store_id: storeId, neighbor_id: id })));
  revalidatePath(`/store/${storeId}/settings`);
  return { ok: true, message: '保存しました' };
}
