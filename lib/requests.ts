import { db } from './supabase/admin';
import { iso, parseISO, periodDays, type Split } from './period';
import { type Req } from './shift';

export type DayVal = { s: 'ok'; st: string | null } | { s: 'ng' };

export async function isLocked(storeId: string, periodKey: string): Promise<boolean> {
  const { data } = await db().from('period_locks').select('locked').eq('store_id', storeId).eq('period_start', periodKey).maybeSingle();
  return !!data?.locked;
}

/** その人の、その期間の希望（日付 → 値）とヘルプOK */
export async function getMine(memberId: string, periodKey: string, split: Split): Promise<{ days: Record<string, DayVal>; helpOk: boolean; helpAnswered: boolean; any: boolean }> {
  const ds = periodDays(parseISO(periodKey), split);
  const [rq, hp] = await Promise.all([
    db().from('requests').select('date, status, start_time').eq('member_id', memberId).gte('date', iso(ds[0])).lte('date', iso(ds[ds.length - 1])),
    db().from('period_help').select('help_ok, answered').eq('member_id', memberId).eq('period_start', periodKey).maybeSingle(),
  ]);
  const days: Record<string, DayVal> = {};
  (rq.data ?? []).forEach((r: Req & { date: string }) => {
    days[r.date] = r.status === 'ng' ? { s: 'ng' } : { s: 'ok', st: r.start_time };
  });
  return { days, helpOk: !!hp.data?.help_ok, helpAnswered: !!hp.data?.answered, any: (rq.data ?? []).length > 0 };
}

/**
 * 希望を保存する
 *  replace=true：その期間を丸ごと出し直し（提出画面・LINEで行ける日を並べた時）
 *  replace=false：書いた日だけ変える（LINEで「28 5」と送った時）。値が null の日は消す
 */
export async function saveRequests(memberId: string, periodKey: string, split: Split,
  days: Record<string, DayVal | null>, opts: { replace: boolean; helpOk?: boolean; source?: string }) {
  const ds = periodDays(parseISO(periodKey), split).map(iso);
  const inPeriod = (d: string) => ds.includes(d);
  // 出し直す前の希望（変わった日を知るため）
  const before = (await getMine(memberId, periodKey, split)).days;
  if (opts.replace) {
    await db().from('requests').delete().eq('member_id', memberId).gte('date', ds[0]).lte('date', ds[ds.length - 1]);
  }
  const ups = Object.entries(days).filter(([d, v]) => inPeriod(d) && v)
    .map(([date, v]) => ({ member_id: memberId, date, status: v!.s, start_time: v!.s === 'ok' ? v!.st : null, updated_at: new Date().toISOString() }));
  const dels = Object.entries(days).filter(([d, v]) => inPeriod(d) && !v).map(([d]) => d);
  if (ups.length) await db().from('requests').upsert(ups);
  if (dels.length && !opts.replace) await db().from('requests').delete().eq('member_id', memberId).in('date', dels);
  // 希望が変わった日は、店長が先に打っていた内容を外して、新しい希望を表に出す
  // （確定済みの期間はここに来ない。ヘルプで他店に出ている日「→漁火…」はそのまま）
  const after: Record<string, DayVal | null> = opts.replace ? {} : { ...before };
  Object.entries(days).forEach(([d, v]) => { if (inPeriod(d)) after[d] = v ?? null; });
  const key = (v: DayVal | null | undefined) => !v ? '' : v.s === 'ng' ? 'ng' : `ok:${v.st ?? ''}`;
  const changed = ds.filter(d => key(before[d]) !== key(after[d]));
  if (changed.length) {
    const { data: sh } = await db().from('shifts').select('date, value').eq('member_id', memberId).in('date', changed);
    const clear = (sh ?? []).filter(r => !String(r.value ?? '').startsWith('→')).map(r => r.date as string);
    if (clear.length) await db().from('shifts').delete().eq('member_id', memberId).in('date', clear);
  }
  if (opts.helpOk !== undefined) {
    await db().from('period_help').upsert({ member_id: memberId, period_start: periodKey, help_ok: opts.helpOk, answered: true });
  }
}
