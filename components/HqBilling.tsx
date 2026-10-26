'use client';
import { useState, useTransition } from 'react';
import { openBillingPortal, startCardBilling } from '@/app/hq/actions';
import { INV_LABEL, SUB_LABEL, overdue, yen, ymd } from '@/lib/billingLabels';

export default function HqBilling({ companyId, method, status, monthly, stores, trialEnds, periodEnd, invStatus, invAmount, invDue, invUrl, justPaid }: {
  companyId: string; method: 'card' | 'invoice'; status: string; monthly: number; stores: number; trialEnds: string | null;
  periodEnd: string | null; invStatus: string | null; invAmount: number | null; invDue: string | null; invUrl: string | null; justPaid: boolean;
}) {
  const [msg, setMsg] = useState(justPaid ? 'お申し込みありがとうございます。反映まで少しかかることがあります' : '');
  const [pending, start] = useTransition();
  const started = !['none', 'canceled', 'incomplete_expired'].includes(status);
  const [label, cls] = SUB_LABEL[status] ?? [status, 'wait'];
  const late = overdue(invStatus, invDue);
  const go = (fn: () => Promise<{ ok: boolean; url?: string; message?: string }>) => start(async () => {
    const r = await fn();
    if (r.ok && r.url) window.location.href = r.url; else setMsg(r.message ?? 'うまくいきませんでした');
  });

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>お支払い</h2>
        <span className={`pill ${cls}`}>{label}</span>
      </div>
      <p style={{ margin: 0 }}>月額 <b>{yen(monthly)}</b>（{stores}店舗）　／　{method === 'invoice' ? '請求書（銀行振込）' : 'カード自動払い'}</p>
      {trialEnds && !started && <p className="muted" style={{ margin: 0 }}>お試しは {trialEnds.replace(/-/g, '/')} まで。先にカードを登録しても、お試しが終わるまで請求されません。</p>}
      {periodEnd && started && <p className="muted" style={{ margin: 0 }}>次の請求：{ymd(periodEnd)}</p>}
      {invStatus && (
        <p style={{ margin: 0 }}>最新の請求書：{yen(invAmount)}　<span className={`pill ${invStatus === 'paid' ? 'ok' : late ? 'stop' : 'wait'}`}>{late ? '期限切れ' : INV_LABEL[invStatus] ?? invStatus}</span>
          {invDue && invStatus === 'open' && <span className="muted">　期限 {ymd(invDue)}</span>}
          {invUrl && <>　<a href={invUrl} target="_blank" rel="noreferrer">{invStatus === 'open' ? '請求書を見る・支払う' : '請求書を見る'}</a></>}
        </p>
      )}
      <div className="row">
        {method === 'card' && !started && <button className="btn primary" disabled={pending} onClick={() => go(() => startCardBilling(companyId))}>カードを登録して申し込む</button>}
        {method === 'invoice' && !started && <span className="muted">請求書払いは、AXIA が手続きを始めると毎月メールで請求書が届きます。</span>}
        {started && <button className="btn" disabled={pending} onClick={() => go(() => openBillingPortal(companyId))}>{method === 'card' ? 'カードの変更・明細・解約' : '請求書・支払いの確認'}</button>}
      </div>
      {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
    </section>
  );
}
