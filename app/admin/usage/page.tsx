import Link from 'next/link';
import AdminShell from '@/components/AdminShell';
import { requireAdmin } from '@/lib/auth';
import { ago, pushCounts, usageByCompany } from '@/lib/adminStats';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = { trial: ['お試し', 'wait'], active: ['契約中', 'ok'], stopped: ['停止中', 'stop'] };

export default async function UsagePage() {
  const v = await requireAdmin();
  const [rows, push] = await Promise.all([usageByCompany(), pushCounts()]);
  const stale = (t: string | null, days: number) => !t || Date.now() - new Date(t).getTime() > days * 86400e3;
  return (
    <AdminShell email={v.email} active="/admin/usage">
      <div className="head"><h1 className="title">使われ方</h1></div>
      <p className="muted" style={{ margin: 0 }}>ログインが14日以上ない会社、確定が30日以上ない会社は赤で出します。早めに声をかけましょう。</p>
      <section className="card scroll">
        <table className="list" style={{ minWidth: 820 }}>
          <thead><tr><th>会社</th><th>状態</th><th>店舗</th><th>最後のログイン</th><th>最後に確定した期間</th><th>バイトの LINE 登録</th><th>LINE送信（今月）</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => {
              const rate = r.parts ? Math.round((r.partsLine / r.parts) * 100) : 0;
              return (
                <tr key={r.id}>
                  <td><b>{r.name}</b></td>
                  <td><span className={`pill ${STATUS[r.status]?.[1] ?? 'wait'}`}>{STATUS[r.status]?.[0] ?? r.status}</span></td>
                  <td>{r.stores}</td>
                  <td className={r.status !== 'stopped' && stale(r.lastLogin, 14) ? 'error' : ''}>{ago(r.lastLogin)}</td>
                  <td className={r.status !== 'stopped' && stale(r.lastConfirmed, 30) ? 'error' : ''}>{r.lastConfirmed ? `${r.lastConfirmed.slice(5).replace('-', '/')}〜（${r.lastConfirmedStore}）` : 'まだなし'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 80, height: 8, background: '#EEF0F4', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${rate}%`, height: '100%', background: rate >= 80 ? '#2C6B3F' : rate >= 50 ? '#C9A227' : '#B5455C' }} /></div>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.partsLine}/{r.parts}人</span>
                    </div>
                  </td>
                  <td>{push.cur.get(r.id) ?? 0}通</td>
                  <td><Link href={`/admin/${r.id}`}>開く</Link></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">まだ会社がありません</td></tr>}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
