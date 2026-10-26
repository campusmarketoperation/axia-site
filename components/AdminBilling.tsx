'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { beginInvoiceBilling, billingAction, updateCompany } from '@/app/admin/actions';
import { INV_LABEL, SUB_LABEL, overdue, yen, ymd } from '@/lib/billingLabels';

export type BillingInfo = {
  companyId: string; method: 'card' | 'invoice'; email: string; days: number;
  status: string; periodEnd: string | null; customerUrl: string | null;
  invStatus: string | null; invAmount: number | null; invDue: string | null; invUrl: string | null;
  monthly: number; ready: boolean; test: boolean;
  companyStatus: string; notice: boolean; stopOn: string | null; stoppedReason: string | null;
};

export default function AdminBilling({ b }: { b: BillingInfo }) {
  const router = useRouter();
  const [method, setMethod] = useState(b.method);
  const [email, setEmail] = useState(b.email);
  const [days, setDays] = useState(b.days);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const [label, cls] = SUB_LABEL[b.status] ?? [b.status, 'wait'];
  const started = !['none', 'canceled', 'incomplete_expired'].includes(b.status);
  const late = overdue(b.invStatus, b.invDue);
  const [stopOn, setStopOn] = useState(b.stopOn ?? '');
  const [confirm, setConfirm] = useState<'stop' | 'cancel' | null>(null);
  const act = (a: Parameters<typeof billingAction>[1]) => start(async () => {
    const r = await billingAction(b.companyId, a, stopOn || null);
    setMsg(r.message ?? ''); setConfirm(null); router.refresh();
  });
  const stopped = b.companyStatus === 'stopped';

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>お支払い{b.test && <span className="pill wait" style={{ marginLeft: 8, fontSize: 11 }}>テストモード</span>}</h2>
        <span className={`pill ${cls}`}>{label}</span>
      </div>
      {!b.ready && <p className="notice" style={{ margin: 0 }}>Stripe の鍵（STRIPE_SECRET_KEY）がまだ入っていません。</p>}

      <div className="row">
        <div className="field">
          <label htmlFor="bm">払い方</label>
          <select id="bm" className="input" value={method} disabled={started} onChange={e => setMethod(e.target.value as 'card' | 'invoice')}>
            <option value="card">カード自動払い（本部が登録）</option>
            <option value="invoice">請求書（銀行振込）</option>
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label htmlFor="be">請求書・領収書の送り先メール</label>
          <input id="be" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        {method === 'invoice' && (
          <div className="field">
            <label htmlFor="bd">支払い期限（請求書から何日）</label>
            <input id="bd" type="number" min={1} max={90} className="input" value={days} onChange={e => setDays(Number(e.target.value))} />
          </div>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>毎月の請求：{yen(b.monthly)}（1店舗の月額 × 店舗数）。店舗を増やしたり月額を変えたりすると、次の請求から変わります。</p>
      <div className="row">
        <button className="btn" disabled={pending} onClick={() => start(async () => {
          await updateCompany(b.companyId, { billing_method: method, billing_email: email.trim(), invoice_days: days });
          setMsg('保存しました'); router.refresh();
        })}>保存する</button>
        {method === 'invoice' && !started && (
          <button className="btn primary" disabled={pending || !b.ready} onClick={() => start(async () => {
            await updateCompany(b.companyId, { billing_method: 'invoice', billing_email: email.trim(), invoice_days: days });
            const r = await beginInvoiceBilling(b.companyId);
            setMsg(r.message); router.refresh();
          })}>請求書払いで始める</button>
        )}
        {method === 'card' && !started && <span className="muted">本部の画面の「お支払い」から、本部の人がカードを登録すると始まります。</span>}
        {b.customerUrl && <a className="btn" href={b.customerUrl} target="_blank" rel="noreferrer">Stripe で見る</a>}
      </div>
      {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}

      {(b.invStatus || b.periodEnd) && (
        <table className="list">
          <tbody>
            {b.periodEnd && <tr><th style={{ width: 160 }}>次の請求</th><td>{ymd(b.periodEnd)}</td></tr>}
            {b.invStatus && <tr><th>最新の請求書</th><td>
              {yen(b.invAmount)}　<span className={`pill ${b.invStatus === 'paid' ? 'ok' : late ? 'stop' : 'wait'}`}>{late ? '期限切れ' : INV_LABEL[b.invStatus] ?? b.invStatus}</span>
              {b.invDue && <span className="muted">　期限 {ymd(b.invDue)}</span>}
              {b.invUrl && <>　<a href={b.invUrl} target="_blank" rel="noreferrer">請求書を見る</a></>}
            </td></tr>}
          </tbody>
        </table>
      )}
      {(late || ['past_due', 'unpaid'].includes(b.status)) && (
        <p className="error" style={{ margin: 0 }}>支払いが遅れています。下の「未払いの対応」から、お知らせを出すか停止できます。</p>
      )}

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>未払いの対応</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          自動では止まりません。お知らせを出すと、本部・店長の画面の上に「お支払いが確認できていません」と出ます。停止予定日を入れると、その日に自動で停止します。
          どちらも、支払いが確認できたら自動で取り消されます（未払いで停止した場合は自動で再開）。
        </p>
        <div className="row">
          {stopped
            ? <span className="pill stop">停止中{b.stoppedReason === 'unpaid' ? '（未払い）' : ''}</span>
            : b.notice || b.stopOn
              ? <span className="pill wait">お知らせ中{b.stopOn ? `・${b.stopOn.replace(/-/g, '/')} に停止予定` : ''}</span>
              : <span className="muted">今は何もしていません</span>}
        </div>
        {!stopped && (
          <div className="row">
            <div className="field"><label htmlFor="stopon">停止予定日（空ならお知らせだけ）</label>
              <input id="stopon" type="date" className="input" value={stopOn} onChange={e => setStopOn(e.target.value)} /></div>
            <button className="btn" disabled={pending} onClick={() => act('notice')}>{b.notice || b.stopOn ? 'お知らせを更新' : 'お知らせを出す'}</button>
            {(b.notice || b.stopOn) && <button className="btn" disabled={pending} onClick={() => act('clear')}>取り消す</button>}
          </div>
        )}
        <div className="row">
          {b.invStatus === 'open' && b.method === 'invoice' && <button className="btn" disabled={pending} onClick={() => act('resend')}>請求書をもう一度送る</button>}
          {!stopped && (confirm === 'stop'
            ? <><span className="error">今すぐ停止します（ログイン・LINE・提出画面が止まります）</span><button className="btn danger" disabled={pending} onClick={() => act('stop')}>停止する</button><button className="btn" onClick={() => setConfirm(null)}>やめる</button></>
            : <button className="btn danger" disabled={pending} onClick={() => setConfirm('stop')}>今すぐ停止</button>)}
          {stopped && <button className="btn primary" disabled={pending} onClick={() => act('resume')}>再開する</button>}
          {started && (confirm === 'cancel'
            ? <><span className="error">Stripe のサブスクを今すぐ解約します（今後の請求が止まります）</span><button className="btn danger" disabled={pending} onClick={() => act('cancel')}>解約する</button><button className="btn" onClick={() => setConfirm(null)}>やめる</button></>
            : <button className="btn" disabled={pending || !b.ready} onClick={() => setConfirm('cancel')}>サブスクを解約</button>)}
        </div>
      </div>
    </section>
  );
}
