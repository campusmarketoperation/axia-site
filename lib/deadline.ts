// 提出の締め切り日。店長が決めていなければ「期間が始まる5日前」
import { db } from './supabase/admin';
import { addDays, iso, parseISO } from './period';

export const defaultDeadline = (periodStart: string) => iso(addDays(parseISO(periodStart), -5));

export async function deadlineOf(storeId: string, periodStart: string): Promise<string> {
  const { data } = await db().from('period_locks').select('deadline').eq('store_id', storeId).eq('period_start', periodStart).maybeSingle();
  return data?.deadline ?? defaultDeadline(periodStart);
}

export async function saveDeadline(storeId: string, periodStart: string, deadline: string): Promise<boolean> {
  const { error } = await db().from('period_locks').upsert({ store_id: storeId, period_start: periodStart, deadline }, { onConflict: 'store_id,period_start' });
  if (error) console.error('saveDeadline', error);
  return !error;
}
