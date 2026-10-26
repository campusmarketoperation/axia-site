// 運営画面の集計（会社ごと）
import { db } from './supabase/admin';
import { lastSignIns } from './authUsers';

export const monthStartJST = (offset = 0) => {
  const n = new Date(Date.now() + 9 * 3600e3);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1) - 9 * 3600e3).toISOString();
};

/** 会社ごとの LINE 送信数（今月・先月） */
export async function pushCounts() {
  const [cur, prev] = await Promise.all([
    db().from('line_logs').select('company_id').eq('kind', 'push').gte('created_at', monthStartJST(0)),
    db().from('line_logs').select('company_id').eq('kind', 'push').gte('created_at', monthStartJST(-1)).lt('created_at', monthStartJST(0)),
  ]);
  const count = (rows: { company_id: string | null }[] | null) => {
    const m = new Map<string, number>();
    (rows ?? []).forEach(r => { const k = r.company_id ?? '_'; m.set(k, (m.get(k) ?? 0) + 1); });
    return m;
  };
  return { cur: count(cur.data), prev: count(prev.data) };
}

export type Usage = {
  id: string; name: string; status: string; stores: number; parts: number; partsLine: number; staff: number;
  lastLogin: string | null; lastConfirmed: string | null; lastConfirmedStore: string;
};

/** 会社ごとの使われ方：最後のログイン・最後に確定した期間・LINE 登録の割合 */
export async function usageByCompany(): Promise<Usage[]> {
  const [cs, ss, ms, ps, ls] = await Promise.all([
    db().from('companies').select('id, name, status').order('created_at', { ascending: false }),
    db().from('stores').select('id, name, company_id'),
    db().from('members').select('store_id, kind, line_user_id').eq('active', true),
    db().from('profiles').select('user_id, company_id'),
    db().from('period_locks').select('store_id, period_start').eq('confirmed', true).order('period_start', { ascending: false }),
  ]);
  const storeCo = new Map((ss.data ?? []).map(s => [s.id, s.company_id as string]));
  const storeName = new Map((ss.data ?? []).map(s => [s.id, s.name as string]));
  const logins = await lastSignIns((ps.data ?? []).map(p => p.user_id));
  return (cs.data ?? []).map(c => {
    const mine = (ms.data ?? []).filter(m => storeCo.get(m.store_id) === c.id);
    const parts = mine.filter(m => m.kind === 'part');
    const ll = (ps.data ?? []).filter(p => p.company_id === c.id).map(p => logins.get(p.user_id)).filter(Boolean) as string[];
    const conf = (ls.data ?? []).find(l => storeCo.get(l.store_id) === c.id);
    return {
      id: c.id, name: c.name, status: c.status,
      stores: (ss.data ?? []).filter(s => s.company_id === c.id).length,
      parts: parts.length, partsLine: parts.filter(m => m.line_user_id).length, staff: mine.length - parts.length,
      lastLogin: ll.sort().at(-1) ?? null,
      lastConfirmed: conf?.period_start ?? null, lastConfirmedStore: conf ? storeName.get(conf.store_id) ?? '' : '',
    };
  });
}

/** 何日前か（今日・昨日・n日前） */
export function ago(isoTs: string | null): string {
  if (!isoTs) return 'なし';
  const d = Math.floor((Date.now() - new Date(isoTs).getTime()) / 86400e3);
  return d <= 0 ? '今日' : d === 1 ? '昨日' : `${d}日前`;
}
