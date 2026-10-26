'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteCompany } from '@/app/admin/actions';

export default function DeleteCompany({ companyId, name }: { companyId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderColor: '#E9B3C0' }}>
      <h2 style={{ margin: 0 }}>会社を消す</h2>
      {!open ? (
        <div className="row">
          <span className="muted">この会社のデータをすべて消します。元に戻せません。</span>
          <button className="btn danger" onClick={() => setOpen(true)}>会社を消す…</button>
        </div>
      ) : <>
        <p className="error" style={{ margin: 0 }}>
          消えるもの：店舗・メンバー・シフトの希望・シフト表・ヘルプ・LINEの登録・送信記録・店長と本部のアカウント・Stripe の申し込み（毎月の請求も止まります）。
          発行済みの請求書の記録は Stripe 側に残ります。
        </p>
        <div className="field">
          <label htmlFor="del-name">確認のため、会社名「{name}」をそのまま入れてください</label>
          <input id="del-name" className="input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
        </div>
        <div className="row">
          <button className="btn danger" disabled={pending || typed.trim() !== name.trim()} onClick={() => start(async () => {
            const r = await deleteCompany(companyId, typed);
            if (r.ok) { router.push('/admin'); router.refresh(); } else setMsg(r.message ?? '');
          })}>{pending ? '消しています…' : 'すべて消す'}</button>
          <button className="btn" onClick={() => { setOpen(false); setTyped(''); }}>やめる</button>
        </div>
        {msg && <p className="error" style={{ margin: 0 }}>{msg}</p>}
      </>}
    </section>
  );
}
