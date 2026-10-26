'use client';
import { useState, useTransition } from 'react';
import type { Store } from '@/lib/shift';
import { saveNeighbors, saveSettings } from '@/app/store/[storeId]/settings/actions';

export default function SettingsForm({ store, stores, neighbors, canEditNeighbors, readOnly = false }: {
  store: Store; stores: { id: string; name: string }[]; neighbors: string[]; canEditNeighbors: boolean; readOnly?: boolean;
}) {
  const [msg, setMsg] = useState('');
  const [nb, setNb] = useState<string[]>(neighbors);
  const [nbMsg, setNbMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <div style={{ flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}
        action={f => start(async () => { if (readOnly) return; const r = await saveSettings(store.id, f); setMsg(r.message ?? ''); })}>
        <h2 style={{ gridColumn: '1 / -1', margin: 0 }}>シフトのルール</h2>
        {readOnly && <p className="muted" style={{ gridColumn: '1 / -1', margin: 0 }}>見るだけ（シフトのルールは店長が決めます）</p>}
        <fieldset disabled={readOnly} style={{ display: 'contents' }}>
        <div className="field"><label htmlFor="name">店舗名</label><input id="name" name="name" className="input" defaultValue={store.name} /></div>
        <div className="field"><label htmlFor="split1">期間の区切り①（開始日）</label><input id="split1" name="split1" type="number" min={1} max={27} className="input" defaultValue={store.split1} /></div>
        <div className="field"><label htmlFor="split2">期間の区切り②（開始日）</label><input id="split2" name="split2" type="number" min={2} max={28} className="input" defaultValue={store.split2} /></div>
        <div className="field"><label htmlFor="time_from">入り時間（いちばん早い）</label><input id="time_from" name="time_from" className="input" defaultValue={store.time_from} /></div>
        <div className="field"><label htmlFor="time_to">入り時間（いちばん遅い）</label><input id="time_to" name="time_to" className="input" defaultValue={store.time_to} /></div>
        <div className="field"><label htmlFor="time_step">刻み（分）</label><input id="time_step" name="time_step" type="number" min={5} step={5} className="input" defaultValue={store.time_step} /></div>
        <div className="field"><label htmlFor="need_weekday">必要人数（平日）</label><input id="need_weekday" name="need_weekday" type="number" min={0} className="input" defaultValue={store.need_weekday} /></div>
        <div className="field"><label htmlFor="need_weekend">必要人数（土日）</label><input id="need_weekend" name="need_weekend" type="number" min={0} className="input" defaultValue={store.need_weekend} /></div>
        <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" name="help_enabled" defaultChecked={store.help_enabled !== false} style={{ marginTop: 4 }} />
          <span>他の店へのヘルプを募集する<br /><span className="muted" style={{ fontSize: 12 }}>オンにすると、提出画面とLINEで「他の店のヘルプもOK」を聞きます。オフにすると聞かず、この店の人は本部・近隣の店からヘルプ要員として見えません。</span></span>
        </label>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="staff_off_options">社員の欄：休みの選択肢（「、」で区切る。出れる人数に数えない）</label>
          <input id="staff_off_options" name="staff_off_options" className="input" placeholder="休、有給、公休" defaultValue={(store.staff_off_options ?? ['休', '有給']).join('、')} />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="staff_options">社員の欄：出勤の選択肢（「、」で区切る。出れる人数に数える）</label>
          <input id="staff_options" name="staff_options" className="input" placeholder="早番、遅番、研修" defaultValue={store.staff_options.join('、')} />
          <span className="muted" style={{ fontSize: 12 }}>空白のマスは「出勤」です。時間や役割を書き分けたい時だけ入れてください。</span>
        </div>
        <p className="muted" style={{ gridColumn: '1 / -1', margin: 0 }}>必要人数は社員も入れた人数です（社員は「休みの選択肢」以外の日を出勤として数えます）。<br />期間の区切りは、使い始めたら変えないでください（前の期間が開けなくなります）。</p>
        <div className="row" style={{ gridColumn: '1 / -1' }}>
          {!readOnly && <button className="btn primary" disabled={pending}>保存する</button>}
          {msg && <span className="muted">{msg}</span>}
        </div>
        </fieldset>
      </form>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>近隣として見れる店</h2>
        <p className="muted" style={{ margin: 0 }}>選んだ店の「出れる人数」と、ヘルプOKの人のシフトが「近隣のシフト」に出ます。{!canEditNeighbors && '（本部が設定します。本部画面で「店長も近隣の店を選べる」をオンにすると、店長も選べます）'}</p>
        {stores.length === 0 && <p className="muted">同じ会社の店舗がまだありません。</p>}
        <div className="row">
          {stores.map(s => (
            <label key={s.id} className="row" style={{ gap: 6, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px' }}>
              <input type="checkbox" disabled={!canEditNeighbors} checked={nb.includes(s.id)}
                onChange={e => setNb(e.target.checked ? [...nb, s.id] : nb.filter(x => x !== s.id))} />
              {s.name}
            </label>
          ))}
        </div>
        {canEditNeighbors && stores.length > 0 && (
          <div className="row">
            <button className="btn" disabled={pending} onClick={() => start(async () => { const r = await saveNeighbors(store.id, nb); setNbMsg(r.message ?? ''); })}>近隣を保存</button>
            {nbMsg && <span className="muted">{nbMsg}</span>}
          </div>
        )}
      </section>
    </div>
  );
}
