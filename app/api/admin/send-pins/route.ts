import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';
import { push, text } from '@/lib/line';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 運営だけ：バイト全員に、それぞれのバイト番号をLINEで送る（一回だけ使う想定）
 *  /api/admin/send-pins            → 送る相手の一覧を見るだけ（送らない）
 *  /api/admin/send-pins?go=1       → 本当に送る
 *  ?store=<店のID> を付けるとその店だけ
 */
export async function GET(req: NextRequest) {
  const v = await getViewer();
  if (!v?.isAdmin) return NextResponse.json({ error: '運営のアカウントでログインしてから開いてください' }, { status: 403 });
  const go = req.nextUrl.searchParams.get('go') === '1';
  // ほかのサイトから勝手に開かされて送られないように（アドレス欄に自分で打って開いた時だけ送る）
  const site = req.headers.get('sec-fetch-site');
  if (go && site && site !== 'none' && site !== 'same-origin') return NextResponse.json({ error: 'アドレス欄に URL を直接入れて開いてください' }, { status: 403 });
  const storeId = req.nextUrl.searchParams.get('store');

  let q = db().from('members').select('name, pin, line_user_id, stores(name, company_id)').eq('kind', 'part').eq('active', true);
  if (storeId) q = q.eq('store_id', storeId);
  const { data } = await q;
  const rows = (data ?? []) as unknown as { name: string; pin: string | null; line_user_id: string | null; stores: { name: string; company_id: string } | null }[];

  const sent: string[] = [], noLine: string[] = [], failed: string[] = [];
  for (const m of rows) {
    const who = `${m.stores?.name ?? ''} ${m.name}`;
    if (!m.line_user_id || !m.pin) { noLine.push(who); continue; }
    if (!go) { sent.push(who); continue; }
    const body = `【バイト番号のお知らせ】\n${m.name}さんのバイト番号は「${m.pin}」です。\nシフトの提出画面で、最初にこの番号を入れてください。\n（忘れたら、このLINEで「番号」と送ると確認できます）`;
    if (await push(m.line_user_id, [text(body)], m.stores?.company_id)) sent.push(who); else failed.push(who);
  }
  return NextResponse.json({
    mode: go ? '送りました' : '確認だけ（まだ送っていません。送るときは URL の最後に ?go=1 を付けて開く）',
    [go ? '送った人' : '送る予定の人']: sent,
    'LINE未登録で送れない人（番号はメンバーページで確認して直接伝える）': noLine,
    ...(failed.length ? { '送信に失敗した人': failed } : {}),
  });
}
