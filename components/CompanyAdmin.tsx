'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { inviteHq, removeAccount, updateCompany } from '@/app/admin/actions';

type Props = {
  company: { id: string; name: string; status: 'trial' | 'active' | 'stopped'; price: number; note: string; trialEnds: string | null; hqCanEdit: boolean };
  stores: { id: string; name: string; code: string }[];
  people: { id: string; email: string; name?: string; title?: string; role: string; store: string }[];
};

export default function CompanyAdmin({ company, stores, people }: Props) {
  const [status, setStatus] = useState(company.status);
  const [price, setPrice] = useState(company.price);
  const [note, setNote] = useState(company.note);
  const [trialEnds, setTrialEnds] = useState(company.trialEnds ?? '');
  const [hqEdit, setHqEdit] = useState(company.hqCanEdit);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [pending, start] = useTransition();
  const save = (patch: Parameters<typeof updateCompany>[1], done = '保存しました') =>
    start(async () => { await updateCompany(company.id, patch); setMsg(done); });

  return (
    <div className="cols">
      <section className="card wide" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0 }}>契約</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="st">状態</label>
            <select id="st" className="input" value={status} onChange={e => setStatus(e.target.value as Props['company']['status'])}>
              <option value="trial">お試し</option><option value="active">契約中</option><option value="stopped">停止中</option>
            </select>
          </div>
          <div className="field"><label htmlFor="te">お試しの終わり</label><input id="te" type="date" className="input" value={trialEnds} onChange={e => setTrialEnds(e.target.value)} /></div>
          <div className="field"><label htmlFor="pr">1店舗の月額（円）</label><input id="pr" type="number" min={0} className="input" value={price} onChange={e => setPrice(Number(e.target.value))} /></div>
        </div>
        <div className="field"><label htmlFor="nt">メモ（運営だけ見れる）</label><textarea id="nt" className="input" style={{ height: 80, padding: 10 }} value={note} onChange={e => setNote(e.target.value)} /></div>
        <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" checked={hqEdit} style={{ marginTop: 4 }} onChange={e => { setHqEdit(e.target.checked); save({ hq_can_edit: e.target.checked }, e.target.checked ? '本部も店のシフトを変えられるようにしました' : '本部は店のシフトを見るだけにしました'); }} />
          <span>本部も店のシフト表・メンバー・設定を変えられる<br /><span className="muted" style={{ fontSize: 12 }}>オフにすると、本部は見るだけ（ヘルプを頼む・店舗の追加・店長の招待・近隣の設定はできます）。</span></span>
        </label>
        <p className="muted" style={{ margin: 0 }}>月額の目安：{(price * stores.length).toLocaleString()}円（{stores.length}店舗）</p>
        <div className="row">
          <button className="btn primary" disabled={pending} onClick={() => {
            if (status === 'stopped' && company.status !== 'stopped' && !confirmStop) { setConfirmStop(true); return; }
            setConfirmStop(false);
            save({ status, price_per_store: price, note, trial_ends: trialEnds || null });
          }}>保存する</button>
          {confirmStop && <span className="error">停止すると、この会社の店長・本部はログインしても使えなくなり、提出画面とLINEも止まります。もう一度「保存する」で停止します。</span>}
          {msg && <span className="muted">{msg}</span>}
        </div>
      </section>
      <section className="card narrow" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>アカウント</h2>
        {people.length === 0 && <p className="muted" style={{ margin: 0 }}>まだいません</p>}
        {people.map(p => (
          <div key={p.id} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ wordBreak: 'break-all' }}>{p.name && <b>{p.name}　</b>}{p.email}<br /><span className="muted">{p.role === 'hq' ? '本部' : `${p.store} ${p.title || '店長'}`}</span></span>
            <button className="btn sm" onClick={() => start(async () => { await removeAccount(company.id, p.id); })}>外す</button>
          </div>
        ))}
        <div className="field"><label htmlFor="hq-email">本部の人を招待</label><input id="hq-email" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <button className="btn" disabled={pending || !email} onClick={() => start(async () => { const r = await inviteHq(company.id, email); setMsg(r.message); if (r.ok) setEmail(''); })}>招待する</button>
        <h2 style={{ margin: '10px 0 0' }}>店舗</h2>
        {stores.map(s => (
          <div key={s.id} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
            <Link href={`/store/${s.id}`}>{s.name}</Link><span className="muted">LINEコード {s.code}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
