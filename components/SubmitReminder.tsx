'use client';
import { useState, useTransition } from 'react';
import { sendReminder, setDeadline as saveDeadlineAction } from '@/app/store/[storeId]/actions';

type Person = { id: string; name: string; submitted: boolean; started: boolean; line: boolean };
const WD = ['日', '月', '火', '水', '木', '金', '土'];

export default function SubmitReminder({ storeId, periodLabel, periodStart, submitUrl, people, savedDeadline, autoSent }: {
  storeId: string; periodLabel: string; periodStart: string; submitUrl: string; people: Person[];
  savedDeadline: string; autoSent: boolean;
}) {
  // 締め切り：保存した日（決めていなければ期間が始まる5日前）
  const [deadline, setDeadline] = useState(savedDeadline);
  const dl = new Date(`${deadline}T00:00:00Z`);
  const dlText = isNaN(dl.getTime()) ? '' : `${dl.getUTCMonth() + 1}/${dl.getUTCDate()}(${WD[dl.getUTCDay()]})`;
  const auto = `【シフト提出のお願い】\n${periodLabel} のシフトを、${dlText}までに出してください。\n\nこのLINEに送るか、こちらから出せます👇\n${submitUrl}`;
  const [custom, setCustom] = useState<string | null>(null);
  const message = custom ?? auto;
  const [sel, setSel] = useState<string[]>(people.filter(p => !p.submitted && p.line).map(p => p.id));
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const unsub = people.filter(p => !p.submitted);
  const pick = (ids: string[]) => setSel(ids);

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>提出のお願い</h2>
        <button className="btn sm" onClick={() => setOpen(!open)}>{open ? '閉じる' : `LINEで送る（未提出 ${unsub.length}人）`}</button>
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <label htmlFor="deadline" className="muted">締め切り</label>
        <input id="deadline" type="date" className="input" style={{ width: 'auto' }} value={deadline} disabled={pending}
          onChange={e => {
            const v = e.target.value; setDeadline(v); setCustom(null);
            if (v) start(async () => { const r = await saveDeadlineAction(storeId, periodStart, v); setMsg(r.message); });
          }} />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {autoSent
          ? '締め切り当日の自動リマインドは送信済みです。'
          : `${dlText || '締め切り'}の夜10時ごろ、未提出の人には提出のお願い、提出済みの人には出した希望の確認をLINEで自動で送ります。`}
      </p>
      {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
      {open && <>
        <div className="field">
          <label htmlFor="rem-text">文面（直せます）</label>
          <textarea id="rem-text" className="input" style={{ height: 130, padding: 10 }} value={message} onChange={e => setCustom(e.target.value)} />
        </div>
        <div className="row">
          <span className="muted">送る人：</span>
          <button className="btn sm" onClick={() => pick(people.filter(p => p.line).map(p => p.id))}>全員</button>
          <button className="btn sm" onClick={() => pick(unsub.filter(p => p.line).map(p => p.id))}>未提出の人</button>
          <button className="btn sm" onClick={() => pick([])}>選び直す</button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {people.map(p => (
            <label key={p.id} className="row" style={{ gap: 6, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', opacity: p.line ? 1 : 0.5 }}
              title={p.line ? undefined : 'LINE未登録のため送れません'}>
              <input type="checkbox" disabled={!p.line} checked={sel.includes(p.id)}
                onChange={e => setSel(e.target.checked ? [...sel, p.id] : sel.filter(x => x !== p.id))} />
              {p.name}
              <span className={`pill ${p.submitted ? 'ok' : 'wait'}`} style={{ fontSize: 11 }}>{p.submitted ? '提出済み' : p.started ? '未入力の日あり' : '未提出'}</span>
            </label>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" disabled={pending || !sel.length} onClick={() => start(async () => {
            const r = await sendReminder(storeId, sel, message);
            setMsg(r.message);
          })}>{sel.length}人にLINEで送る</button>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(message).then(() => setMsg('文面をコピーしました。グループLINEに貼れます'), () => setMsg('コピーできませんでした'))}>文面をコピー</button>
        </div>
        {unsub.some(p => !p.line) && <p className="muted" style={{ margin: 0 }}>LINE未登録の未提出：{unsub.filter(p => !p.line).map(p => p.name).join('、')}（文面をコピーしてグループLINEなどで伝えてください）</p>}
      </>}
    </section>
  );
}
