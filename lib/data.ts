import { db } from './supabase/admin';
import { isStopped } from './companyState';
import { confirmedDays } from './confirm';
import { iso, md, wd, isWeekend, periodDays, periodLabel, periodStartOf, type Split } from './period';
import { cellFromRequest, isFreeAfterLock, isWorkingPart, staffOffOptions, staffState, type Member, type Req, type Store } from './shift';

export const splitOf = (s: Store): Split => [s.split1, s.split2];
/** メモの行（名前の一覧）。決めていなければ2行 */
export const MEMO_MAX = 6;
export const memoLabelsOf = (s: Store): string[] => (s.memo_labels && s.memo_labels.length ? s.memo_labels : ['', '']).slice(0, MEMO_MAX);
/** その期間のメモの行。決めていなければ、前の期間（いちばん近い）の形 → 店の形（2行） */
export async function periodMemoLabels(store: Store, periodStart: string, own?: string[] | null): Promise<string[]> {
  if (own === undefined) {
    const { data } = await db().from('period_locks').select('memo_labels').eq('store_id', store.id).eq('period_start', periodStart).maybeSingle();
    own = data?.memo_labels ?? null;
  }
  if (own && own.length) return own.slice(0, MEMO_MAX);
  const { data: prev } = await db().from('period_locks').select('memo_labels').eq('store_id', store.id)
    .lt('period_start', periodStart).not('memo_labels', 'is', null).order('period_start', { ascending: false }).limit(1).maybeSingle();
  if (prev?.memo_labels?.length) return (prev.memo_labels as string[]).slice(0, MEMO_MAX);
  return memoLabelsOf(store);
}

export type Day = { iso: string; md: string; wd: string; weekend: boolean; first: boolean };
export type Cell = { value: string; req: string; edited: boolean };
export type Row = { member: Member; helpOk: boolean; submitted: boolean; started: boolean; cells: Cell[]; guest?: boolean }; // submitted＝全部の日に希望がある／started＝1日でも出している // guest＝かけもちで、ほかの店がメインの社員
export type Guest = { id: string; name: string; from: string; cells: string[] };
export type HelpIn = { id: string; memberId: string; memberName: string; fromStore: string; date: string; label: string; status: 'pending' | 'approved' };
/** 自分の店の人への、ヘルプの依頼（承認待ち） */
export type HelpAsk = { id: string; memberName: string; toStore: string; date: string; requestedBy: string };
export type Grid = {
  store: Store;
  start: string;
  label: string;
  days: Day[];
  parts: Row[];
  staff: Row[];
  helpIns: HelpIn[];
  guests: Guest[];               // 他店から借りたヘルプ（名前で手入力した人）
  helpAsks: HelpAsk[];
  counts: number[];
  needs: number[];
  locked: boolean;               // 締め切り（バイトが希望を変えられない）
  confirmed: boolean;            // 確定（店長もシフトを変えられない）
  sentAt: string | null;
  lendSet: (boolean | null)[];   // 店長が決めた「ヘルプに出せる」（null＝自動）
  memos: string[][];             // 日ごとのメモ（社員の下の欄）。[行][日]
  memoLabels: string[];          // メモの行の名前（行の数＝この長さ）
  memoShared: boolean[];         // メモの行を画像に載せる（みんなに送る）か
  storeNames: Record<string, string>; // 会社の店の名前（かけもちの表示用）
  staffBlocked: Record<string, string[]>; // かけもちの社員：ほかの店が確定済みの日は、その店の名前（変えられない）
};

