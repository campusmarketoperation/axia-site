import Link from 'next/link';
import AdminShell from '@/components/AdminShell';
import { requireAdmin } from '@/lib/auth';
import { pushCounts } from '@/lib/adminStats';
import { lineQuota } from '@/lib/line';
import { db } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function LinePage() {
  const v = await requireAdmin();
  const [quota, push, cs] = await Promise.all([lineQuota(), pushCounts(), db().from('companies').select('id, name').order('created_at')]);
  const ours = Array.from(push.cur.values()).reduce((a, b) => a + b, 0);
  const used = quota?.used ?? ours;
  const limit = quota?.limit ?? null;
  const rate = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = rate >= 90 ? '#B5455C' : rate >= 80 ? '#C9A227' : '#2C6B3F';
  const rows = (cs.data ?? []).map(c => ({ id: c.id, name: c.name, cur: push.cur.get(c.id) ?? 0, prev: push.prev.get(c.id) ?? 0 }))
    .sort((a, b) => b.cur - a.cur);
  const other = push.cur.get('_') ?? 0;
  return (
    <AdminShell email={v.email} active="/admin/line">
      <div className="head"><h1 className="title">LINE送信数（今月）</h1></div>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {limit ? <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>{used.toLocaleString()} <span className="muted" style={{ fontSize: 16 }}>/ {limit.toLocaleString()}通</span></b>
            <span className="pill" style={{ background: color, color: '#fff' }}>{rate}%</span>
          </div>
          <div style={{ height: 14, background: '#EEF0F4', borderRadius: 7, overflow: 'hidden' }}><div style={{ width: `${rate}%`, height: '100%', background: color }} /></div>
          <p className="muted" style={{ margin: 0 }}>残り {Math.max(0, limit - used).toLocaleString()}通。上限を超えると、その月はこちらからの LINE（確定シフト・リマインド・締め切りのお知らせ・ヘルプの連絡）が送れなくなります。バイトからの LINE への返事は数に入りません。</p>
          {rate >= 80 && <p className="error" style={{ margin: 0, fontWeight: 700 }}>上限の{rate}%まで使っています。LINE 公式アカウントのプランを上げるか、送る回数を減らしてください。</p>}
        </> : quota ? <p style={{ margin: 0 }}>今月 {used.toLocaleString()}通。今のプランは送信数の上限がありません。</p>
          : <p className="muted" style={{ margin: 0 }}>LINE から上限を取れませんでした。下はこのシステムが数えた送信数（{ours}通）です。</p>}
      </section>
      <section className="card scroll">
        <h2>会社ごと</h2>
        <table className="list">
          <thead><tr><th>会社</th><th>今月</th><th>先月</th><th>全体に占める割合</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><b>{r.name}</b></td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.cur}通</td>
                <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.prev}通</td>
                <td>{ours ? Math.round((r.cur / ours) * 100) : 0}%</td>
                <td><Link href={`/admin/${r.id}`}>開く</Link></td>
              </tr>
            ))}
            {other > 0 && <tr><td className="muted">会社に紐づかない送信</td><td>{other}通</td><td /><td /><td /></tr>}
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>LINE の数え方とずれることがあります（月の区切りは日本時間）。</p>
      </section>
    </AdminShell>
  );
}
