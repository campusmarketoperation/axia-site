'use client';
import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Grid } from '@/lib/data';
import { helpRows } from '@/lib/helpRows';
import { cellLabel, isWorkingPart, NOTE_MAX, staffLabel, staffOffOptions, staffState } from '@/lib/shift';
import { removeHelp, sendConfirmed, setCell, setConfirmed, setHelpOk, setHelpTime, setLend, setLock, setMemoLabel, setMemoShared as setMemoSharedAction, setNote, addMemoRow, removeMemoRow, addGuest, setGuestCell, removeGuest } from '@/app/store/[storeId]/actions';
import { exportGridImage, gridImageForLine } from '@/lib/exportImage';
import type { HistoryItem } from '@/lib/history';

type Sel = { kind: 'part' | 'staff'; r: number; c: number } | null;

const cls = (v: string) => v === '' ? '' : v === '✖' || v === '×' ? 'x' : v === 'カット' ? 'cut' : v.startsWith('→') ? 'lend' : 't';

const when = (t: string) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const mdOf = (d: string | null) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '');
/** 履歴の1行の文 */
function historyText(h: HistoryItem): string {
  if (h.kind === 'lock' || h.kind === 'confirm') return h.note ?? '';
  const who = h.memberName ? `${h.memberName} ${mdOf(h.date)}` : mdOf(h.date);
  if (h.kind === 'help') return `${who}　${h.note ?? ''}${h.before || h.after ? `（${h.before ?? ''} → ${h.after ?? ''}）` : ''}`;
  return `${who}　${h.before ?? ''} → ${h.after ?? ''}${h.kind === 'request' ? '（希望）' : ''}`;
}

