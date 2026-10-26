'use client';
import { useEffect, useState, useTransition } from 'react';
import type { Member } from '@/lib/shift';
import { addMember, reorderMembers, retireMember, setExtraStores, unlinkLine, updateMember } from '@/app/store/[storeId]/members/actions';

type Other = { id: string; name: string };

export default function MembersEditor({ storeId, members, readOnly = false, others = [] }: { storeId: string; members: Member[]; readOnly?: boolean; others?: Other[] }) {
  if (readOnly) {
    return (
      <section className="card wide scroll">
        <p className="muted" style={{ marginTop: 0 }}>見るだけ（メンバーの追加・変更は店長がします）</p>
        <table className="list">
          <thead><tr><th>順番</th><th>名前</th><th>種類</th><th>LINE</th><th>番号</th></tr></thead>
          <tbody>
            {members.map((m, i) => (
              <tr key={m.id}><td>{i + 1}</td><td>{m.name}</td><td>{m.kind === 'staff' ? '社員' : 'アルバイト'}{m.kind === 'staff' && !!m.extra_store_ids?.length && <span className="muted" style={{ fontSize: 12 }}>（兼務：{others.filter(o => m.extra_store_ids!.includes(o.id)).map(o => o.name).join('、')}）</span>}</td>
                <td>{m.line_user_id ? <span className="pill ok">登録済み</span> : <span className="muted">未登録</span>}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '.1em' }}>{m.pin ?? '—'}</td></tr>
            ))}
            {members.length === 0 && <tr><td colSpan={5} className="muted">まだメンバーがいません</td></tr>}
          </tbody>
        </table>
      </section>
    );
  }
  return <Editor storeId={storeId} members={members} others={others} />;
}

function Editor({ storeId, members, others }: { storeId: string; members: Member[]; others: Other[] }) {
  const [list, setList] = useState(members);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'part' | 'staff'>('part');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setList(members), [members]);

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
    start(async () => { await reorderMembers(storeId, next.map(m => m.id)); });
  };

  return (
    <div className="cols">
      <section className="card wide scroll">
        <table className="list">
          <thead><tr><th>順番</th><th>名前</th><th>種類</th><th>LINE</th><th>番号</th><th></th></tr></thead>
          <tbody>
            {list.map((m, i) => (
              <tr key={m.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" aria-label={`${m.name}を上へ`} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>{' '}
                  <button className="btn sm" aria-label={`${m.name}を下へ`} onClick={() => move(i, 1)} disabled={i === list.length - 1}>↓</button>
                </td>
                <td>
                  <input className="input" aria-label="名前" defaultValue={m.name}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== m.name) start(async () => { await updateMember(storeId, m.id, { name: v }); }); }} />
                </td>
                <td>
                  <select className="input" aria-label="種類" defaultValue={m.kind}
                    onChange={e => start(async () => { await updateMember(storeId, m.id, { kind: e.target.value as 'part' | 'staff' }); })}>
                    <option value="part">アルバイト</option>
                    <option value="staff">社員</option>
                  </select>
                  {m.kind === 'staff' && others.length > 0 && <ExtraStores storeId={storeId} member={m} others={others} />}
                </td>
                <td>{m.line_user_id
                  ? <span className="row"><span className="pill ok">登録済み</span><button className="btn sm" onClick={() => start(async () => { await unlinkLine(storeId, m.id); })}>外す</button></span>
                  : <span className="muted">未登録</span>}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '.1em' }}>{m.pin ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {confirmId === m.id
                    ? <span className="row" style={{ justifyContent: 'flex-end' }}>
                        <span className="muted">表から外しますか？</span>
                        <button className="btn sm danger" onClick={() => { setConfirmId(null); start(async () => { await retireMember(storeId, m.id); }); }}>外す</button>
                        <button className="btn sm" onClick={() => setConfirmId(null)}>やめる</button>
                      </span>
                    : <button className="btn sm" onClick={() => setConfirmId(m.id)}>辞めた</button>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className="muted">まだメンバーがいません</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="card narrow" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2>メンバーを追加</h2>
        <div className="field"><label htmlFor="new-name">名前</label><input id="new-name" className="input" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="new-kind">種類</label>
          <select id="new-kind" className="input" value={kind} onChange={e => setKind(e.target.value as 'part' | 'staff')}>
            <option value="part">アルバイト</option>
            <option value="staff">社員（表の一番下に固定）</option>
          </select>
        </div>
        <button className="btn primary" disabled={pending || !name.trim()} onClick={() => start(async () => { await addMember(storeId, name, kind); setName(''); })}>追加する</button>
      </section>
    </div>
  );
}

/** 社員のかけもち：兼務する店を選ぶ */
function ExtraStores({ storeId, member, others }: { storeId: string; member: Member; others: Other[] }) {
  const [ids, setIds] = useState<string[]>(member.extra_store_ids ?? []);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const label = others.filter(o => ids.includes(o.id)).map(o => o.name).join('、');
  return (
    <details style={{ marginTop: 6, fontSize: 12 }}>
      <summary style={{ cursor: 'pointer' }}>{label ? `兼務：${label}` : '兼務する店（かけもち）'}</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
        {others.map(o => (
          <label key={o.id} className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={ids.includes(o.id)} disabled={pending} onChange={e => {
              const next = e.target.checked ? [...ids, o.id] : ids.filter(x => x !== o.id);
              setIds(next);
              start(async () => { const r = await setExtraStores(storeId, member.id, next); setMsg(r.message ?? ''); });
            }} />{o.name}
          </label>
        ))}
        <span className="muted">兼務先のシフト表にも出ます。日ごとに「→店名」で、どっちの店で出勤か選べます。</span>
        {msg && <span className="muted">{msg}</span>}
      </div>
    </details>
  );
}
