// うまくいかなかったことを記録する（運営画面の「エラー記録」で見る）。記録に失敗しても本体は止めない
import { db } from './supabase/admin';

export type EventKind = 'line_push' | 'cron' | 'stripe' | 'invite' | 'other';

export async function logEvent(kind: EventKind, message: string, companyId?: string | null, level: 'error' | 'warn' | 'info' = 'error') {
  try {
    await db().from('app_events').insert({ kind, level, message: message.slice(0, 1000), company_id: companyId ?? null });
  } catch (e) { console.error('logEvent', e); }
}
