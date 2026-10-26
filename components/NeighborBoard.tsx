'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Avail, Day } from '@/lib/data';
import { requestHelp } from '@/app/store/[storeId]/actions';

export type NbStore = { id: string; name: string; locked: boolean; counts: number[]; needs: number[]; diffs: number[]; lend: boolean[]; people: Avail[] };
type Pick = { store: NbStore; p: Avail; d: number };

export default function NeighborBoard({ storeId, storeName, days, own, neighbors, canAsk }: {
  storeId: string; storeName: string; days: Day[]; own: { counts: number[]; needs: number[] }; neighbors: NbStore[]; canAsk: boolean;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<Pick | null>(null);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const cols = `120px repeat(${days.length}, minmax(0, 1fr))`;
  const room = pick ? pick.store.diffs[pick.d] : 0;
  const lend = pick ? pick.store.lend[pick.d] : false;
  const ownGap = pick ? own.counts[pick.d] - own.needs[pick.d] : 0;

  return (
    <>
      <section className="card scroll" style={{ padding: 16 }}>
        <div className="grid" style={{ gridTemplateColumns: cols, minWidth: 120 + days.length * 48 }}>
          <span />
          {days.map(d => (
            <div key={d.iso} className={`dh ${d.wd === '土' ? 'sat' : d.wd === '日' ? 'sun' : ''}`}><span>{d.first ? d.md : d.md.split('/')[1]}</span><span>{d.wd}</span></div>
          ))}
          <span className="band">{storeName}（自店）</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>出れる人数</span>
          {own.counts.map((c, i) => <span key={i} className={`cnt ${c < own.needs[i] ? 'short' : ''}`}>{c}</span>)}
          <span style={{ fontSize: 12, fontWeight: 700 }}>過不足</span>
          {own.counts.map((c, i) => <Diff key={i} v={c - own.needs[i]} />)}
          {neighbors.map(g => (
            <Frag key={g.id}>
              <span className="band">{g.name}{g.locked ? '（締め切り済み）' : '（受付中：自店に入る日も含む）'}</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>出れる人数</span>
              {g.counts.map((c, i) => <span key={i} className={`cnt ${c < g.needs[i] ? 'short' : ''}`}>{c}</span>)}
              <span style={{ fontSize: 12, fontWeight: 700 }}>過不足</span>
              {g.counts.map((c, i) => <Diff key={i} v={c - g.needs[i]} />)}
              <span style={{ fontSize: 12, fontWeight: 700 }}>ヘルプに出す</span>
              {g.lend.map((ok, i) => <span key={i} className={`lend ${ok ? 'ok fixed' : 'ng'}`} style={{ cursor: 'default' }}>{ok ? '○' : '✖'}</span>)}
              {(() => {
                // 店が「出せない」にしている日は、人も出さない。頼める日が1日もない人は表示しない
                const people = g.people.filter(p => (!p.helpStores || p.helpStores.includes(storeId)) && p.cells.some((c, i) => c.free && g.lend[i]));
                if (!people.length) return <span className="muted" style={{ gridColumn: '1 / -1' }}>この期間に頼める人はいません</span>;
                return people.map(p => (
                  <Frag key={p.memberId}>
                    <span className="nm" title={['提出した希望', ...p.note].join('\n')}>{p.name}<span className="star">★</span></span>
                    {p.cells.map((c, i) => {
                      const can = c.free && g.lend[i];
                      const cls = `cell ${can ? 't' : ''} ${pick?.p.memberId === p.memberId && pick.d === i ? 'sel' : ''}`;
                      return can && canAsk
                        ? <button key={i} type="button" className={cls} aria-label={`${p.name} ${days[i].md} ${c.show} ヘルプを頼む`}
                            onClick={() => { setPick({ store: g, p, d: i }); setMsg(''); }}>{c.show}</button>
                        : <span key={i} className={`${cls} ro`}>{can ? c.show : ''}</span>;
                    })}
                  </Frag>
                ));
              })()}
            </Frag>
          ))}
        </div>
      </section>

      {canAsk && (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pick ? <>
            <h2 style={{ margin: 0 }}>{days[pick.d].md}({days[pick.d].wd}) {pick.p.name}さん（{pick.store.name}）</h2>
            <div className="muted">
              入り {pick.p.cells[pick.d].show}　／　{storeName}：{ownGap < 0 ? `${-ownGap}人足りない` : ownGap === 0 ? 'ちょうど' : `${ownGap}人余裕`}
              　／　{pick.store.name}：{room < 0 ? `${-room}人足りない` : room === 0 ? (pick.store.locked ? '回せる人なし' : 'ちょうど') : pick.store.locked ? `カット${room}人` : `${room}人余裕`}
            </div>
            <div className="row">
              <button className="btn primary" disabled={pending || !lend} onClick={() => start(async () => {
                const r = await requestHelp(storeId, pick.p.memberId, days[pick.d].iso);
                setMsg(r.message ?? '');
                if (r.ok) { setPick(null); router.refresh(); }
              })}>{storeName}のヘルプを依頼する</button>
              <button className="btn" onClick={() => setPick(null)}>やめる</button>
            </div>
            {!lend && <p className="muted" style={{ margin: 0 }}>{room < 0 ? `${pick.store.name}もその日は人が足りていないので頼めません。` : `${pick.store.name}の店長が、その日は「ヘルプに出せない」にしているので頼めません。`}</p>}
            {lend && room === 0 && !pick.store.locked && <p className="error" style={{ margin: 0 }}>頼むと、{pick.store.name}がその日1人足りなくなります。{pick.store.name}の店長と相談してから頼んでください。</p>}
          </> : <p className="muted" style={{ margin: 0 }}>緑のマス（行ける日）を押すと、その人に{storeName}のヘルプを頼めます。依頼すると、その人の店の店長が承認したら決まります。承認されたら、シフト表の「他店からのヘルプ」の行で入り時間を決めてください（本人にLINEで知らせます）。</p>}
          {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
        </section>
      )}
    </>
  );
}

/** 過不足（出れる人数 − 必要人数）：＋は余裕、−は足りない */
function Diff({ v }: { v: number }) {
  const cls = v > 0 ? 'p' : v === 0 ? 'z' : v === -1 ? 'm1' : v === -2 ? 'm2' : 'm3';
  return <span className={`v ${cls}`} style={{ cursor: 'default', height: 28 }} title={v < 0 ? `${-v}人足りない` : v > 0 ? `${v}人余裕` : 'ちょうど'}>{v > 0 ? `+${v}` : v}</span>;
}

function Frag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
