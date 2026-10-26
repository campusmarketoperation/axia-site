'use client';
import { useMemo, useState } from 'react';
import type { Avail, Day, HelpIn } from '@/lib/data';

export type Lend = { date: string; name: string; to: string };   // この店の人が、ほかの店にヘルプに出る日（シフト表の「→店名」）
export type BoardStore = { id: string; name: string; locked: boolean; diffs: number[]; lend: boolean[]; people: Avail[]; helps: HelpIn[]; lends: Lend[]; guestIns: { date: string; name: string; from: string }[] };

const vcls = (v: number) => (v > 0 ? 'p' : v === 0 ? 'z' : v === -1 ? 'm1' : v === -2 ? 'm2' : 'm3');

// 本部は見るだけ（ヘルプの貸し借りは店どうしで行う）。どの日に誰がどこへヘルプに出ているかを見る
export default function HqBoard({ days, stores }: { companyId?: string; days: Day[]; stores: BoardStore[]; readOnly?: boolean }) {
  const first = useMemo(() => {
    let best: { s: number; d: number; v: number } | null = null;
    stores.forEach((st, s) => st.diffs.forEach((v, d) => { if (!best || v < best.v) best = { s, d, v }; }));
    return best as { s: number; d: number; v: number } | null;
  }, [stores]);
  const [sel, setSel] = useState<{ s: number; d: number } | null>(first && first.v < 0 ? { s: first.s, d: first.d } : null);
  const [msg, setMsg] = useState('');

  const target = sel ? stores[sel.s] : null;
  // ヘルプの一覧（出る店→行く店）。承認待ちの依頼も入れる
  const allHelps = useMemo(() => {
    const out: { date: string; name: string; from: string; to: string; pending: boolean }[] = [];
    stores.forEach(st => st.lends.forEach(l => out.push({ date: l.date, name: l.name, from: st.name, to: l.to, pending: false })));
    stores.forEach(st => st.guestIns.forEach(g => out.push({ date: g.date, name: g.name, from: g.from || '他店', to: st.name, pending: false })));
    stores.forEach(st => st.helps.filter(h => h.status === 'pending').forEach(h => out.push({ date: h.date, name: h.memberName, from: h.fromStore, to: st.name, pending: true })));
    return out.sort((x, y) => x.date.localeCompare(y.date) || x.from.localeCompare(y.from));
  }, [stores]);
  const dayHelps = sel ? allHelps.filter(h => h.date === days[sel.d].iso && (h.from === stores[sel.s].name || h.to.startsWith(stores[sel.s].name))) : [];

  // 店長グループに送る文面（表示中の期間ぜんぶ。足りない日だけ並べる）
  const shortLines = days.map((d, i) => {
    const m = stores.filter(s => s.diffs[i] < 0).map(s => `${s.name} ${s.diffs[i]}`);
    return m.length ? `${d.md}(${d.wd})　${m.join('、')}` : '';
  }).filter(Boolean);
  const lineText = [
    `【足りない日】${days[0].md}〜${days[days.length - 1].md}`,
    ...(shortLines.length ? shortLines : ['足りない日はありません']),
  ].join('\n');

  const cols = `130px repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <>
      <section className="card scroll" style={{ padding: 16 }}>
        <div className="grid" style={{ gridTemplateColumns: cols, minWidth: 130 + days.length * 48 }}>
          <span />
          {days.map(d => <div key={d.iso} className={`dh ${d.wd === '土' ? 'sat' : d.wd === '日' ? 'sun' : ''}`}><span>{d.first ? d.md : d.md.split('/')[1]}</span><span>{d.wd}</span></div>)}
          {stores.map((st, s) => (
            <Frag key={st.id}>
              <span className="nm">{st.name}{st.locked && <span className="muted" style={{ fontSize: 11 }}>（締め切り）</span>}</span>
              {st.diffs.map((v, d) => (
                <button key={d} type="button" className={`v ${vcls(v)} ${sel?.s === s && sel.d === d ? 'focus' : ''}`}
                  aria-label={`${st.name} ${days[d].md} ${v < 0 ? `${-v}人足りない` : v > 0 ? `${v}人余裕` : 'ちょうど'}`}
                  onClick={() => { setSel({ s, d }); setMsg(''); }}>{v > 0 ? `+${v}` : v}</button>
              ))}
            </Frag>
          ))}
        </div>
      </section>

      <div className="cols">
        <section className="card wide" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sel && target ? <>
            <div className="row">
              <h2 style={{ margin: 0 }}>{days[sel.d].md}({days[sel.d].wd}) {target.name}</h2>
              {target.diffs[sel.d] < 0
                ? <span className="pill stop">{-target.diffs[sel.d]}人足りない</span>
                : <span className="pill ok">{target.diffs[sel.d] === 0 ? 'ちょうど' : `${target.diffs[sel.d]}人余裕`}</span>}
            </div>
            {dayHelps.length === 0 && <p className="muted" style={{ margin: 0 }}>この日の{target.name}に関わるヘルプはありません</p>}
            {dayHelps.map((h, i) => (
              <div key={i} className="row" style={{ justifyContent: 'space-between', background: '#F4F5F8', borderRadius: 10, padding: '8px 12px' }}>
                <span><b>{h.name}</b>（{h.from}）→ {h.to}</span>
                {h.pending && <span className="pill wait" style={{ fontSize: 11 }}>承認待ち</span>}
              </div>
            ))}
          </> : <p className="muted">表のマスを押すと、その日のヘルプが出ます。</p>}
          <h2 style={{ margin: '12px 0 0' }}>この期間のヘルプ（{allHelps.length}件）</h2>
          {allHelps.length === 0 ? <p className="muted" style={{ margin: 0 }}>まだありません</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {allHelps.map((h, i) => (
                <div key={i} className="row" style={{ gap: 10, fontSize: 14, borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
                  <span style={{ width: 54, fontVariantNumeric: 'tabular-nums' }}>{h.date.slice(5).replace('-', '/')}</span>
                  <b>{h.name}</b><span className="muted">{h.from}</span><span>→ {h.to}</span>
                  {h.pending && <span className="pill wait" style={{ fontSize: 11 }}>承認待ち</span>}
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card narrow" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0 }}>店長グループへの文面</h2>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, background: '#F4F5F8', borderRadius: 10, padding: 12, fontFamily: 'inherit', fontSize: 13 }}>{lineText}</pre>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(lineText).then(() => setMsg('文面をコピーしました'), () => setMsg('コピーできませんでした。文面を選んでコピーしてください'))}>文面をコピー</button>
        </section>
      </div>
    </>
  );
}

function Frag({ children }: { children: React.ReactNode }) { return <>{children}</>; }
