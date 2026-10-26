'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendLoginLink, signInPassword } from './actions';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const sendLink = async () => {
    if (!email.trim()) { setState('error'); setMsg('メールアドレスを入れてください'); return; }
    setState('busy');
    const r = await sendLoginLink(email);
    setState(r.ok ? 'sent' : 'error');
    setMsg(r.ok ? '' : r.message);
  };

  return (
    <form
      onSubmit={async e => {
        e.preventDefault();
        setState('busy');
        const r = await signInPassword(email, password);
        if (r.ok) { router.replace('/'); router.refresh(); return; }
        setState('error'); setMsg(r.message);
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div className="field">
        <label htmlFor="email">メールアドレス</label>
        <input id="email" className="input" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">パスワード</label>
        <input id="password" className="input" type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
      </div>
      <button className="btn primary" disabled={state === 'busy'}>{state === 'busy' ? '確認中…' : 'ログイン'}</button>
      {state === 'error' && <p className="error" style={{ margin: 0 }}>{msg}</p>}
      {state === 'sent' && <p className="notice" style={{ margin: 0 }}>メールを送りました。届いたリンクを開くとログインできます。そのあとパスワードを決められます。</p>}
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>パスワードをまだ決めていない・忘れた方</span>
        <button type="button" className="btn" disabled={state === 'busy'} onClick={sendLink}>ログイン用のリンクをメールで送る</button>
      </div>
    </form>
  );
}