/** 店舗の、期間（start〜）の表を作る。days を渡すと、その日付の範囲で作る（近隣・本部用） */
export async function loadGrid(store: Store, start: Date, daysIn?: Date[]): Promise<Grid> {
  const split = splitOf(store);
  const ds = daysIn ?? periodDays(start, split);
  const from = iso(ds[0]), to = iso(ds[ds.length - 1]);
  const ownStart = iso(periodStartOf(ds[0], split));

  const [{ data: mem }, { data: guestMem }, { data: names }] = await Promise.all([
    db().from('members').select('*').eq('store_id', store.id).eq('active', true).order('sort').order('created_at'),
    // かけもち：ほかの店がメインで、この店も兼務している社員
    db().from('members').select('*').eq('kind', 'staff').eq('active', true).contains('extra_store_ids', [store.id]).order('sort'),
    db().from('stores').select('id, name').eq('company_id', store.company_id),
  ]);
  const guests = ((guestMem ?? []) as Member[]).filter(m => m.store_id !== store.id);
  // バイト番号はシフト表には要らない（画面に送らない）
  const members = [...((mem ?? []) as Member[]), ...guests].map(({ pin: _pin, ...m }) => m as Member);
  const storeNames: Record<string, string> = Object.fromEntries((names ?? []).map((r: any) => [r.id, r.name]));
  const ids = members.map(m => m.id);
  const none = ['00000000-0000-0000-0000-000000000000'];

  const [rq, sh, hp, lk, hin, ld, ask, nt, gs] = await Promise.all([
    db().from('requests').select('member_id, date, status, start_time').in('member_id', ids.length ? ids : none).gte('date', from).lte('date', to),
    db().from('shifts').select('member_id, date, value').in('member_id', ids.length ? ids : none).gte('date', from).lte('date', to),
    db().from('period_help').select('member_id, help_ok, answered').in('member_id', ids.length ? ids : none).eq('period_start', ownStart),
    db().from('period_locks').select('locked, sent_at, confirmed, memo_labels, memo_shared').eq('store_id', store.id).eq('period_start', ownStart).maybeSingle(),
    db().from('help_assignments').select('id, member_id, date, start_label, status, members(name), from:stores!help_assignments_from_store_fkey(name)')
      .eq('to_store', store.id).gte('date', from).lte('date', to),
    db().from('store_lend_days').select('date, ok').eq('store_id', store.id).gte('date', from).lte('date', to),
    db().from('help_assignments').select('id, date, requested_by, members(name), to:stores!help_assignments_to_store_fkey(name)')
      .eq('from_store', store.id).eq('status', 'pending').gte('date', from).lte('date', to).order('date'),
    db().from('store_memos').select('date, line, note').eq('store_id', store.id).gte('date', from).lte('date', to),
    db().from('help_guests').select('id, name, from_store, help_guest_days(date, value)').eq('store_id', store.id).eq('period_start', ownStart).order('created_at'),
  ]);
  const memoMap = new Map<string, string>((nt.data ?? []).map((r: any) => [`${r.line}|${r.date}`, r.note ?? '']));
  const memoLabels = await periodMemoLabels(store, ownStart, (lk.data as any)?.memo_labels ?? null);
  const sharedRaw = ((lk.data as any)?.memo_shared ?? null) as boolean[] | null;
  const memoShared = memoLabels.map((_, i) => sharedRaw?.[i] ?? true);
  const lendMap = new Map<string, boolean>((ld.data ?? []).map((r: any) => [r.date, r.ok]));

  const reqMap = new Map<string, Req>();
  (rq.data ?? []).forEach((r: any) => reqMap.set(`${r.member_id}|${r.date}`, { status: r.status, start_time: r.start_time }));
  const shiftMap = new Map<string, string>();
  (sh.data ?? []).forEach((r: any) => shiftMap.set(`${r.member_id}|${r.date}`, r.value));
  // ヘルプOK：その期間に答えていればその答え。答えていなければ、登録の時に決めた「ヘルプに行ける店」があるかどうか
  // ヘルプを募集しない店は、だれもヘルプ要員にしない
  const answered = new Map<string, boolean>((hp.data ?? []).filter((r: any) => r.answered !== false).map((r: any) => [r.member_id, !!r.help_ok]));
  const helpSet = new Set(store.help_enabled === false ? [] : members
    .filter(m => answered.has(m.id) ? answered.get(m.id) : !!m.help_stores && m.help_stores.length > 0)
    .map(m => m.id));
  // 提出済み＝期間の全部の日に希望（○・時間・✖）が入っている
  const reqCount = new Map<string, number>();
  (rq.data ?? []).forEach((r: any) => reqCount.set(r.member_id, (reqCount.get(r.member_id) ?? 0) + 1));

  const days: Day[] = ds.map((d, i) => ({ iso: iso(d), md: md(d), wd: wd(d), weekend: isWeekend(d), first: i === 0 || d.getUTCDate() === 1 }));
  const row = (m: Member): Row => ({
    member: m,
    helpOk: helpSet.has(m.id),
    submitted: (reqCount.get(m.id) ?? 0) >= ds.length,
    started: (reqCount.get(m.id) ?? 0) > 0,
    cells: days.map(d => {
      const req = cellFromRequest(reqMap.get(`${m.id}|${d.iso}`));
      const s = shiftMap.get(`${m.id}|${d.iso}`);
      return { value: s ?? req, req, edited: s !== undefined };
    }),
  });
  const parts = members.filter(m => m.kind === 'part').map(row);
  const staff = members.filter(m => m.kind === 'staff').map(m => ({ ...row(m), guest: m.store_id !== store.id }));
  // かけもちの社員：ほかの店（メイン・兼務先）が確定済みの日は、この店からも変えられない
  const otherIds = staff.flatMap(r => [r.member.store_id, ...(r.member.extra_store_ids ?? [])]).filter(id => id !== store.id);
  const cd = otherIds.length ? await confirmedDays(otherIds, days.map(d => d.iso)) : {};
  const staffBlocked: Record<string, string[]> = Object.fromEntries(staff.map(r => [r.member.id, days.map((_, i) => {
    const hit = [r.member.store_id, ...(r.member.extra_store_ids ?? [])].find(id => id !== store.id && cd[id]?.[i]);
    return hit ? (storeNames[hit] ?? '他店') : '';
  })]));
  const helpIns: HelpIn[] = (hin.data ?? []).map((h: any) => ({
    id: h.id, memberId: h.member_id, memberName: h.members?.name ?? '', fromStore: h.from?.name ?? '', date: h.date, label: h.start_label, status: h.status ?? 'approved',
  }));
  const helpAsks: HelpAsk[] = (ask.data ?? []).map((h: any) => ({ id: h.id, memberName: h.members?.name ?? '', toStore: h.to?.name ?? '', date: h.date, requestedBy: h.requested_by ?? '' }));
  const helpGuests: Guest[] = (gs.data ?? []).map((g: any) => {
    const m = new Map<string, string>((g.help_guest_days ?? []).map((x: any) => [x.date, x.value]));
    return { id: g.id, name: g.name, from: g.from_store ?? '', cells: days.map(d => m.get(d.iso) ?? '') };
  });
  // 出れる人数＝バイト（時間・○）＋社員（休み以外）＋他店からのヘルプ（手入力の人も）
  const counts = days.map((d, i) => parts.filter(r => isWorkingPart(r.cells[i].value)).length + staff.filter(r => staffState(r.cells[i].value, r.member, store.id, staffOffOptions(store)) === 'work').length + helpIns.filter(h => h.date === d.iso && h.status === 'approved').length + helpGuests.filter(g => isWorkingPart(g.cells[i])).length);
  const needs = days.map(d => (d.weekend ? store.need_weekend : store.need_weekday));

  return {
    store, start: iso(start), label: periodLabel(start, split), days, parts, staff, helpIns, guests: helpGuests, helpAsks, counts, needs,
    locked: !!lk.data?.locked, confirmed: !!(lk.data as any)?.confirmed, sentAt: lk.data?.sent_at ?? null,
    lendSet: days.map(d => lendMap.has(d.iso) ? lendMap.get(d.iso)! : null),
    memos: memoLabels.map((_, li) => days.map(d => memoMap.get(`${li + 1}|${d.iso}`) ?? '')),
    memoLabels,
    memoShared,
    storeNames, staffBlocked,
  };
}

