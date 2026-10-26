// 店のトップに出す「今日・明日の出勤」（入り時間の早い順）
import type { Grid } from './data';
import { cellLabel, isWorkingPart, shortTime, staffOffOptions, staffState, timeList, type Store } from './shift';

export type Lineup = {
  iso: string; md: string; wd: string;
  confirmed: boolean;
  slots: { time: string; min: number; people: { name: string; note?: string }[] }[];
  staff: { name: string; note?: string }[];
  away: { name: string; to: string }[];
  total: number; need: number;
};

/** 「5〜」「11:30〜」「17:00」→ 分（店の入り時間の範囲に合わせて午前・午後を決める） */
function minutesOf(v: string, store: Store, known: Map<string, number>): number | null {
  if (known.has(v)) return known.get(v)!;
  const m = v.match(/(\d{1,2})(?:[:：時](\d{2}))?/);
  if (!m) return null;
  const h = +m[1], mi = +(m[2] ?? 0);
  const toMin = (t: string) => { const [a, b] = t.split(':').map(Number); return a * 60 + (b || 0); };
  const lo = toMin(store.time_from) - 120, hi = toMin(store.time_to) + 120;
  const am = h * 60 + mi, pm = (h + 12) * 60 + mi;
  if (h < 12 && pm >= lo && pm <= hi && !(am >= lo && am <= hi)) return pm;
  return am;
}
const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

export function lineupOf(g: Grid, dayIso: string): Lineup | null {
  const i = g.days.findIndex(d => d.iso === dayIso);
  if (i < 0) return null;
  const d = g.days[i];
  const store = g.store;
  const known = new Map(timeList(store).map(t => { const [a, b] = t.split(':').map(Number); return [shortTime(t), a * 60 + (b || 0)] as [string, number]; }));
  const groups = new Map<string, { min: number; people: { name: string; note?: string }[] }>();
  const put = (v: string, p: { name: string; note?: string }) => {
    const min = v === '○' || !v ? null : minutesOf(v, store, known);
    const key = min === null ? '時間未定' : hhmm(min);
    if (!groups.has(key)) groups.set(key, { min: min ?? 99999, people: [] });
    groups.get(key)!.people.push(p);
  };
  g.parts.forEach(r => { const v = r.cells[i].value; if (isWorkingPart(v)) put(v, { name: r.member.name }); });
  g.helpIns.filter(h => h.date === dayIso && h.status === 'approved').forEach(h => put(h.label || '', { name: h.memberName, note: `${h.fromStore}からヘルプ` }));
  g.guests.forEach(x => { const v = x.cells[i]; if (!isWorkingPart(v)) return;
    const from = x.from ? `${x.from}から` : '';
    // 名前を入れていないヘルプの人は「漁火からヘルプ」とだけ出す
    put(v, x.name ? { name: x.name, note: `${from}ヘルプ` } : { name: `${from}ヘルプ` }); });
  const off = staffOffOptions(store);
  const staff = g.staff.filter(r => staffState(r.cells[i].value, r.member, store.id, off) === 'work')
    .map(r => { const v = r.cells[i].value; return { name: r.member.name, note: v && !v.startsWith('@') ? v : undefined }; });
  const away = g.parts.filter(r => r.cells[i].value.startsWith('→')).map(r => ({ name: r.member.name, to: cellLabel(r.cells[i].value) }));
  const slots = [...groups.entries()].map(([time, x]) => ({ time, ...x })).sort((a, b) => a.min - b.min);
  return {
    iso: d.iso, md: d.md, wd: d.wd, confirmed: g.confirmed, slots, staff, away,
    total: g.counts[i], need: g.needs[i],
  };
}
