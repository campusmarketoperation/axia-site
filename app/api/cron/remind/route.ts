import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/supabase/admin';
import { companyActive, loadGrid, splitOf } from '@/lib/data';
import { iso, nextStartOf, parseISO, periodStartOf, todayJST } from '@/lib/period';
import { defaultDeadline } from '@/lib/deadline';
import { summary } from '@/lib/lineBot';
import { push, text } from '@/lib/line';
import type { Store } from '@/lib/shift';
import { logEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 締め切り当日の夜（毎日22時ごろ、Vercel Cron が呼ぶ）
 *  - 未提出のバイト：提出のお願い（途中まで出している人には、未入力の日が分かる一覧）
 *  - 提出済みのバイト：出した希望の確認
 * 締め切り済み・確定済みの期間と、もう送った期間には送らない
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const today = iso(todayJST());
  const { data: stores } = await db().from('stores').select('*');
  const site = process.env.NEXT_PUBLIC_SITE_URL || '';
  const report: { store: string; period: string; reminded: number; confirmed: number }[] = [];
  const activeCache = new Map<string, boolean>();

  for (const store of (stores ?? []) as Store[]) {
    if (!activeCache.has(store.company_id)) activeCache.set(store.company_id, await companyActive(store.company_id));
    if (!activeCache.get(store.company_id)) continue;
    const split = splitOf(store);
    // 締め切りが今日になりうる期間：次の期間と、その次
    const p1 = nextStartOf(periodStartOf(todayJST(), split), split);
    const candidates = [iso(p1), iso(nextStartOf(p1, split))];
    const { data: locks } = await db().from('period_locks')
      .select('period_start, locked, confirmed, deadline, auto_reminded_at').eq('store_id', store.id).in('period_start', candidates);
    for (const key of candidates) {
      const lk = (locks ?? []).find(l => l.period_start === key);
      if ((lk?.deadline ?? defaultDeadline(key)) !== today) continue;
      if (lk?.locked || lk?.confirmed || lk?.auto_reminded_at) continue;
      // 先に「送った」にする（二重に送らないように）
      await db().from('period_locks').upsert({ store_id: store.id, period_start: key, auto_reminded_at: new Date().toISOString() }, { onConflict: 'store_id,period_start' });

      try {
      const g = await loadGrid(store, parseISO(key));
      let reminded = 0, confirmed = 0;
      for (const r of g.parts) {
        const uid = r.member.line_user_id;
        if (!uid) continue;
        const msg = r.submitted
          ? `${await summary(r.member, store, key)}\n\n締め切りは今日です。変えたい日があれば、今日中にこのLINEで送ってください。`
          : r.started
          ? `${await summary(r.member, store, key)}\n\n締め切りは今日です。未入力の日を、今日中にこのLINEで送ってください。`
          : `【シフト提出のお願い】\n${g.label} の締め切りは今日です。まだ出ていないので、今日中に出してください。\n\nこのLINEに送るか、こちらから👇\n${site}/s/${store.submit_token}`;
        if (await push(uid, [text(msg)], store.company_id)) r.submitted ? confirmed++ : reminded++;
      }
      report.push({ store: store.name, period: key, reminded, confirmed });
      await logEvent('cron', `${store.name}：締め切り日のお知らせを送りました（提出のお願い ${reminded}人・確認 ${confirmed}人）`, store.company_id, 'info');
      } catch (e) {
        await logEvent('cron', `${store.name}：締め切り日のお知らせでエラー：${String(e)}`, store.company_id);
      }
    }
  }
  return NextResponse.json({ ok: true, today, report });
}