/** 他の店から見た時の、ヘルプOKの人の「行ける日」 */
export type Avail = { name: string; memberId: string; helpStores: string[] | null; cells: { show: string; free: boolean }[]; note: string[] };
export function helpAvailability(g: Grid): Avail[] {
  return g.parts.filter(r => r.helpOk).map(r => ({
    name: r.member.name,
    memberId: r.member.id,
    helpStores: r.member.help_stores ?? null,
    note: r.cells.map((c, i) => `${g.days[i].md}(${g.days[i].wd})　${c.req || '−'}`),
    cells: r.cells.map(c => {
      if (g.locked) {
        if (c.value.startsWith('→')) return { show: c.value, free: false };
        if (isFreeAfterLock(c.value)) {
          const free = c.req !== '✖';
          return { show: free ? (c.req || '○') : '✖', free };
        }
        return { show: ['✖', '×', '休', '有給'].includes(c.value) ? '✖' : '自店', free: false };
      }
      // 未確定：希望をそのまま（自分の店に入る日も含む）
      return { show: c.req, free: c.req !== '' && c.req !== '✖' };
    }),
  }));
}

export async function companyStores(companyId: string): Promise<Store[]> {
  const { data } = await db().from('stores').select('*').eq('company_id', companyId).order('sort').order('created_at');
  return (data ?? []) as Store[];
}

export async function getStore(id: string): Promise<Store | null> {
  const { data } = await db().from('stores').select('*').eq('id', id).maybeSingle();
  return (data as Store) ?? null;
}

export async function storeByToken(token: string): Promise<Store | null> {
  const { data } = await db().from('stores').select('*').eq('submit_token', token).maybeSingle();
  return (data as Store) ?? null;
}

export async function companyActive(companyId: string): Promise<boolean> {
  const { data } = await db().from('companies').select('status, stop_on').eq('id', companyId).maybeSingle();
  return !!data && !isStopped(data);
}

/**
 * 本部・近隣から見た過不足（出れる人数 − 必要人数）
 *  未確定：そのまま
 *  確定済み：足りない日はマイナス。足りている日は「カット」の人数だけプラス（ほかの店に回せる人）
 */
export function diffsOf(g: Grid): number[] {
  return g.days.map((_, i) => {
    const d = g.counts[i] - g.needs[i];
    if (!g.locked || d < 0) return d;
    return g.parts.filter(r => r.cells[i]?.value === 'カット').length;
  });
}

/** ヘルプに出せる日：店長が決めた日はそのとおり。決めていない日は自動（余裕がある日＝出せる） */
export function lendOf(g: Grid): boolean[] {
  const diffs = diffsOf(g);
  return g.days.map((_, i) => g.lendSet[i] ?? diffs[i] > 0);
}

export { helpRows } from './helpRows';