export default function ShiftGrid({ grid, partOptions, staffOptions, readOnly = false, history = [], helpAllowed = true }: { grid: Grid; partOptions: string[]; staffOptions: string[]; readOnly?: boolean; history?: HistoryItem[]; helpAllowed?: boolean }) {
  // helpAllowed：ヘルプの操作（貸し借り・★・ヘルプに出す）ができるか。本部は見るだけ
  const router = useRouter();
  const [parts, setParts] = useState(grid.parts);
  const [staff, setStaff] = useState(grid.staff);
  const [sel, setSel] = useState<Sel>(null);
  const [autoNext, setAutoNext] = useState(true);
  const [lendSet, setLendSet] = useState(grid.lendSet);
  const [helpSel, setHelpSel] = useState<string | null>(null);
  const [helpTime, setHelpTimeText] = useState('');
  const selHelp = helpSel ? grid.helpIns.find(h => h.id === helpSel) ?? null : null;
  const [memos, setMemos] = useState<string[][]>(grid.memos);   // [行][日]
  const [noteLine, setNoteLine] = useState(1);                     // 選んでいるメモの行（1から）
  const notes = memos[noteLine - 1] ?? grid.days.map(() => '');
  const [memoLabels, setMemoLabels] = useState<string[]>(grid.memoLabels);
  const [memoShared, setMemoShared] = useState<boolean[]>(grid.memoShared ?? grid.memoLabels.map(() => true));
  const memoName = (line: number) => memoLabels[line - 1] || 'メモ';
  const [askDropMemo, setAskDropMemo] = useState(false);
  const [noteSel, setNoteSel] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  // 他店から借りた人（名前で手入力）
  const [guests, setGuests] = useState(grid.guests);
  const [guestSel, setGuestSel] = useState<{ g: number; c: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [gName, setGName] = useState('');
  const [gFrom, setGFrom] = useState('');
  const pickSel = (s: Sel) => { setHelpSel(null); setNoteSel(null); setGuestSel(null); setSel(s); };
  const pickNote = (i: number, line: number = noteLine) => { setHelpSel(null); setSel(null); setGuestSel(null); setNoteLine(line); setNoteSel(i); setNoteText(memos[line - 1]?.[i] ?? ''); };
  function saveNote(i: number, t: string) {
    const v = t.replace(/\r/g, '').trim().slice(0, NOTE_MAX);
    const line = noteLine;
    setMemos(memos.map((row, k) => k !== line - 1 ? row : row.map((x, j) => j === i ? v : x)));
    start(async () => {
      try { await setNote(grid.store.id, grid.days[i].iso, v, line); setMsg(v ? `${grid.days[i].md} の${memoName(line)}を保存しました` : `${grid.days[i].md} の${memoName(line)}を消しました`); }
      catch { setMsg('保存できませんでした。画面を読み込み直してください'); }
    });
  }
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const n = grid.days.length;
  // 確定済み：店長もシフト（時間・ヘルプ）を変えられない。メモは書ける
  const fixed = readOnly || grid.confirmed;
  // 画面を読み込み直した時（確定・送信のあと）に最新の内容にそろえる
  useEffect(() => { setParts(grid.parts); setStaff(grid.staff); setLendSet(grid.lendSet); setMemos(grid.memos); setMemoLabels(grid.memoLabels); setMemoShared(grid.memoShared ?? grid.memoLabels.map(() => true)); setGuests(grid.guests); }, [grid]);

  const counts = useMemo(() => grid.days.map((d, i) =>
    parts.filter(r => isWorkingPart(r.cells[i]?.value ?? '')).length + staff.filter(r => staffState(r.cells[i]?.value ?? '', r.member, grid.store.id, staffOffOptions(grid.store)) === 'work').length + grid.helpIns.filter(h => h.date === d.iso && h.status === 'approved').length + guests.filter(g => isWorkingPart(g.cells[i] ?? '')).length), [parts, staff, guests, grid]);

  const rows = sel?.kind === 'staff' ? staff : parts;
  const selRow = sel ? rows[sel.r] : null;
  const selCell = sel && selRow ? selRow.cells[sel.c] : null;
  const names = grid.storeNames ?? {};
  const off = staffOffOptions(grid.store);
  // 選べる値（表示と保存する値）。かけもちの社員は「→兼務先」「出勤（この店）」が増える
  const opts: { label: string; value: string }[] = sel?.kind !== 'staff' || !selRow
    ? partOptions.map(o => ({ label: o, value: o }))
    : selRow.guest
      ? [{ label: '出勤（この店）', value: `@${grid.store.id}` }, ...off.map(o => ({ label: o, value: o }))]
      : [...staffOptions.map(o => ({ label: o, value: o })),
         ...(selRow.member.extra_store_ids ?? []).filter(id => id !== grid.store.id && names[id]).map(id => ({ label: `→${names[id]}`, value: `@${id}` }))];
  // 「ヘルプ」：ほかの店を選ぶと「→店名」（時間が入っていれば「→店名 5〜」）にする
  const [helpPick, setHelpPick] = useState(false);
  useEffect(() => setHelpPick(false), [sel?.kind, sel?.r, sel?.c]);
  // その人が行ける店（店長が決めた「行ける店」。決めていなければ全部の店）
  const okIds = selRow?.member.help_stores ?? null;
  const helpStores = Object.entries(names).filter(([id]) => id !== grid.store.id && (okIds === null || okIds.includes(id))).map(([, nm]) => nm);
  // ヘルプはアルバイトの行で、その期間「ヘルプOK」（★）の人だけ
  const canHelp = helpAllowed && sel?.kind === 'part' && !!selRow && selRow.helpOk && helpStores.length > 0;
  const curTime = selCell && cls(selCell.value) === 't' && !selCell.value.startsWith('@') && /\d/.test(selCell.value) ? selCell.value : '';
  const selDate = sel ? grid.days[sel.c]?.iso : '';
  const blockedBy = sel?.kind === 'staff' && selRow ? (grid.staffBlocked?.[selRow.member.id]?.[sel.c] ?? '') : '';
  const lastLog = sel && selRow ? history.find(h => h.memberId === selRow.member.id && h.date === selDate && (h.kind === 'cell' || h.kind === 'request' || h.kind === 'help')) : undefined;
  const resetLabel = sel?.kind === 'part' ? '本人の希望に戻す' : selRow?.guest ? `${names[selRow.member.store_id] ?? 'メインの店'}（空白）に戻す` : '出勤（空白）に戻す';

  function update(value: string | null) {
    if (fixed || !sel || !selRow || blockedBy) return;
    const day = grid.days[sel.c].iso;
    const apply = (list: typeof parts) => list.map((row, ri) => ri !== sel.r ? row : {
      ...row, cells: row.cells.map((c, ci) => ci !== sel.c ? c : { ...c, value: value ?? c.req, edited: value !== null }),
    });
    if (sel.kind === 'staff') setStaff(apply(staff)); else setParts(apply(parts));
    start(async () => {
      try { await setCell(grid.store.id, selRow.member.id, day, value); }
      catch { setMsg('保存できませんでした。画面を読み込み直してください'); }
    });
    if (autoNext) move(0, 1);
  }

  // 選んだマスを動かす（dr：人、dc：日）。端まで行ったら次の人の最初の日へ
  function move(dr: number, dc: number) {
    if (!sel) return;
    const list = sel.kind === 'staff' ? staff : parts;
    let r = sel.r + dr, c = sel.c + dc;
    if (c >= n) { c = 0; r += 1; }
    if (c < 0) { c = n - 1; r -= 1; }
    if (r < 0 || r >= list.length) return;
    setSel({ kind: sel.kind, r, c });
  }
  // 選んだマスが見えるようにスクロール
  useEffect(() => {
    if (!sel) return;
    const el = document.querySelector(`[data-cell="${sel.kind}-${sel.r}-${sel.c}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    // スマホでは下のシートに隠れないよう、マスを画面の上の方に出す
    if (window.matchMedia('(max-width: 760px), (pointer: coarse) and (max-width: 1366px)').matches) {
      const top = el.getBoundingClientRect().top, h = window.innerHeight;
      if (top > h * 0.38 || top < 60) window.scrollBy({ top: top - h * 0.2, behavior: 'smooth' });
    }
  }, [sel]);

  const cols = `var(--namew, 110px) repeat(${n}, minmax(0, 1fr))`; // 幅は min-width で確保（中身で列が広がって右が切れないように）

  // 確定する前に、時間が決まっていないマス（○・時間なしのヘルプ）を知らせる
  const undecided = useMemo(() => {
    const out: { md: string; name: string; what: string }[] = [];
    grid.days.forEach((d, i) => {
      parts.forEach(r => {
        const v = r.cells[i]?.value ?? '';
        if (v === '○') out.push({ md: d.md, name: r.member.name, what: '' });
        else if (v.startsWith('→') && !/\d/.test(v)) out.push({ md: d.md, name: r.member.name, what: `（${v.slice(1).trim()}へヘルプ）` });
      });
      guests.forEach(g => { if (g.cells[i] === '○') out.push({ md: d.md, name: g.name || (g.from ? `${g.from}から` : ''), what: '（ヘルプ）' }); });
      grid.helpIns.filter(h => h.date === d.iso && h.status === 'approved' && !/\d/.test(h.label ?? '')).forEach(h => out.push({ md: d.md, name: h.memberName, what: `（${h.fromStore}からヘルプ）` }));
    });
    return out;
  }, [parts, guests, grid.days, grid.helpIns]);
  const [warnFor, setWarnFor] = useState<'send' | 'confirm' | null>(null);
  function runConfirm(a: 'send' | 'confirm' | 'unconfirm') {
    start(async () => {
      if (a === 'send') {
        let img: { full: string; preview: string } | null = null;
        try { img = await gridImageForLine({ ...grid, parts, staff, guests, counts, memos, memoLabels, memoShared }); } catch (e) { console.error(e); img = null; }
        const r = await sendConfirmed(grid.store.id, grid.start, img);
        setMsg((grid.confirmed ? '' : '確定しました。') + `${r.sent}人にLINEで送りました${r.image ? '（シフト表の画像つき）' : `（画像は送れませんでした：${r.imageError || '理由不明'}）`}。` + (r.missing.length ? ` LINE未登録：${r.missing.join('、')}` : '') + (r.failed.length ? ` 送れなかった人：${r.failed.join('、')}` : ''));
      } else {
        await setConfirmed(grid.store.id, grid.start, a === 'confirm');
        setMsg(a === 'unconfirm' ? '確定を外しました。シフトを変えられます（締め切りはそのまま）' : '確定しました。時間やヘルプは変えられません（変える時は「確定を外す」）');
      }
      router.refresh();
    });
  }
  // まだ確定していない時だけ、時間未定のマスがあれば先に警告
  const askConfirm = (a: 'send' | 'confirm') => { if (!grid.confirmed && undecided.length) setWarnFor(a); else runConfirm(a); };

  return (
    <div className="cols">
      <section className="card wide" aria-label="シフト表" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
          <button className="btn" onClick={() => exportGridImage({ ...grid, parts, staff, guests, counts, memos, memoLabels, memoShared })}>画像で保存</button>
          {readOnly && <span className="muted" style={{ marginRight: 'auto' }}>見るだけ（シフトを決めるのは店長です）</span>}
          {!readOnly && <>
            <span className={`pill ${grid.confirmed ? 'done' : grid.locked ? 'wait' : ''}`} style={{ marginRight: 'auto' }}>
              {grid.confirmed ? '確定済み（変えられません）' : grid.locked ? '締め切り済み（社員は変えられます）' : '受付中'}
            </span>
            <button className="btn" disabled={pending} onClick={() => askConfirm('send')}>{grid.confirmed ? '全員にLINEで送る' : '確定して全員にLINEで送る'}</button>
            {!grid.confirmed && <button className={grid.locked ? 'btn' : 'btn primary'} disabled={pending} onClick={() => start(async () => {
              const r = await setLock(grid.store.id, grid.start, !grid.locked);
              setMsg(r.ok ? (grid.locked ? '締め切りを外しました。バイトの人がまた希望を出せます' : '締め切りました。バイトの人はこの期間の希望を変えられません（社員はシフトを変えられます）' + ('notified' in r && r.notified ? `　${r.notified}人にLINEで知らせました` : '')) : ('message' in r ? r.message ?? '' : ''));
              router.refresh();
            })}>{grid.locked ? '締め切りを外す' : '締め切る'}</button>}
            <button className={grid.confirmed ? 'btn' : grid.locked ? 'btn primary' : 'btn'} disabled={pending} onClick={() => grid.confirmed ? runConfirm('unconfirm') : askConfirm('confirm')}>{grid.confirmed ? '確定を外す' : '確定する'}</button>
          </>}
        </div>
        {warnFor && (
          <div className="notice warn-box" style={{ marginTop: 0 }}>
            <b>時間が決まっていないマスがあります（{undecided.length}か所）</b>
            <div style={{ fontSize: 13, margin: '6px 0' }}>{undecided.map(u => `${u.md} ${u.name}${u.what}`).join('、')}</div>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm" onClick={() => setWarnFor(null)}>戻って時間を決める</button>
              <button type="button" className="btn sm primary" disabled={pending} onClick={() => { const a = warnFor; setWarnFor(null); runConfirm(a); }}>
                このまま{warnFor === 'send' ? '確定してLINEで送る' : '確定する'}</button>
            </div>
          </div>
        )}
        {msg && <p className="notice" style={{ marginTop: 0 }}>{msg}</p>}
        <div className="scroll grid-scroll">
          <div className="grid" style={{ gridTemplateColumns: cols, minWidth: `calc(var(--namew, 110px) + ${n * 48}px)` }}>
            <span className="muted dh-corner" style={{ fontSize: 12 }}>名前</span>
            {grid.days.map(d => (
              <div key={d.iso} className={`dh ${d.wd === '土' ? 'sat' : d.wd === '日' ? 'sun' : ''}`}>
                <span>{d.first ? d.md : d.md.split('/')[1]}</span><span>{d.wd}</span>
              </div>
            ))}

            {parts.map((row, r) => (
              <Line key={row.member.id}>
                <span className="nm" title={row.helpOk ? '他店ヘルプOK' : undefined}>{row.member.name}{row.helpOk && <span className="star">★</span>}</span>
                {row.cells.map((c, i) => (
                  <button key={i} type="button"
                    className={`cell ${cls(c.value)} ${c.edited ? 'edited' : ''} ${sel?.kind === 'part' && sel.r === r && sel.c === i ? 'sel' : ''}`}
                    aria-label={`${row.member.name} ${grid.days[i].md} ${c.value || '未入力'}`}
                    data-cell={`part-${r}-${i}`}
                    onClick={() => pickSel({ kind: 'part', r, c: i })}>{cellLabel(c.value) || '・'}</button>
                ))}
              </Line>
            ))}

            {(grid.helpIns.length > 0 || guests.length > 0 || (helpAllowed && !fixed)) && <span className="band">他店からのヘルプ</span>}
            {guests.map((gu, gi) => (
              <Line key={gu.id}>
                <span className="nm">{gu.name}{gu.from && <span className="muted" style={{ fontSize: 11 }}>（{gu.from}）</span>}</span>
                {grid.days.map((d, i) => (
                  <button key={d.iso} type="button" className={`cell ${gu.cells[i] ? 't' : ''} ${guestSel?.g === gi && guestSel.c === i ? 'sel' : ''}`}
                    onClick={() => { setSel(null); setHelpSel(null); setNoteSel(null); setGuestSel({ g: gi, c: i }); }}>{gu.cells[i] || '・'}</button>
                ))}
              </Line>
            ))}
            {helpAllowed && !fixed && (
              <div className="memo-tools">
                {addOpen ? <>
                  <input className="input" style={{ width: 140 }} placeholder="名前（なくてもOK）" value={gName} maxLength={20} onChange={e => setGName(e.target.value)} />
                  <input className="input" style={{ width: 120 }} list="guest-from" placeholder="どこの店から" value={gFrom} maxLength={20} onChange={e => setGFrom(e.target.value)} />
                  <datalist id="guest-from">{Object.entries(names).filter(([id]) => id !== grid.store.id).map(([id, nm]) => <option key={id} value={nm} />)}</datalist>
                  <button type="button" className="btn sm primary" disabled={pending} onClick={() => start(async () => {
                    const r = await addGuest(grid.store.id, grid.start, gName, gFrom); setMsg(r.message);
                    if (r.ok) { setGuests([...guests, { id: r.id, name: r.name, from: gFrom.trim(), cells: grid.days.map(() => '') }]); setGName(''); setGFrom(''); setAddOpen(false); }
                  })}>追加</button>
                  <button type="button" className="btn sm" onClick={() => setAddOpen(false)}>やめる</button>
                </> : <button type="button" className="btn sm" onClick={() => setAddOpen(true)}>＋ 他店から借りる人を追加</button>}
              </div>
            )}
            {helpRows(grid.helpIns).map(row => (
              <Line key={row.memberId}>
                <span className="nm">{row.memberName}<span className="muted" style={{ fontSize: 11 }}>（{row.fromStore}）</span></span>
                {grid.days.map(d => {
                  const h = row.byDate[d.iso];
                  return h
                    ? <button key={d.iso} type="button" className={`cell ${h.status === 'pending' ? 'cut' : 't'} ${helpSel === h.id ? 'sel' : ''}`}
                        title={h.status === 'pending' ? `${h.fromStore}の店長の承認待ち` : '押すと入り時間を決める・取り消す'}
                        onClick={() => { setSel(null); setGuestSel(null); setHelpSel(h.id); setHelpTimeText(h.label); }}>
                        {h.status === 'pending' ? '承認待ち' : h.label || '時間？'}</button>
                    : <span key={d.iso} className="cell ro" />;
                })}
              </Line>
            ))}

            <span className="muted" style={{ fontSize: 12, paddingTop: 6 }}>必要人数</span>
            {grid.needs.map((x, i) => <span key={i} className="muted" style={{ textAlign: 'center', fontSize: 12, paddingTop: 6 }}>{x}</span>)}
            <span style={{ fontSize: 12, fontWeight: 700 }}>出れる人数</span>
            {counts.map((x, i) => <span key={i} className={`cnt ${x < grid.needs[i] ? 'short' : ''}`}>{x}</span>)}
            {grid.store.help_enabled !== false && <>
              <span style={{ fontSize: 12, fontWeight: 700 }} title="ほかの店がこの店の人にヘルプを頼めるか">ヘルプに出す</span>
              {grid.days.map((d, i) => {
                // 自動：未確定は余裕がある日、確定済みはカットの人がいる日
                const diff = counts[i] - grid.needs[i];
                const cut = parts.filter(r => r.cells[i]?.value === 'カット').length;
                const auto = grid.locked ? diff >= 0 && cut > 0 : diff > 0;
                const set = lendSet[i];
                const ok = set ?? auto;
                const next = set === null ? !auto : set === !auto ? auto : null; // 自動 → 逆 → 自動と同じ値（固定） → 自動
                return (
                  <button key={d.iso} type="button" disabled={fixed || !helpAllowed}
                    className={`lend ${ok ? 'ok' : 'ng'} ${set === null ? 'auto' : 'fixed'}`}
                    title={`${set === null ? '自動' : '店長が決めた'}：${ok ? '出せる' : '出せない'}${fixed ? '' : '（押すと切り替え）'}`}
                    onClick={() => {
                      if (fixed || !helpAllowed) return;
                      const ls = lendSet.slice(); ls[i] = next; setLendSet(ls);
                      start(async () => {
                        try { await setLend(grid.store.id, d.iso, next); }
                        catch { setMsg('保存できませんでした。画面を読み込み直してください'); }
                      });
                    }}>{ok ? '○' : '✖'}</button>
                );
              })}
            </>}

            {staff.length > 0 && <span className="band">社員</span>}
            {staff.map((row, r) => (
              <Line key={row.member.id}>
                <span className="nm" title={row.guest ? `${names[row.member.store_id] ?? ''}がメインのかけもち` : row.member.extra_store_ids?.length ? 'かけもち（ほかの店も兼務）' : undefined}>
                  {row.member.name}{row.guest && <span className="muted" style={{ fontSize: 11 }}>（{names[row.member.store_id] ?? ''}）</span>}
                </span>
                {row.cells.map((c, i) => {
                  const st = staffState(c.value, row.member, grid.store.id, off);
                  const cls = st === 'away' ? 'away' : st === 'off' ? 'x' : c.value && !c.value.startsWith('@') ? 'lend' : 't';
                  return (
                    <button key={i} type="button"
                      className={`cell ${cls} ${sel?.kind === 'staff' && sel.r === r && sel.c === i ? 'sel' : ''}`}
                      data-cell={`staff-${r}-${i}`}
                      onClick={() => pickSel({ kind: 'staff', r, c: i })}>{staffLabel(c.value, row.member, grid.store.id, names, off)}</button>
                  );
                })}
              </Line>
            ))}

            <span className="band">メモ（日ごと）</span>
            {memos.map((list, li) => {
              const line = li + 1;
              return (
                <Fragment key={`memo${line}`}>
                  <span className="nm memo-nm">
                    <input type="checkbox" className="memo-share" checked={memoShared[li] ?? true} disabled={readOnly}
                      title="チェックした行だけ、シフト表の画像（LINE で送る・画像で保存）に載ります" aria-label={`${memoName(line)}を画像に載せる`}
                      onChange={e => {
                        const on = e.target.checked; setMemoShared(memoShared.map((x, k) => k === li ? on : x));
                        start(async () => { try { await setMemoSharedAction(grid.store.id, grid.start, line, on); setMsg(on ? `「${memoName(line)}」を画像に載せます` : `「${memoName(line)}」は画像に載せません（店の中だけ）`); } catch { setMsg('保存できませんでした'); } });
                      }} />
                    {readOnly || grid.confirmed
                      ? <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{memoName(line)}</span>
                      : <input className="memo-label" aria-label={`メモ${line}行目の名前`} placeholder={`メモ${line}`} maxLength={8}
                          value={memoLabels[li] ?? ''}
                          onChange={e => { const v = e.target.value; setMemoLabels(memoLabels.map((x, k) => k === li ? v : x)); }}
                          onBlur={e => start(async () => { try { await setMemoLabel(grid.store.id, grid.start, line, e.target.value); } catch { setMsg('保存できませんでした'); } })} />}
                  </span>
                  {grid.days.map((d, i) => (
                    <button key={d.iso} type="button" className={`cell memo ${list[i] ? 'has' : ''} ${noteSel === i && noteLine === line ? 'sel' : ''}`}
                      title={list[i] || (readOnly ? '' : '押すとメモを書けます')} onClick={() => pickNote(i, line)}>
                      {list[i] || (readOnly ? '' : '＋')}
                    </button>
                  ))}
                </Fragment>
              );
            })}
            {!readOnly && (
              <div className="memo-tools">
                {memos.length < 6 && <button type="button" className="btn sm" disabled={pending} onClick={() => start(async () => {
                  const r = await addMemoRow(grid.store.id, grid.start); setMsg(r.message);
                  if (r.ok) { setMemos([...memos, grid.days.map(() => '')]); setMemoLabels([...memoLabels, '']); setMemoShared([...memoShared, true]); }
                })}>＋ メモの行を追加</button>}
                {memos.length > 1 && (askDropMemo
                  ? <span className="row" style={{ gap: 6 }}>
                      <span className="muted" style={{ fontSize: 12 }}>「{memoName(memos.length)}」の行を消しますか？（この期間だけ。書いたメモも消えます）</span>
                      <button type="button" className="btn sm danger" disabled={pending} onClick={() => { setAskDropMemo(false); start(async () => {
                        const r = await removeMemoRow(grid.store.id, grid.start); setMsg(r.message);
                        if (r.ok) { setMemos(memos.slice(0, -1)); setMemoLabels(memoLabels.slice(0, -1)); setMemoShared(memoShared.slice(0, -1)); if (noteLine >= memos.length) setNoteSel(null); }
                      }); }}>消す</button>
                      <button type="button" className="btn sm" onClick={() => setAskDropMemo(false)}>やめる</button>
                    </span>
                  : <button type="button" className="btn sm" onClick={() => setAskDropMemo(true)}>一番下の行を消す</button>)}
              </div>
            )}
          </div>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>変更の履歴（{history.length}件）</summary>
          {history.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>この期間の変更はまだありません。</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, maxHeight: 360, overflowY: 'auto', fontSize: 13 }}>
              {history.map(h => (
                <div key={h.id} className="row" style={{ gap: 10, flexWrap: 'nowrap', borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                  <span className="muted" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{when(h.at)}</span>
                  <span style={{ whiteSpace: 'nowrap', minWidth: 110 }}>{h.actor}</span>
                  <span>{historyText(h)}</span>
                </div>
              ))}
            </div>
          )}
        </details>
      </section>

      {(sel || selHelp || noteSel !== null || guestSel) && <div className="pick-spacer" aria-hidden />}
      <aside className={`card narrow pick ${sel || selHelp || noteSel !== null || guestSel ? 'has-sel' : ''}`} aria-label="選んだマス" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {noteSel !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <span className="muted" style={{ fontSize: 12 }}>メモ</span>
              <button type="button" className="btn sm pick-close" aria-label="閉じる" onClick={() => setNoteSel(null)}>✕</button>
            </div>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <button type="button" className="btn sm" aria-label="前の日" disabled={noteSel <= 0} onClick={() => pickNote(noteSel - 1)}>‹</button>
              <div style={{ fontSize: 18, fontWeight: 700, flex: 1, textAlign: 'center' }}>{grid.days[noteSel].md}({grid.days[noteSel].wd}) の{memoName(noteLine)}</div>
              <button type="button" className="btn sm" aria-label="次の日" disabled={noteSel >= n - 1} onClick={() => pickNote(noteSel + 1)}>›</button>
            </div>
            {readOnly ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{notes[noteSel] || 'メモはありません'}</p> : <>
              <textarea className="input" rows={3} maxLength={NOTE_MAX} value={noteText} placeholder="例：団体20名 18時〜／棚卸し／〇〇さん研修"
                onChange={e => setNoteText(e.target.value)} style={{ resize: 'vertical', fontSize: 16 }} />
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted" style={{ fontSize: 12 }}>{noteText.trim().length} / {NOTE_MAX}字（画像では縦書きになります）</span>
                <span className="row" style={{ gap: 6 }}>
                  {notes[noteSel] && <button type="button" className="btn sm" disabled={pending} onClick={() => { setNoteText(''); saveNote(noteSel, ''); }}>消す</button>}
                  <button type="button" className="btn sm primary" disabled={pending || noteText.trim() === (notes[noteSel] ?? '')} onClick={() => saveNote(noteSel, noteText)}>保存</button>
                </span>
              </div>
            </>}
          </div>
        ) : guestSel && guests[guestSel.g] ? (() => {
          const gu = guests[guestSel.g], cur = gu.cells[guestSel.c] ?? '';
          const setG = (val: string) => {
            if (fixed || !helpAllowed) return;
            const day = grid.days[guestSel.c].iso;
            setGuests(guests.map((x, k) => k !== guestSel.g ? x : { ...x, cells: x.cells.map((c, j) => j === guestSel.c ? val : c) }));
            start(async () => { try { await setGuestCell(grid.store.id, gu.id, day, val); } catch { setMsg('保存できませんでした。画面を読み込み直してください'); } });
            if (autoNext && guestSel.c < n - 1) setGuestSel({ g: guestSel.g, c: guestSel.c + 1 });
          };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span className="muted" style={{ fontSize: 12 }}>他店から借りる人</span>
                <button type="button" className="btn sm pick-close" aria-label="閉じる" onClick={() => setGuestSel(null)}>✕</button>
              </div>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                <button type="button" className="btn sm" aria-label="前の日" disabled={guestSel.c <= 0} onClick={() => setGuestSel({ g: guestSel.g, c: guestSel.c - 1 })}>‹</button>
                <div style={{ fontSize: 18, fontWeight: 700, flex: 1, textAlign: 'center' }}>{gu.name}{gu.from ? `（${gu.from}）` : ''}　{grid.days[guestSel.c].md}({grid.days[guestSel.c].wd})</div>
                <button type="button" className="btn sm" aria-label="次の日" disabled={guestSel.c >= n - 1} onClick={() => setGuestSel({ g: guestSel.g, c: guestSel.c + 1 })}>›</button>
              </div>
              {fixed || !helpAllowed ? <p className="notice" style={{ margin: 0 }}>今のマス：{cur || '来ない日'}</p> : <>
                <div className="opts">
                  {['○', ...partOptions.filter(o => o !== '✖' && o !== 'カット')].map(o => (
                    <button key={o} type="button" className={`opt ${cur === o ? 'on' : ''}`} onClick={() => setG(o)}>{o}</button>
                  ))}
                  <button type="button" className="opt" style={{ gridColumn: '1 / -1' }} onClick={() => setG('')}>来ない日（空白）にする</button>
                </div>
                <button type="button" className="btn sm danger" style={{ alignSelf: 'flex-start' }} disabled={pending} onClick={() => start(async () => {
                  const r = await removeGuest(grid.store.id, gu.id); setMsg(r.message);
                  if (r.ok) { setGuests(guests.filter(x => x.id !== gu.id)); setGuestSel(null); }
                })}>{gu.name}を表から外す</button>
              </>}
            </div>
          );
        })() : selHelp ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <span className="muted" style={{ fontSize: 12 }}>他店からのヘルプ</span>
              <button type="button" className="btn sm pick-close" aria-label="閉じる" onClick={() => setHelpSel(null)}>✕</button>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{selHelp.memberName}（{selHelp.fromStore}）　{grid.days.find(d => d.iso === selHelp.date)?.md}</div>
            {selHelp.status === 'pending'
              ? <p className="notice" style={{ margin: 0 }}>{selHelp.fromStore}の店長の承認待ちです。承認されたら、入り時間を決められます。</p>
              : <span className="pill ok" style={{ alignSelf: 'flex-start' }}>承認済み</span>}
            {!fixed && helpAllowed && selHelp.status === 'approved' && <>
              <span className="muted" style={{ fontSize: 13 }}>入り時間（決めると本人にLINEで知らせます）</span>
              <div className="opts">
                {partOptions.filter(o => o !== '✖' && o !== 'カット').map(o => (
                  <button key={o} type="button" className={`opt ${selHelp.label === o ? 'on' : ''}`} disabled={pending}
                    onClick={() => start(async () => { const r = await setHelpTime(grid.store.id, selHelp.id, o); setMsg(r.message ?? ''); router.refresh(); })}>{o}</button>
                ))}
              </div>
              <div className="row">
                <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="ほかの時間（例 4:45〜）" value={helpTime} onChange={e => setHelpTimeText(e.target.value)} />
                <button type="button" className="btn sm" disabled={pending || !helpTime.trim()}
                  onClick={() => start(async () => { const r = await setHelpTime(grid.store.id, selHelp.id, helpTime); setMsg(r.message ?? ''); router.refresh(); })}>決める</button>
              </div>
            </>}
            {!fixed && helpAllowed && <button type="button" className="btn danger" disabled={pending}
              onClick={() => start(async () => { await removeHelp(grid.store.id, selHelp.id); setHelpSel(null); setMsg(selHelp.status === 'pending' ? '依頼を取り消しました' : 'ヘルプを取り消しました'); router.refresh(); })}>
              {selHelp.status === 'pending' ? '依頼を取り消す' : 'ヘルプを取り消す'}</button>}
          </div>
        ) : sel && selRow && selCell ? <>
          <div>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <span className="muted" style={{ fontSize: 12 }}>選んだマス</span>
              <button type="button" className="btn sm pick-close" aria-label="閉じる" onClick={() => setSel(null)}>✕</button>
            </div>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <button type="button" className="btn sm" aria-label="前の日" onClick={() => move(0, -1)}>‹</button>
              <div style={{ fontSize: 18, fontWeight: 700, flex: 1, textAlign: 'center' }}>{selRow.member.name}　{grid.days[sel.c].md}({grid.days[sel.c].wd})</div>
              <button type="button" className="btn sm" aria-label="次の日" onClick={() => move(0, 1)}>›</button>
            </div>
            {sel.kind === 'part' && <div className="muted">本人の希望：{selCell.req || '未入力'}</div>}
            {sel.kind === 'part' && !fixed && helpAllowed && grid.store.help_enabled !== false && (
              <label className="row" style={{ gap: 6, fontSize: 13, marginTop: 6 }}>
                <input type="checkbox" checked={selRow.helpOk} disabled={pending} onChange={e => {
                  const ok = e.target.checked, id = selRow.member.id;
                  setParts(parts.map(r => r.member.id === id ? { ...r, helpOk: ok } : r));
                  start(async () => {
                    try { await setHelpOk(grid.store.id, id, grid.start, ok); }
                    catch { setMsg('保存できませんでした。画面を読み込み直してください'); }
                  });
                }} />
                {selRow.member.name}さんは、この期間 他の店のヘルプもOK（★）
              </label>
            )}
          </div>
          {lastLog && <p className="muted" style={{ margin: 0, fontSize: 12 }}>最後の変更：{when(lastLog.at)}　{lastLog.actor}（{lastLog.kind === 'help' ? lastLog.note : `${lastLog.before ?? ''} → ${lastLog.after ?? ''}`}）</p>}
          {blockedBy && !fixed ? <p className="notice" style={{ margin: 0 }}>{blockedBy}がこの日を確定済みのため、変えられません。<br />変える時は{blockedBy}の店長に「確定を外す」を押してもらってください。</p> : fixed ? <p className="notice" style={{ margin: 0 }}>今のマス：{sel.kind === 'staff' ? staffLabel(selCell.value, selRow.member, grid.store.id, names, off) : selCell.value || '未入力'}<br />{readOnly ? 'この会社では、店のシフトは店長が決めます。' : '確定済みのため変えられません。変える時は上の「確定を外す」を押してください。'}</p> : <>
          <div className="opts">
            {opts.map(o => (
              <button key={o.value} type="button" className={`opt ${selCell.value === o.value ? 'on' : ''}`} onClick={() => update(o.value)}>{o.label}</button>
            ))}
            {canHelp && <button type="button" className={`opt ${selCell.value.startsWith('→') || helpPick ? 'on' : ''}`} onClick={() => setHelpPick(!helpPick)}>
              {selCell.value.startsWith('→') ? selCell.value.replace(/^→/, 'ヘルプ ') : 'ヘルプ'}</button>}
            {canHelp && helpPick && helpStores.map(nm => (
              <button key={nm} type="button" className="opt" style={{ fontSize: 13 }} onClick={() => { setHelpPick(false); update(`→${nm}${curTime ? ` ${curTime}` : ''}`); }}>→{nm}</button>
            ))}
            <button type="button" className="opt" style={{ gridColumn: '1 / -1' }} onClick={() => update(null)}>{resetLabel}</button>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={autoNext} onChange={e => setAutoNext(e.target.checked)} />選んだら次の日へ</label>
            <span className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm" onClick={() => move(-1, 0)}>↑ 前の人</button>
              <button type="button" className="btn sm" onClick={() => move(1, 0)}>↓ 次の人</button>
            </span>
          </div>
          <p className="muted pick-note" style={{ margin: 0 }}>
            「ヘルプに出す」の行は、ほかの店がこの店の人にヘルプを頼めるか。薄い色＝自動（余裕がある日は○）、濃い色＝店長が決めた日。押すたびに切り替わります。<br />
            「カット」は、出れると出したけど店で入れなかった日。他の店からはヘルプを頼める日として見えます。
          </p></>}
        </> : <p className="muted">{fixed ? '表のマスを押すと、本人の希望が見れます。' : '表のマスを押すと、ここで時間や✖を選べます。'}</p>}
      </aside>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
