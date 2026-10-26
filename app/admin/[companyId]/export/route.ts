import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 運営だけ：会社のデータを全部まとめて書き出す（解約時のお渡し・保存用。JSON） */
export async function GET(_req: NextRequest, { params }: { params: { companyId: string } }) {
  const v = await getViewer();
  if (!v?.isAdmin) return NextResponse.json({ error: '運営のアカウントでログインしてください' }, { status: 403 });
  const cid = params.companyId;
  const { data: company } = await db().from('companies').select('*').eq('id', cid).maybeSingle();
  if (!company) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  const { data: stores } = await db().from('stores').select('*').eq('company_id', cid);
  const storeIds = (stores ?? []).map(s => s.id);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const sid = storeIds.length ? storeIds : none;
  const { data: members } = await db().from('members').select('*').in('store_id', sid);
  const mid = (members ?? []).map(m => m.id);
  const mids = mid.length ? mid : none;
  const all = async (table: string, col: string, ids: string[]) => {
    const out: unknown[] = [];
    for (let i = 0; ; i += 1000) {
      const { data } = await db().from(table).select('*').in(col, ids).range(i, i + 999);
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  const { data: guests } = await db().from('help_guests').select('*').in('store_id', sid);
  const gid = (guests ?? []).map(g => g.id);
  const body = {
    exported_at: new Date().toISOString(),
    company: { ...company },
    stores,
    members,
    accounts: (await db().from('profiles').select('user_id, role, store_id, extra_store_ids, person_name, title, display_name').eq('company_id', cid)).data,
    requests: await all('requests', 'member_id', mids),
    shifts: await all('shifts', 'member_id', mids),
    period_help: await all('period_help', 'member_id', mids),
    period_locks: await all('period_locks', 'store_id', sid),
    help_assignments: await all('help_assignments', 'to_store', sid),
    help_guests: guests,
    help_guest_days: gid.length ? await all('help_guest_days', 'guest_id', gid) : [],
    store_memos: await all('store_memos', 'store_id', sid),
    store_lend_days: await all('store_lend_days', 'store_id', sid),
  };
  const name = `axia-shift-${(company.name as string).replace(/[\\/:*?"<>|\s]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
  });
}
