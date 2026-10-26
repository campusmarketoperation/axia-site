'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';

export type StaffRow = { id: string; name: string; kind: string; store: string; storeId: string; extra: string; line: boolean; help: string };

/** 全店のスタッフ一覧（名前で探す・店や種類でしぼる） */
export default function HqStaffList({ rows, stores }: { rows: StaffRow[]; stores: { id: string; name: string }[] }) {
  const [q, setQ] = useState('');
  const [store, setStore] = useState('');
  const [kind, setKind] = useState('');
  const [noLine, setNoLine] = useState(false);
  const list = useMemo(() => rows.filter(r =>
    (!q || r.name.includes(q.trim())) && (!store || r.storeId === store) && (!kind || r.kind === kind) && (!noLine || !r.line)
  ), [rows, q, store, kind, noLine]);
  const lineN = rows.filter(r => r.line).length;
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>スタッフ（全店）</span><b>{rows.length}人</b></div>
        <div className="kpi"><span>アルバイト</span><b>{rows.filter(r => r.kind === 'アルバイト').length}人</b></div>
        <div className="kpi"><span>社員</span><b>{rows.filter(r => r.kind === '社員').length}人</b></div>
        <div className="kpi"><span>LINE 登録済み</span><b>{lineN} / {rows.length}人</b></div>
      </div>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row">
          <input className="input" style={{ flex: '1 1 200px' }} type="search" placeholder="名前で探す" value={q} onChange={e => setQ(e.target.value)} aria-label="名前で探す" />
          <select className="input" value={store} onChange={e => setStore(e.target.value)} aria-label="店舗">
            <option value="">全部の店</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input" value={kind} onChange={e => setKind(e.target.value)} aria-label="種類">
            <option value="">アルバイトと社員</option><option value="アルバイト">アルバイト</option><option value="社員">社員</option>
          </select>
          <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={noLine} onChange={e => setNoLine(e.target.checked)} />LINE 未登録の人だけ</label>
        </div>
        <div className="scroll">
          <table className="list" style={{ minWidth: 680 }}>
            <thead><tr><th>名前</th><th>店</th><th>種類</th><th>兼務</th><th>LINE</th><th>ヘルプに行ける店</th></tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id}>
                  <td><b>{r.name}</b></td>
                  <td><Link href={`/store/${r.storeId}/members`}>{r.store}</Link></td>
                  <td>{r.kind}</td>
                  <td className="muted">{r.extra || '—'}</td>
                  <td>{r.line ? <span className="pill ok">登録済み</span> : <span className="pill wait">未登録</span>}</td>
                  <td className="muted">{r.help}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6} className="muted">見つかりません</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ margin: 0 }}>{list.length}人を表示中。名前を押すと、その店のメンバーの画面に移ります。</p>
      </section>
    </>
  );
}
