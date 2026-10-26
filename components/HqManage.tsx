'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createStore, inviteManager, removeAccountHq, setManagerNeighbors, updateAccount } from '@/app/hq/actions';
import { useRouter } from 'next/navigation';

type Person = { userId: string; email: string; name: string; title: string; extras: string[]; role: string; storeId: string; store: string; lastLogin?: string | null };
const ago = (t?: string | null) => { if (!t) return 'まだログインなし'; const d = Math.floor((Date.now() - new Date(t).getTime()) / 86400e3); return `最終ログイン：${d <= 0 ? '今日' : d === 1 ? '昨日' : `${d}日前`}`; };
const longAgo = (t?: string | null) => !t || Date.now() - new Date(t).getTime() > 30 * 86400e3;
type Kind = 'manager' | 'staff' | 'hq'; // 店長・社員（店のアカウント）・本部
const kindOf = (p: Person): Kind => (p.role === 'hq' ? 'hq' : p.title === '社員' ? 'staff' : 'manager');
const roleOf = (k: Kind) => (k === 'hq' ? 'hq' as const : 'manager' as const);
const titleOf = (k: Kind) => (k === 'staff' ? '社員' : '店長');

export default function HqManage({ companyId, stores, people, hqCanEdit, me, managerNeighbors }: {
  companyId: string; stores: { id: string; name: string }[]; people: Person[]; hqCanEdit: boolean; me: string; managerNeighbors: boolean;
}) {
  const [mgrNb, setMgrNb] = useState(managerNeighbors);
  const router = useRouter();
  const [edit, setEdit] = useState<string | null>(null);
  const [eRole, setERole] = useState<Kind>('manager');
  const [eName, setEName] = useState('');
  const [eExtras, setEExtras] = useState<string[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const nameOf = (id: string) => stores.find(s => s.id === id)?.name ?? '';
  const [eStore, setEStore] = useState('');
  const [confirmRm, setConfirmRm] = useState<string | null>(null);
  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Kind>('manager');
  const [name, setName] = useState('');
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="cols">
      <section className="card wide" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>店舗</h2>
        <div className="row">
          {stores.map(s => <Link key={s.id} className="btn sm" href={`/store/${s.id}`}>{s.name}</Link>)}
        </div>
        <div className="row">
          <label htmlFor="new-store" className="muted">店舗を追加</label>
          <input id="new-store" className="input" placeholder="店舗名" value={storeName} onChange={e => setStoreName(e.target.value)} />
          <button className="btn" disabled={pending || !storeName.trim()} onClick={() => start(async () => { const r = await createStore(companyId, storeName); setMsg(r.message ?? ''); setStoreName(''); })}>追加</button>
        </div>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
          店のシフト表・メンバー・設定：{hqCanEdit ? '本部も変えられます' : '本部は見るだけです（各店の店長が決めます）'}
        </p>
        <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" checked={mgrNb} disabled={pending} style={{ marginTop: 4 }}
            onChange={e => { const v = e.target.checked; setMgrNb(v); start(async () => { const r = await setManagerNeighbors(companyId, v); setMsg(r.message); }); }} />
          <span>店長も自分の店の「近隣の店」を選べる<br /><span className="muted" style={{ fontSize: 12 }}>オンにすると、各店の店長が店舗の設定で近隣の店を選べます。近隣に選んだ店のヘルプOKの人には、店長が自分でヘルプを頼めます。</span></span>
        </label>
        {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
      </section>
      <section className="card narrow" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>アカウント（店長・社員・本部）</h2>
        {people.length === 0 && <p className="muted" style={{ margin: 0 }}>まだいません</p>}
        {people.map(p => (
          <div key={p.userId} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ wordBreak: 'break-all' }}><b>{p.name || '（名前なし）'}</b>{p.userId === me && <span className="muted">（自分）</span>}<br /><span className="muted" style={{ fontSize: 12 }}>{p.email}</span><br /><span style={{ fontSize: 12, color: longAgo(p.lastLogin) ? 'var(--ngInk)' : 'var(--sub)' }}>{ago(p.lastLogin)}</span></span>
              <span className="muted">{p.role === 'hq' ? '本部' : `${p.store} ${p.title || '店長'}`}{p.role !== 'hq' && p.extras.length > 0 && `（兼務：${p.extras.map(nameOf).filter(Boolean).join('、')}）`}</span>
            </div>
            {edit === p.userId ? (
              <div className="row">
                <input aria-label="名前" className="input" placeholder="名前" value={eName} onChange={e => setEName(e.target.value)} style={{ width: 120 }} />
                <select aria-label="役割" className="input" value={eRole} onChange={e => setERole(e.target.value as Kind)}>
                  <option value="manager">店長</option><option value="staff">社員</option><option value="hq">本部</option>
                </select>
                {eRole !== 'hq' && <select aria-label="店舗" className="input" value={eStore} onChange={e => setEStore(e.target.value)}>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>}
                {eRole !== 'hq' && stores.length > 1 && <ExtraPick stores={stores.filter(s => s.id !== eStore)} value={eExtras} onChange={setEExtras} />}
                <button className="btn sm primary" disabled={pending} onClick={() => start(async () => {
                  const r = await updateAccount(companyId, p.userId, roleOf(eRole), eRole !== 'hq' ? eStore : null, eName, titleOf(eRole), eRole !== 'hq' ? eExtras.filter(x => x !== eStore) : []);
                  setMsg(r.message); if (r.ok) { setEdit(null); router.refresh(); }
                })}>保存</button>
                <button className="btn sm" onClick={() => setEdit(null)}>やめる</button>
              </div>
            ) : confirmRm === p.userId ? (
              <div className="row">
                <span className="error">外すと、この人はログインしても使えなくなります</span>
                <button className="btn sm danger" disabled={pending} onClick={() => start(async () => {
                  const r = await removeAccountHq(companyId, p.userId);
                  setMsg(r.message); setConfirmRm(null); if (r.ok) router.refresh();
                })}>外す</button>
                <button className="btn sm" onClick={() => setConfirmRm(null)}>やめる</button>
              </div>
            ) : (
              <div className="row">
                <button className="btn sm" onClick={() => { setEdit(p.userId); setERole(kindOf(p)); setEName(p.name); setEExtras(p.extras); setEStore(p.storeId || stores[0]?.id || ''); }}>変更</button>
                {p.userId !== me && <button className="btn sm" onClick={() => setConfirmRm(p.userId)}>外す</button>}
              </div>
            )}
          </div>
        ))}
        <div className="field"><label htmlFor="inv-name">名前</label><input id="inv-name" className="input" placeholder="例：谷屋 海斗" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="inv-email">招待するメールアドレス</label><input id="inv-email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="row">
          <select aria-label="役割" className="input" value={role} onChange={e => setRole(e.target.value as Kind)}>
            <option value="manager">店長</option><option value="staff">社員</option><option value="hq">本部</option>
          </select>
          {role !== 'hq' && <select aria-label="店舗" className="input" value={storeId} onChange={e => setStoreId(e.target.value)}>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>}
        </div>
        {role !== 'hq' && stores.length > 1 && <ExtraPick stores={stores.filter(s => s.id !== storeId)} value={extras} onChange={setExtras} />}
        <button className="btn primary" disabled={pending || !email || !name.trim()} onClick={() => start(async () => { const r = await inviteManager(companyId, email, roleOf(role), role !== 'hq' ? storeId : null, name, titleOf(role), role !== 'hq' ? extras.filter(x => x !== storeId) : []); setMsg(r.message); if (r.ok) { setEmail(''); setName(''); setExtras([]); } })}>招待する</button>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>社員のアカウントは、メンバーと店舗の設定以外は店長と同じことができます。社員は LINE で「アカウント」と送って自分で作ることもできます。30日以上ログインのないアカウントは赤で出ます。辞めた人は「外す」で止めてください。</p>
        {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
      </section>
    </div>
  );
}

/** 兼務する店（かけもちの店長・社員）：左の「店舗」で切り替えて、その店も使える */
function ExtraPick({ stores, value, onChange }: { stores: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, alignItems: 'center' }}>
      <span className="muted">兼務する店：</span>
      {stores.map(s => (
        <label key={s.id} className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={value.includes(s.id)} onChange={e => onChange(e.target.checked ? [...value, s.id] : value.filter(x => x !== s.id))} />{s.name}
        </label>
      ))}
    </div>
  );
}
