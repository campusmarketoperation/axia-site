import { isWorkingPart } from './shift';
// 本部画面の集計
import { db } from './supabase/admin';
import type { Store } from './shift';

export type HelpMonth = {
  stores: { id: string; name: string; lent: number; borrowed: number }[];
  pairs: { from: string; to: string; count: number }[];
  total: number;
};

/** その月のヘルプの貸し借り（人日）。シフト表の「→店名」と、借りた人（手入力）から数える */
export async function helpMonth(stores: Store[], month: string): Promise<HelpMonth> {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const ids = stores.map(s => s.id);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const byName = new Map(stores.map(s => [s.name, s]));
  const { data: ms } = await db().from('members').select('id, store_id').in('store_id', ids.length ? ids : none);
  const home = new Map((ms ?? []).map(x => [x.id, x.store_id as string]));
  const mids = (ms ?? []).map(x => x.id);
  const { data: sh } = await db().from('shifts').select('member_id, value').in('member_id', mids.length ? mids : none).gte('date', from).lte('date', to).like('value', '→%');
  const { data: gs } = await db().from('help_guests').select('store_id, from_store, help_guest_days(date, value)').in('store_id', ids.length ? ids : none);
  const lent = new Map<string, number>(), borrowed = new Map<string, number>(), pair = new Map<string, number>();
  const add = (mp: Map<string, number>, k: string) => mp.set(k, (mp.get(k) ?? 0) + 1);
  const nameOf = new Map(stores.map(s => [s.id, s.name]));
  let total = 0;
  for (const r of sh ?? []) {
    const fromId = home.get(r.member_id); if (!fromId) continue;
    const toName = String(r.value).slice(1).trim().split(/\s+/)[0] || 'ほかの店';
    add(lent, fromId);
    const target = byName.get(toName);
    if (target) add(borrowed, target.id);
    add(pair, `${nameOf.get(fromId)}→${target ? target.name : toName}`);
    total++;
  }
  for (const g of (gs ?? []) as any[]) {
    for (const d of g.help_guest_days ?? []) {
      if (d.date < from || d.date > to || !isWorkingPart(String(d.value ?? ''))) continue;
      add(borrowed, g.store_id);
      // 借りた人（手入力）：相手の店がまだシステムを使っていない時の分。相手が会社の店なら、その店の「貸した」にも数える
      const src = byName.get(g.from_store);
      if (src) add(lent, src.id);
      add(pair, `${g.from_store || 'ほかの店'}→${nameOf.get(g.store_id)}`);
      total++;
    }
  }
  return {
    stores: stores.map(s => ({ id: s.id, name: s.name, lent: lent.get(s.id) ?? 0, borrowed: borrowed.get(s.id) ?? 0 })),
    pairs: Array.from(pair.entries()).map(([k, count]) => { const [f, t] = k.split('→'); return { from: f, to: t, count }; }).sort((a, b) => b.count - a.count),
    total,
  };
}
