import Link from 'next/link';
import AdminShell from '@/components/AdminShell';
import NewCompanyForm from '@/components/NewCompanyForm';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';
import { SUB_LABEL, overdue } from '@/lib/billingLabels';
import { isStopped } from '@/lib/companyState';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = { trial: ['お試し', 'wait'], active: ['契約中', 'ok'], stopped: ['停止中', 'stop'] };

export default async function AdminPage() {
  const v = await requireAdmin();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [companies, stores, members, logs, hqs] = await Promise.all([
    db().from('companies').select('*').order('created_at', { ascending: false }),
    db().from('stores').select('id, company_id'),
    db().from('members').select('store_id').eq('active', true),
    db().from('line_logs').select('company_id').eq('kind', 'push').gte('created_at', monthStart),
    db().from('profiles').select('company_id, display_name').eq('role', 'hq'),
  ]);
  const storeCompany = new Map((stores.data ?? []).map(s => [s.id, s.company_id]));
  const count = <T,>(arr: T[], key: (x: T) => string | null | undefined) => {
    const m = new Map<string, number>();
    arr.forEach(x => { const k = key(x); if (k) m.set(k, (m.get(k) ?? 0) + 1); });
    return m;
  };
  const storeN = count(stores.data ?? [], s => s.company_id);
  const memberN = count(members.data ?? [], m => storeCompany.get(m.store_id));
  const pushN = count(logs.data ?? [], l => l.company_id);
  const list = companies.data ?? [];
  const active = list.filter(c => c.status !== 'stopped');
  // お試しが14日以内に終わるのに、まだ申し込み（カード登録・請求書）がない会社
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const daysTo = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86400e3);
  const ending = list.filter(c => c.status === 'trial' && c.trial_ends && daysTo(c.trial_ends) <= 14 && !['active', 'trialing', 'past_due'].includes(c.billing_status ?? 'none'))
    .sort((a, b) => a.trial_ends.localeCompare(b.trial_ends));
  const hqMail = (cid: string) => (hqs.data ?? []).filter(h => h.company_id === cid).map(h => h.display_name).filter(Boolean).join(',');
  const mailBody = (c: any) => `${c.name} ご担当者様\n\nいつも AXIA Shift をご利用いただき、ありがとうございます。\nお試し期間は ${c.trial_ends.replace(/-/g, '/')} までとなっております。\n引き続きご利用いただく場合は、本部画面の「お支払い」から、カードのご登録または請求書払いのお申し込みをお願いいたします。\n\nご不明な点があれば、このメールにご返信ください。\n\nAXIA\naxiaofficial.contact@gmail.com`;
  const mrr = list.filter(c => c.status === 'active').reduce((a, c) => a + (c.price_per_store ?? 0) * (storeN.get(c.id) ?? 0), 0);

  return (
    <AdminShell email={v.email} active="/admin">
      <div className="head"><h1 className="title">契約会社</h1></div>
      <div className="kpis">
        <div className="kpi"><span>利用中の会社</span><b>{active.length}社</b></div>
        <div className="kpi"><span>店舗</span><b>{stores.data?.length ?? 0}店舗</b></div>
        <div className="kpi"><span>登録スタッフ</span><b>{members.data?.length ?? 0}人</b></div>
        <div className="kpi"><span>月額の合計（契約中）</span><b>{mrr.toLocaleString()}円</b></div>
      </div>
      {ending.length > 0 && (
        <section className="card" style={{ borderColor: '#E8C77A', background: '#FFFBF0' }}>
          <h2>お試しがもうすぐ終わる会社（まだ申し込みなし）</h2>
          <table className="list">
            <thead><tr><th>会社</th><th>お試しの終わり</th><th>本部のメール</th><th></th></tr></thead>
            <tbody>
              {ending.map(c => {
                const left = daysTo(c.trial_ends), to = hqMail(c.id);
                return (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td>
                    <td>{c.trial_ends.replace(/-/g, '/')}　<span className={`pill ${left < 0 ? 'stop' : left <= 3 ? 'stop' : 'wait'}`}>{left < 0 ? `${-left}日過ぎ` : left === 0 ? '今日まで' : `あと${left}日`}</span></td>
                    <td className="muted">{to || '本部アカウントなし'}</td>
                    <td className="row" style={{ justifyContent: 'flex-end' }}>
                      {to && <a className="btn sm" href={`mailto:${to}?subject=${encodeURIComponent('【AXIA Shift】お試し期間終了のご案内')}&body=${encodeURIComponent(mailBody(c))}`}>案内メールを作る</a>}
                      <Link className="btn sm" href={`/admin/${c.id}`}>開く</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      <div className="cols">
        <section className="card wide scroll">
          <table className="list" style={{ minWidth: 720 }}>
            <thead><tr><th>会社</th><th>店舗</th><th>スタッフ</th><th>LINE送信（今月）</th><th>状態</th><th>支払い</th><th></th></tr></thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td>{storeN.get(c.id) ?? 0}</td>
                  <td>{memberN.get(c.id) ?? 0}</td>
                  <td>{pushN.get(c.id) ?? 0}通</td>
                  <td>{isStopped(c) ? <span className="pill stop">停止中</span> : <span className={`pill ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}{c.status === 'trial' && c.trial_ends ? `（〜${c.trial_ends.slice(5).replace('-', '/')}）` : ''}</span>}</td>
                  <td>{(() => {
                    const late = overdue(c.last_invoice_status, c.last_invoice_due);
                    const [l, k] = late ? ['期限切れ', 'stop'] : SUB_LABEL[c.billing_status ?? 'none'] ?? [c.billing_status, 'wait'];
                    return <>
                      <span className={`pill ${k}`}>{l}{c.billing_method === 'invoice' ? '・請求書' : ''}</span>
                      {c.status !== 'stopped' && c.stop_on && <div className="muted" style={{ fontSize: 12 }}>{c.stop_on.slice(5).replace('-', '/')} 停止予定</div>}
                      {c.status !== 'stopped' && !c.stop_on && c.billing_notice && <div className="muted" style={{ fontSize: 12 }}>お知らせ中</div>}
                    </>;
                  })()}</td>
                  <td><Link href={`/admin/${c.id}`}>開く</Link></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={7} className="muted">まだ会社がありません。右から追加してください。</td></tr>}
            </tbody>
          </table>
        </section>
        <NewCompanyForm />
      </div>
    </AdminShell>
  );
}
