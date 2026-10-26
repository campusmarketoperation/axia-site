import { cellLabel, staffLabel, staffOffOptions, staffState } from './shift';
// シフト表を画像（PNG）にして保存する（ブラウザで実行）
import type { Grid } from './data';
import { helpRows } from './helpRows';

const NAVY = '#16213E', GOLD2 = '#D9BE8C', LINE = '#D6D1C4', OKBG = '#DCE6F5', NGBG = '#F6E3E7', NG = '#B4546B',
  SUN = '#C4413A', SAT = '#2F5FA8', SOFT = '#F4F1EA', CUT = '#E4E6EB', SHORT = '#B4364F', LENDBG = '#EFE6D2', LENDINK = '#6B4A12';
const FONT = '"Zen Kaku Gothic New","Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif';

/** シフト表を canvas に描く */
function renderGrid(g: Grid & { counts: number[] }): HTMLCanvasElement {
  const n = g.days.length;
  const NAME_W = 110, DAY_W = 62, ROW_H = 36, HEAD_H = 30, PAD = 28, TITLE_H = 70, GAP = 14;
  type R = { name: string; cells: string[]; type: 'part' | 'help' | 'count' | 'staffHead' | 'staff' | 'memo'; idx?: number; h?: number; colH?: number };
  const rows: R[] = [];
  g.parts.filter(r => r.cells.some(c => c.value)).forEach(r => rows.push({ name: r.member.name, cells: r.cells.map(c => cellLabel(c.value)), type: 'part' }));
  helpRows(g.helpIns.filter(h => h.status === 'approved')).forEach(r => rows.push({ name: `${r.memberName}（${r.fromStore}）`, cells: g.days.map(d => (r.byDate[d.iso] ? r.byDate[d.iso].label || '○' : '')), type: 'help' }));
  (g.guests ?? []).filter(x => x.cells.some(Boolean)).forEach(x => rows.push({ name: x.from ? `${x.name}（${x.from}）` : x.name, cells: x.cells, type: 'help' }));
  rows.push({ name: '出れる人数', cells: g.counts.map(String), type: 'count' });
  if (g.staff.length) {
    rows.push({ name: '社員', cells: g.days.map(() => ''), type: 'staffHead' });
    g.staff.forEach((r, idx) => rows.push({ name: r.guest ? `${r.member.name}（${g.storeNames?.[r.member.store_id] ?? ''}）` : r.member.name, cells: r.cells.map(c => staffLabel(c.value, r.member, g.store.id, g.storeNames ?? {}, staffOffOptions(g.store))), type: 'staff', idx }));
  }
  // メモは縦書き。1マスに3列まで入るよう、列の高さ（字数）を決める
  const memoCols = (t: string, colH: number) => t ? t.split('\n').reduce((a, seg) => a + Math.max(1, Math.ceil(vTokens(seg).length / colH)), 0) : 0;
  (g.memos ?? []).forEach((raw, k) => {
    if (g.memoShared && g.memoShared[k] === false) return; // 「画像に載せる」を外した行は出さない
    const notes = raw.map(t => (t ?? '').trim());
    if (!notes.some(Boolean)) return;
    let colH = 4;
    while (colH < 80 && notes.some(t => memoCols(t, colH) > MEMO_COLS)) colH++;
    rows.push({ name: g.memoLabels?.[k] || 'メモ', cells: notes, type: 'memo', h: colH * MEMO_CH + 18, colH });
  });
  const rowH = (r: R) => r.h ?? ROW_H;
  const tableW = NAME_W + DAY_W * n, W = tableW + PAD * 2;
  const H = PAD + TITLE_H + HEAD_H * 2 + rows.reduce((a, r) => a + rowH(r) + (r.type === 'staffHead' || r.type === 'memo' ? GAP : 0), 0) + PAD;
  const S = 2, c = document.createElement('canvas');
  c.width = W * S; c.height = H * S;
  const x = c.getContext('2d')!;
  x.scale(S, S);
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = NAVY; x.fillRect(0, 0, W, PAD + TITLE_H - 14);
  x.textBaseline = 'middle'; x.textAlign = 'left';
  x.fillStyle = GOLD2; x.font = `700 12px ${FONT}`; x.fillText(`${g.store.name}　確定シフト`, PAD, PAD + 8);
  x.fillStyle = '#fff'; x.font = `700 28px ${FONT}`; x.fillText(g.label, PAD, PAD + 36);
  x.textAlign = 'center';
  const x0 = PAD, dayX = (i: number) => x0 + NAME_W + DAY_W * i;
  let y = PAD + TITLE_H;
  const headTop = y;
  for (let k = 0; k < 2; k++) {
    x.fillStyle = SOFT; x.fillRect(x0, y, tableW, HEAD_H);
    g.days.forEach((d, i) => {
      x.fillStyle = d.wd === '日' ? SUN : d.wd === '土' ? SAT : NAVY;
      x.font = `700 ${k === 0 ? 14 : 12}px ${FONT}`;
      x.fillText(k === 0 ? (d.first ? d.md : d.md.split('/')[1]) : d.wd, dayX(i) + DAY_W / 2, y + HEAD_H / 2);
    });
    y += HEAD_H;
  }
  x.fillStyle = NAVY; x.font = `700 13px ${FONT}`; x.fillText('名前', x0 + NAME_W / 2, headTop + HEAD_H);
  const bodyTop = y;
  const off = staffOffOptions(g.store);
  rows.forEach(r => {
    if (r.type === 'staffHead' || r.type === 'memo') y += GAP;
    const top = y;
    if (r.type === 'staffHead') { x.fillStyle = NAVY; x.fillRect(x0, top, tableW, ROW_H); }
    if (r.type === 'count') { x.fillStyle = SOFT; x.fillRect(x0, top, tableW, ROW_H); }
    x.textAlign = 'left'; x.fillStyle = r.type === 'staffHead' ? GOLD2 : NAVY;
    x.font = `700 ${r.type === 'count' || r.type === 'help' ? 12 : 14}px ${FONT}`;
    x.fillText(r.name, x0 + 10, r.type === 'memo' ? top + 18 : top + ROW_H / 2);
    x.textAlign = 'center';
    if (r.type === 'memo') {
      r.cells.forEach((t, i) => { if (t) drawVertical(x, t, dayX(i), top, DAY_W, r.colH ?? 4); });
      y += rowH(r);
      x.strokeStyle = LINE; x.lineWidth = 1; x.beginPath(); x.moveTo(x0, y + .5); x.lineTo(x0 + tableW, y + .5); x.stroke();
      return;
    }
    r.cells.forEach((v, i) => {
      const cx = dayX(i);
      if (r.type === 'count' && +v < g.needs[i]) { x.fillStyle = SHORT; x.fillRect(cx, top, DAY_W, ROW_H); }
      if ((r.type === 'part' || r.type === 'help') && v) { x.fillStyle = v === '✖' ? NGBG : v === 'カット' ? CUT : OKBG; x.fillRect(cx, top, DAY_W, ROW_H); }
      let staffInk = '';
      if (r.type === 'staff') {
        const sr = g.staff[r.idx!];
        const raw = sr?.cells[i]?.value ?? '';
        const st = sr ? staffState(raw, sr.member, g.store.id, off) : 'work';
        const kind = st === 'away' ? 'away' : st === 'off' ? 'off' : raw && !raw.startsWith('@') ? 'opt' : 'work';
        x.fillStyle = kind === 'work' ? OKBG : kind === 'opt' ? LENDBG : kind === 'away' ? CUT : NGBG; x.fillRect(cx, top, DAY_W, ROW_H);
        staffInk = kind === 'work' ? NAVY : kind === 'opt' ? LENDINK : kind === 'away' ? '#8A90A2' : NG;
      }
      if (!v) return;
      x.fillStyle = staffInk ? staffInk : r.type === 'count' && +v < g.needs[i] ? '#fff' : v === '✖' ? NG : v === 'カット' ? '#8A90A2' : NAVY;
      x.font = `${v === '✖' ? 400 : 700} ${v.length >= 5 ? 11 : v.length >= 4 ? 12 : 14}px ${FONT}`;
      x.fillText(v, cx + DAY_W / 2, top + ROW_H / 2 + 1);
    });
    y += ROW_H;
    x.strokeStyle = LINE; x.lineWidth = 1; x.beginPath(); x.moveTo(x0, y + .5); x.lineTo(x0 + tableW, y + .5); x.stroke();
  });
  for (let i = 0; i <= n; i++) {
    const px = dayX(i) + .5, monthStart = i > 0 && i < n && g.days[i].first;
    x.strokeStyle = monthStart ? NAVY : LINE; x.lineWidth = monthStart ? 2 : 1;
    x.beginPath(); x.moveTo(px, headTop); x.lineTo(px, y); x.stroke();
  }
  x.strokeStyle = NAVY; x.lineWidth = 1.5;
  x.strokeRect(x0 + .5, headTop + .5, tableW - 1, y - headTop - 1);
  x.beginPath(); x.moveTo(x0, bodyTop + .5); x.lineTo(x0 + tableW, bodyTop + .5); x.stroke();

  return c;
}

