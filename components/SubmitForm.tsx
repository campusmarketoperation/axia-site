'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { iso, label, md, nextStartOf, periodDays, periodLabel, prevStartOf, nextPeriod, WD, type Split } from '@/lib/period';
import { loadMine, periodStatus, submitShift, whoByPin } from '@/app/s/[token]/actions';
import type { DayVal } from '@/lib/requests';

type Props = { token: string; storeName: string; split: Split; times: string[]; helpEnabled: boolean };
type Me = { id: string; name: string };
const PIN_NG = 'その番号の人が見つかりません。わからない時は店長に聞くか、LINEで「番号」と送ってください';

export default function SubmitForm({ token, storeName, split, times, helpEnabled }: Props) {
  const [P, setP] = useState(() => nextPeriod(split));
  const [pin, setPin] = useState('');            // バイト番号（4けた）
  const [me, setMe] = useState<Me | null>(null);  // 番号から分かった本人
  const [isNew, setIsNew] = useState(false);      // 初めての人（名前を入れて出す）
  const [newName, setNewName] = useState('');
  const [data, setData] = useState<Record<string, DayVal>>({});
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState('');
  const [stamp, setStamp] = useState('');
  const [pending, start] = useTransition();
  const days = useMemo(() => periodDays(P, split), [P, split]);
  const key = iso(P);
  const pinKey = `axia-shift:${token}:pin`;

  // 前に入れた番号を覚えておく（同じスマホなら次から入れなくていい）
  useEffect(() => { try { const s = localStorage.getItem(pinKey); if (s && /^\d{4}$/.test(s)) setPin(s); } catch {} }, [pinKey]);
  // 4けたそろったら、だれの番号か調べる
  useEffect(() => {
    if (!/^\d{4}$/.test(pin)) { setMe(null); return; }
    let alive = true;
    whoByPin(token, pin).then(r => {
      if (!alive) return;
      if (r && 'locked' in r) { setMe(null); setStatus('バイト番号を何度もまちがえたため、しばらく入れられません。15分ほど待つか、店長に番号を聞いてください'); return; }
      if (!r) { setMe(null); setStatus(PIN_NG); try { localStorage.removeItem(pinKey); } catch {} return; }
      setMe(r); setIsNew(false); setStatus('');
      try { localStorage.setItem(pinKey, pin); } catch {}
    });
    return () => { alive = false; };
  }, [pin, token, pinKey]);
  const reset = () => { setPin(''); setMe(null); setData({}); setStatus(''); try { localStorage.removeItem(pinKey); } catch {} };

  // 期間・本人が変わったら、締め切りかどうかと送信済みの内容を読む
  useEffect(() => {
    let alive = true;
    setData({});
    periodStatus(token, key).then(r => alive && setLocked(r.locked));
    if (me) {
      loadMine(token, me.id, pin, key).then(r => {
        if (!alive || !r || 'pinNg' in r) return;
        if (!r.sent) return;
        setData(r.days);
        setStatus('送信済みの内容を表示中（直して再送信できます）');
      });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, key, me]);

  const tap = (k: string) => {
    if (locked) return;
    const o = data[k];
    const next = { ...data };
    if (!o) next[k] = { s: 'ok', st: null };
    else if (o.s === 'ok') next[k] = { s: 'ng' };
    else delete next[k];
    setData(next); setStamp(k); setStatus('');
  };
  const okDays = days.filter(d => data[iso(d)]?.s === 'ok');
  const blank = days.filter(d => !data[iso(d)]).length;
  const lead = days[0].getUTCDay();

  const send = () => {
    if (!me && !isNew) { setStatus('バイト番号（4けた）を入れてください'); return; }
    if (isNew && !newName.trim()) { setStatus('名前を入れてください'); return; }
    if (blank > 0) { setStatus(`空白の日が${blank}日あります。全部の日に○か✖をつけてください`); return; }
    start(async () => {
      setStatus('送信中…');
      const r = await submitShift(token, { memberId: me?.id, pin, newName: isNew ? newName : undefined, periodKey: key, days: data });
      if (r.ok && 'pin' in r && r.pin && r.memberId) {
        // 初めての人：番号を覚えて、本人として表示
        try { localStorage.setItem(pinKey, r.pin); } catch {}
        setPin(r.pin); setMe({ id: r.memberId, name: newName.trim() }); setIsNew(false);
      }
      setStatus(r.message);
    });
  };

  return (
    <div className="sf">
      <header className="sf-hero">
        <p className="sf-eyebrow">{storeName}　SHIFT REQUEST</p>
        <div className="sf-period">
          <button type="button" className="sf-nav" aria-label="前の期間" onClick={() => setP(prevStartOf(P, split))}>‹</button>
          <div className="sf-ptitle"><div className="sf-m">{periodLabel(P, split)}</div><div className="sf-r">{P.getUTCFullYear()}年</div></div>
          <button type="button" className="sf-nav" aria-label="次の期間" onClick={() => setP(nextStartOf(P, split))}>›</button>
        </div>
        <div className="sf-name">
          <label htmlFor="pin">{isNew ? '名前' : 'バイト番号'}</label>
          <div className="sf-namebox">
            {me ? (
              <div className="sf-me"><b>{me.name}</b> さん<button type="button" onClick={reset}>ちがう人</button></div>
            ) : isNew ? (
              <>
                <input id="pin" aria-label="名前を入力" placeholder="フルネームで" value={newName} onChange={e => setNewName(e.target.value)} />
                <button type="button" className="sf-link" onClick={() => { setIsNew(false); setStatus(''); }}>番号を持っている人はこちら</button>
              </>
            ) : (
              <>
                <input id="pin" aria-label="バイト番号" placeholder="4けたの番号" inputMode="numeric" autoComplete="off" maxLength={4}
                  value={pin} onChange={e => { setStatus(''); setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); }} />
                <button type="button" className="sf-link" onClick={() => { setIsNew(true); setStatus(''); }}>初めて出す人（番号がまだない人）はこちら</button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="sf-sheet">
        <h2>希望日</h2>
        {locked && <p className="sf-lock">この期間は締め切りました。変更は店長に直接連絡してください</p>}
        <p className="sf-hint">日付をタップ：○ 行ける → ✖ 無理 → 空白</p>
        <div className={`sf-grid ${locked ? 'off' : ''}`}>
          {WD.map((w, i) => <div key={w} className={`sf-dow s${i}`}>{w}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
          {days.map((d, i) => {
            const k = iso(d), o = data[k], w = d.getUTCDay();
            const st = o?.s === 'ok' && o.st ? o.st.replace(/^(\d+):/, (_, h) => `${+h > 12 ? +h - 12 : h}:`) + '〜' : '';
            return (
              <button key={k} type="button" disabled={locked}
                className={`sf-day s${w} ${o?.s ?? ''} ${stamp === k ? 'stamp' : ''}`}
                aria-label={`${label(d)} ${o?.s === 'ok' ? '行ける' : o?.s === 'ng' ? '無理' : '未入力'}`}
                onClick={() => tap(k)}>
                {(i === 0 || d.getUTCDate() === 1) && <span className="sf-mo">{d.getUTCMonth() + 1}月</span>}
                <span className="sf-n">{d.getUTCDate()}</span>
                <span className="sf-mk">{o?.s === 'ok' ? (st ? '' : '○') : o?.s === 'ng' ? '✖' : ''}</span>
                {st && <span className="sf-t">{st}</span>}
              </button>
            );
          })}
        </div>
        {!locked && <div className="sf-bulk"><button type="button" onClick={() => { const n = { ...data }; days.forEach(d => { if (!n[iso(d)]) n[iso(d)] = { s: 'ng' }; }); setData(n); }}>空白を全部✖にする</button><button type="button" onClick={() => setData({})}>リセット</button></div>}
      </section>

      <section className="sf-sheet">
        <h2>入り時間</h2>
        {okDays.length === 0 && <p className="sf-hint">カレンダーで○をつけた日がここに並びます。</p>}
        {okDays.map(d => {
          const k = iso(d), o = data[k] as { s: 'ok'; st: string | null };
          return (
            <div key={k} className="sf-row">
              <span>{md(d)}({WD[d.getUTCDay()]})</span>
              <select aria-label={`${label(d)} 入り時間`} disabled={locked} value={o.st ?? ''} onChange={e => setData({ ...data, [k]: { s: 'ok', st: e.target.value || null } })}>
                <option value="">何時からでも</option>
                {times.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          );
        })}
      </section>

      <section className="sf-submit">
        {blank > 0 && !locked && <p className="sf-warn">まだ{blank}日空白があります。全部の日に○か✖をつけると送信できます（行けない日は「空白を全部✖にする」が便利です）</p>}
        <button type="button" className="sf-send" disabled={pending || locked || blank > 0} onClick={send}>{locked ? '締め切り済み' : '送信する'}</button>
        {status && <p className="sf-status">{status}</p>}
      </section>
    </div>
  );
}
