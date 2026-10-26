import Link from 'next/link';
import AdminShell from '@/components/AdminShell';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const KIND: Record<string, string> = { line_push: 'LINE送信', cron: '夜のお知らせ', stripe: '支払い', invite: '招待メール', other: 'その他' };
const LEVEL: Record<string, [string, string]> = { error: ['エラー', 'stop'], warn: ['注意', 'wait'], info: ['記録', 'ok'] };

export default async function EventsPage({ searchParams }: { searchParams: { level?: string; company?: string } }) {
  const v = await requireAdmin();
  let q = db().from('app_events').select('id, company_id, kind, level, message, created_at, companies(name)').order('created_at', { ascending: false }).limit(300);
  if (searchParams.level && searchParams.level !== 'all') q = q.eq('level', searchParams.level);
  if (searchParams.company) q = q.eq('company_id', searchParams.company);
  const { data, error } = await q;
  const lv = searchParams.level ?? 'all';
  const fmt = (t: string) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <AdminShell email={v.email} active="/admin/events">
      <div className="head"><h1 className="title">エラー記録</h1></div>
      <div className="row">
        {[['all', 'すべて'], ['error', 'エラーだけ'], ['warn', '注意'], ['info', '記録']].map(([k, l]) => (
          <Link key={k} className={`btn sm ${lv === k ? 'primary' : ''}`} href={`/admin/events?level=${k}${searchParams.company ? `&company=${searchParams.company}` : ''}`}>{l}</Link>
        ))}
        {searchParams.company && <Link className="btn sm" href={`/admin/events?level=${lv}`}>会社のしぼりこみを外す</Link>}
      </div>
      {error && <p className="notice">記録を読めませんでした（Supabase で 029 の SQL を実行したか確認してください）</p>}
      <section className="card scroll">
        <table className="list" style={{ minWidth: 760 }}>
          <thead><tr><th>日時</th><th>種類</th><th>会社</th><th>内容</th></tr></thead>
          <tbody>
            {(data ?? []).map((e: any) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmt(e.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}><span className={`pill ${LEVEL[e.level]?.[1] ?? 'wait'}`}>{LEVEL[e.level]?.[0] ?? e.level}</span> {KIND[e.kind] ?? e.kind}</td>
                <td>{e.company_id ? <Link href={`/admin/events?level=${lv}&company=${e.company_id}`}>{e.companies?.name ?? '—'}</Link> : <span className="muted">—</span>}</td>
                <td style={{ fontSize: 13 }}>{e.message}</td>
              </tr>
            ))}
            {(data ?? []).length === 0 && <tr><td colSpan={4} className="muted">記録はありません</td></tr>}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
