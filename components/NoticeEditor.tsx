'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteNotice, saveNotice } from '@/app/admin/notices/actions';
import type { Announcement } from '@/lib/announce';

type Draft = { id?: string; body: string; level: 'info' | 'warn'; starts: string; ends: string; active: boolean };
const empty: Draft = { body: '', level: 'info', starts: '', ends: '', active: true };

export default function NoticeEditor({ list }: { list: Announcement[] }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(empty);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const showing = (a: Announcement) => a.active && (!a.starts_on || a.starts_on <= today) && (!a.ends_on || a.ends_on >= today);
  return (
    <div className="cols">
      <section className="card wide" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2>出したお知らせ</h2>
        {list.length === 0 && <p className="muted" style={{ margin: 0 }}>まだありません</p>}
        {list.map(a => (
          <div key={a.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 6 }}>
                <span className={`pill ${showing(a) ? 'ok' : 'wait'}`}>{showing(a) ? '表示中' : a.active ? '期間外' : '止めている'}</span>
                {a.level === 'warn' && <span className="pill stop">大事</span>}
                <span className="muted">{a.starts_on ? a.starts_on.replace(/-/g, '/') : '今すぐ'} 〜 {a.ends_on ? a.ends_on.replace(/-/g, '/') : '止めるまで'}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => setD({ id: a.id, body: a.body, level: a.level, starts: a.starts_on ?? '', ends: a.ends_on ?? '', active: a.active })}>直す</button>
                <button className="btn sm danger" disabled={pending} onClick={() => start(async () => { await deleteNotice(a.id); router.refresh(); })}>消す</button>
              </span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>
          </div>
        ))}
      </section>
      <section className="card narrow" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2>{d.id ? 'お知らせを直す' : '新しいお知らせ'}</h2>
        <textarea className="input" rows={4} maxLength={300} style={{ height: 'auto', padding: 10 }} placeholder="例：11/3（火）2:00〜4:00 はメンテナンスのため使えません" value={d.body} onChange={e => setD({ ...d, body: e.target.value })} />
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={d.level === 'warn'} onChange={e => setD({ ...d, level: e.target.checked ? 'warn' : 'info' })} />大事なお知らせ（赤で出す）</label>
        <div className="row"><label className="muted" style={{ width: 52 }}>いつから</label><input className="input" type="date" value={d.starts} onChange={e => setD({ ...d, starts: e.target.value })} /></div>
        <div className="row"><label className="muted" style={{ width: 52 }}>いつまで</label><input className="input" type="date" value={d.ends} onChange={e => setD({ ...d, ends: e.target.value })} /></div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={d.active} onChange={e => setD({ ...d, active: e.target.checked })} />出す（外すと止める）</label>
        <div className="row">
          <button className="btn primary" disabled={pending || !d.body.trim()} onClick={() => start(async () => { const r = await saveNotice(d); setMsg(r.message); if (r.ok) { setD(empty); router.refresh(); } })}>{d.id ? '保存する' : '出す'}</button>
          {d.id && <button className="btn" onClick={() => setD(empty)}>やめる</button>}
        </div>
        {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
      </section>
    </div>
  );
}
