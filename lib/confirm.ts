// シフトの「確定」：確定した期間は、店長もシフト表（時間・ヘルプ）を変えられない
import { iso, parseISO, periodStartOf } from './period';
import { db } from './supabase/admin';

export const CONFIRMED_MSG = 'この期間は確定済みのため変えられません（変える時は「確定を外す」）';

/** その店の、その日を含む期間が確定済みか */
export async function confirmedOn(storeId: string, date: string): Promise<boolean> {
  const { data: s } = await db().from('stores').select('split1, split2').eq('id', storeId).maybeSingle();
  if (!s) return false;
  const key = iso(periodStartOf(parseISO(date), [s.split1, s.split2]));
  const { data } = await db().from('period_locks').select('confirmed').eq('store_id', storeId).eq('period_start', key).maybeSingle();
  return !!data?.confirmed;
}

/** いくつかの店の、日ごとの「確定済みか」（かけもちの社員のマスを止めるのに使う） */
export async function confirmedDays(storeIds: string[], days: string[]): Promise<Record<string, boolean[]>> {
  const out: Record<string, boolean[]> = {};
  const ids = Array.from(new Set(storeIds)).filter(Boolean);
  if (!ids.length || !days.length) return out;
  const from = iso(new Date(parseISO(days[0]).getTime() - 40 * 864e5)), to = days[days.length - 1];
  const [{ data: stores }, { data: locks }] = await Promise.all([
    db().from('stores').select('id, split1, split2').in('id', ids),
    db().from('period_locks').select('store_id, period_start').in('store_id', ids).eq('confirmed', true).gte('period_start', from).lte('period_start', to),
  ]);
  for (const s of stores ?? []) {
    const set = new Set((locks ?? []).filter((l: any) => l.store_id === s.id).map((l: any) => String(l.period_start)));
    out[s.id] = days.map(d => set.has(iso(periodStartOf(parseISO(d), [s.split1, s.split2]))));
  }
  return out;
}
