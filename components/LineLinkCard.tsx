'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createLineLinkCode, unlinkMyLine } from '@/app/account/line/actions';

type Line = { id: string; name: string };

/** 店長・本部の LINE 通知（ヘルプの依頼・承認・お断りが届く）。1つのアカウントに何人でもつなげる */
export default function LineLinkCard({ lines, role }: { lines: Line[]; role: 'manager' | 'hq' }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const linked = lines.length > 0;
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>LINE通知</h2>
        <span className={`pill ${linked ? 'ok' : 'wait'}`}>{linked ? `${lines.length}人つながっています` : 'まだです'}</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {role === 'manager'
          ? 'この店の人へのヘルプの依頼、頼んだヘルプの承認・お断りが、LINEで届きます。'
          : '本部が頼んだヘルプの承認・お断りが、LINEで届きます。'}
        何人でもつなげます。
      </p>
      {linked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lines.map((l, i) => (
            <div key={l.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span>{l.name || `LINE ${i + 1}`}</span>
              <button className="btn sm" disabled={pending}
                onClick={() => start(async () => { await unlinkMyLine(l.id); setMsg(`${l.name || `LINE ${i + 1}`} を外しました`); router.refresh(); })}>外す</button>
            </div>
          ))}
        </div>
      )}
      {code ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span>つなぎたい人の LINE で、AXIA Shift のボット（バイトの人と同じ）を友だち追加して、これを送ってください：</span>
          <b style={{ fontSize: 22, letterSpacing: '.08em' }}>通知 {code}</b>
          <span className="muted" style={{ fontSize: 12 }}>このコードは1回だけ使えます。もう1人つなぐ時は、送ったあとにもう一度ボタンを押してください。</span>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => { setCode(''); router.refresh(); }}>送った（読み込み直す）</button>
          </div>
        </div>
      ) : (
        <button className={`btn ${linked ? 'sm' : 'primary'}`} style={{ alignSelf: 'flex-start' }} disabled={pending}
          onClick={() => start(async () => { const r = await createLineLinkCode(); if (r.ok && r.code) setCode(r.code); else setMsg(r.message ?? ''); })}>
          {linked ? '＋ もう1人つなぐ' : 'LINEでつなぐ'}
        </button>
      )}
      {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
    </section>
  );
}
