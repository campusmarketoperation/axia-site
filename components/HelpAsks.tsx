'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { HelpAsk } from '@/lib/data';
import { approveHelp, declineHelp } from '@/app/store/[storeId]/actions';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`; };

/** 自分の店の人への、ヘルプの依頼（所属店の店長が承認する） */
export default function HelpAsks({ storeId, asks }: { storeId: string; asks: HelpAsk[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  if (!asks.length && !msg) return null;
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderColor: '#E6C98F' }}>
      <h2 style={{ margin: 0 }}>ヘルプの依頼 {asks.length > 0 && <span className="pill wait" style={{ fontSize: 12 }}>{asks.length}件 承認待ち</span>}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>承認すると、この店のシフト表に「行き先＋時間」が入り、本人にLINEで知らせます。入り時間はヘルプ先の店長が決めます。</p>
      {asks.map(a => (
        <div key={a.id} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
          <div>
            <b>{md(a.date)}　{a.memberName}さん → {a.toStore}</b>
            <div className="muted" style={{ fontSize: 12 }}>依頼：{a.requestedBy || '—'}</div>
          </div>
          <div className="row">
            <button className="btn primary sm" disabled={pending} onClick={() => start(async () => { const r = await approveHelp(storeId, a.id); setMsg(r.message ?? ''); router.refresh(); })}>承認する</button>
            <button className="btn sm" disabled={pending} onClick={() => start(async () => { const r = await declineHelp(storeId, a.id); setMsg(r.message ?? ''); router.refresh(); })}>断る</button>
          </div>
        </div>
      ))}
      {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
    </section>
  );
}
