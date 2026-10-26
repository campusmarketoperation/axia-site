'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPassword } from './actions';

export default function PasswordForm({ first }: { first: boolean }) {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      onSubmit={e => { e.preventDefault(); start(async () => {
        const r = await setPassword(pw, again);
        setMsg({ ok: r.ok, text: r.message });
        if (r.ok) setTimeout(() => { router.replace('/'); router.refresh(); }, 1200);
      }); }}>
      <div className="field">
        <label htmlFor="pw">新しいパスワード（8文字以上）</label>
        <input id="pw" className="input" type="password" required minLength={8} autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pw2">もう一度</label>
        <input id="pw2" className="input" type="password" required minLength={8} autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} />
      </div>
      <button className="btn primary" disabled={pending}>{pending ? '保存中…' : '決める'}</button>
      {msg && <p className={msg.ok ? 'notice' : 'error'} style={{ margin: 0 }}>{msg.text}</p>}
      {first
        ? <a className="muted" style={{ fontSize: 13, textAlign: 'center' }} href="/">あとで決める</a>
        : <a className="muted" style={{ fontSize: 13, textAlign: 'center' }} href="/">戻る</a>}
    </form>
  );
}
