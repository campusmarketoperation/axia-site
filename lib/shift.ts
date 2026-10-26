// シフトの表示ルール（店長画面・LINE・近隣・本部で共通）
export type Store = {
  id: string;
  company_id: string;
  name: string;
  sort: number;
  split1: number;
  split2: number;
  time_from: string;
  time_to: string;
  time_step: number;
  staff_options: string[];      // 社員の欄：出勤扱いの選択肢（早番・遅番・研修など）
  staff_off_options?: string[]; // 社員の欄：休みの選択肢（休・有給・公休など）
  need_weekday: number;
  need_weekend: number;
  help_enabled: boolean;
  memo_labels?: string[] | null; // メモ（日ごと）の左の欄の名前（2行分）
  submit_token: string;
  join_code: string;
};
export type Member = { id: string; store_id: string; name: string; kind: 'part' | 'staff'; sort: number; active: boolean; line_user_id: string | null; help_stores?: string[] | null; extra_store_ids?: string[] | null; pin?: string };
export type Req = { status: 'ok' | 'ng'; start_time: string | null };

/** '17:30' → '5:30〜'、'17:00' → '5〜'（紙のシフト表と同じ書き方） */
export function shortTime(t: string | null | undefined): string {
  if (!t) return '○';
  const [h, m] = t.split(':').map(Number);
  const hh = h > 12 ? h - 12 : h;
  return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''}〜`;
}

/** 提出画面の入り時間の選択肢（'14:30' など） */
export function timeList(s: Pick<Store, 'time_from' | 'time_to' | 'time_step'>): string[] {
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const out: string[] = [];
  const step = Math.max(5, s.time_step || 30);
  for (let m = toMin(s.time_from); m <= toMin(s.time_to); m += step) out.push(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  return out;
}

/** 店長がマスに入れられる値 */
export function partOptions(s: Store): string[] {
  return timeList(s).map(shortTime).concat(['✖', 'カット']);
}
export function staffOffOptions(s: Pick<Store, 'staff_off_options'>): string[] {
  return s.staff_off_options ?? ['休', '有給'];
}
/** 社員の欄の選択肢：出勤扱い → 休み の順 */
export function staffOptions(s: Store): string[] {
  return [...(s.staff_options ?? []), ...staffOffOptions(s)];
}

/** 希望 → マスの表示 */
export function cellFromRequest(r?: Req | null): string {
  if (!r) return '';
  return r.status === 'ng' ? '✖' : shortTime(r.start_time);
}

const OFF = ['', '✖', '×', 'カット', '休', '有給'];
/** バイトの行：出勤（出れる人数に数える）か */
export function isWorkingPart(v: string): boolean {
  return !OFF.includes(v) && !v.startsWith('→');
}
/** 社員の行：空白・出勤扱いの選択肢＝出勤。休みの選択肢（店ごと）・✖・ヘルプ（→）＝この店では数えない */
export function isWorkingStaff(v: string, off: string[] = ['休', '有給']): boolean {
  return !off.includes(v) && !['✖', '×'].includes(v) && !v.startsWith('→');
}
/** 確定後に「自分の店に入っていない」＝ヘルプに出せる */
export function isFreeAfterLock(v: string): boolean {
  return v === '' || v === 'カット';
}

/** マスの表示：ヘルプに行く日（→漁火 5〜）は「漁火5〜」 */
export function cellLabel(v: string): string {
  return v.startsWith('→') ? v.slice(1).replace(/\s+/g, '') : v;
}

/** その人が、その店へヘルプに行けるか（help_stores が null＝まだ決めていない＝どの店でもOK） */
export function canHelpAt(m: Pick<Member, 'help_stores'>, storeId: string): boolean {
  return !m.help_stores || m.help_stores.includes(storeId);
}

/** シフト表の日ごとのメモの字数（画像で縦書きにした時につぶれない長さ） */
export const NOTE_MAX = 60;

/**
 * 社員のマスが、その店でどうなるか（かけもちの社員に対応）
 *  メインの店：空白・出勤の選択肢 → 出勤、「@別の店」→ そっちで出勤（ここでは数えない）
 *  兼務先の店：「@この店」→ 出勤、空白など → メインの店にいる（数えない）、休みの選択肢 → 休み
 */
export function staffState(v: string, m: Pick<Member, 'store_id'>, storeId: string, off: string[]): 'work' | 'off' | 'away' {
  if (v.startsWith('@')) return v.slice(1) === storeId ? 'work' : 'away';
  if (v.startsWith('→')) return 'away';
  const working = isWorkingStaff(v, off);
  if (m.store_id === storeId) return working ? 'work' : 'off';
  return working ? 'away' : 'off';
}

/** 社員のマスに出す文字（店の名前は names から） */
export function staffLabel(v: string, m: Pick<Member, 'store_id'>, storeId: string, names: Record<string, string>, off: string[] = ['休', '有給']): string {
  if (v.startsWith('@')) return v.slice(1) === storeId ? '出勤' : (names[v.slice(1)] ?? '他店');
  // 兼務先の表：メインの店で出勤する日（空白・出勤の選択肢）は、メインの店の名前
  if (m.store_id !== storeId && staffState(v, m, storeId, off) === 'away' && !v.startsWith('→')) return names[m.store_id] ?? 'メイン';
  if (!v) return '出勤';
  return cellLabel(v);
}
