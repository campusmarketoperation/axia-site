'use client';
import { useState, useTransition } from 'react';
import { setMemberHelpStores } from '@/app/store/[storeId]/actions';

type M = { id: string; name: string; line: boolean; helpStores: string[] | null };

/** 人ごとの「ヘルプに行ける店」（LINE登録の時に本人が決める。店長があとから変えられる） */
export default function HelpStoresEditor({ storeId, stores, members, readOnly }: { storeId: string; stores: { id: string; name: string }[]; members: M[]; readOnly: boolean }) {
  const [list, setList] = useState(members);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const save = (id: string, ids: string[] | null) => {
    setList(list.map(m => m.id === id ? { ...m, helpStores: ids } : m));
    start(async () => {
      try { await setMemberHelpStores(storeId, id, ids); setMsg('保存しました'); }
      catch { setMsg('保存できませんでした。画面を読み込み直してください'); }
    });
  };
  return (
    <section className="card scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0 }}>ヘルプに行ける店（人ごと）</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        LINEで登録した時に本人が選びます。ここで店長が変えられます。チェックのない店からは、その人にヘルプを頼めません。
        「未設定」の人は、どの店からも頼めます（その期間に「ヘルプOK」と答えた時だけ）。
      </p>
      <table className="list">
        <thead><tr><th>名前</th>{stores.map(s => <th key={s.id} style={{ textAlign: 'center' }}>{s.name}</th>)}<th></th></tr></thead>
        <tbody>
          {list.map(m => (
            <tr key={m.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{m.name}{m.helpStores === null && <span className="muted" style={{ fontSize: 11 }}>（未設定）</span>}</td>
              {stores.map(s => {
                const on = m.helpStores === null ? false : m.helpStores.includes(s.id);
                return (
                  <td key={s.id} style={{ textAlign: 'center' }}>
                    <input type="checkbox" aria-label={`${m.name} ${s.name}`} disabled={readOnly || pending} checked={on}
                      onChange={e => {
                        const cur = m.helpStores ?? [];
                        save(m.id, e.target.checked ? [...cur, s.id] : cur.filter(x => x !== s.id));
                      }} />
                  </td>
                );
              })}
              <td style={{ whiteSpace: 'nowrap' }}>
                {!readOnly && <>
                  <button className="btn sm" disabled={pending} onClick={() => save(m.id, stores.map(s => s.id))}>全部</button>{' '}
                  <button className="btn sm" disabled={pending} onClick={() => save(m.id, [])}>なし</button>
                </>}
              </td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={stores.length + 2} className="muted">アルバイトがまだいません</td></tr>}
        </tbody>
      </table>
      {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
    </section>
  );
}