const MEMO_COLS = 3, MEMO_CH = 15, MEMO_COLW = 17, MEMOBG = '#FFF8E6';
// 縦書きで横に倒す字（のばし棒・かっこなど）と、右上に寄せる句読点
const ROTATE = new Set(Array.from('ー－—―-〜～~…‥()（）「」『』[]【】<>＜＞→←=＝:：|｜'));
const PUNCT = new Set(Array.from('、。，．,.'));

/** 縦書きの1字ずつ。2けたまでの数字・英字は横にまとめる（縦中横） */
function vTokens(seg: string): string[] {
  const out: string[] = [];
  for (const m of seg.match(/[0-9A-Za-z]+|[\s\S]/gu) ?? []) {
    if (/^[0-9A-Za-z]+$/.test(m) && m.length > 2) out.push(...Array.from(m)); else out.push(m);
  }
  return out;
}

/** マスの中に縦書き（右の列から左へ）。改行で次の列 */
function drawVertical(x: CanvasRenderingContext2D, t: string, cx: number, top: number, w: number, colH: number) {
  const cols: string[][] = [];
  t.split('\n').forEach(seg => {
    const ch = vTokens(seg);
    if (!ch.length) { cols.push([]); return; }
    for (let k = 0; k < ch.length; k += colH) cols.push(ch.slice(k, k + colH));
  });
  const used = cols.slice(0, MEMO_COLS);
  x.fillStyle = MEMOBG; x.fillRect(cx + 1, top + 1, w - 2, colH * MEMO_CH + 16);
  x.fillStyle = NAVY; x.font = `500 13px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  const right = cx + w / 2 + ((used.length - 1) * MEMO_COLW) / 2;
  used.forEach((col, k) => {
    const px = right - k * MEMO_COLW;
    col.forEach((c, j) => {
      const py = top + 9 + j * MEMO_CH + MEMO_CH / 2;
      if (ROTATE.has(c)) { x.save(); x.translate(px, py); x.rotate(Math.PI / 2); x.fillText(c, 0, 0); x.restore(); }
      else if (PUNCT.has(c)) x.fillText(c, px + MEMO_CH * 0.35, py - MEMO_CH * 0.35);
      else if (c.length === 2) { x.font = `500 11px ${FONT}`; x.fillText(c, px, py); x.font = `500 13px ${FONT}`; }
      else x.fillText(c, px, py);
    });
  });
}

/** 画像（PNG）で保存 */
export function exportGridImage(g: Grid & { counts: number[] }) {
  const c = renderGrid(g);
  c.toBlob(b => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `シフト表_${g.store.name}_${g.label.replace(/\//g, '.')}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }, 'image/png');
}

/** LINEで送る用：JPEG（本体）と小さいプレビュー（LINE の決まり：プレビューは 1MB まで）を base64 で */
export async function gridImageForLine(g: Grid & { counts: number[] }): Promise<{ full: string; preview: string }> {
  const c = renderGrid(g);
  const toB64 = (cv: HTMLCanvasElement, q: number) => cv.toDataURL('image/jpeg', q).split(',')[1];
  const scale = Math.min(1, 1024 / c.width);
  const p = document.createElement('canvas');
  p.width = Math.round(c.width * scale); p.height = Math.round(c.height * scale);
  const px = p.getContext('2d')!;
  px.fillStyle = '#fff'; px.fillRect(0, 0, p.width, p.height);
  px.drawImage(c, 0, 0, p.width, p.height);
  return { full: toB64(c, 0.9), preview: toB64(p, 0.75) };
}
