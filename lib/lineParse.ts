// LINEのメッセージを読む（GAS版の line.gs をそのまま移植）
import { iso, nextStartOf, parseISO, periodDays, periodStartOf, todayJST, utc, type Split } from './period';

export type Val = { s: 'ok'; st: string | null } | { s: 'ng' } | null; // null＝消す
export type Parsed = {
  target: string;
  changes: Record<string, Record<string, Val>>;   // 期間 → 日付 → 値
  helpSet: Record<string, boolean>;
  fillRest: Record<string, boolean>;
  listStyle: Record<string, boolean>;
  okList: Record<string, boolean>; // 「28日17時から」を2行以上並べただけ（✖なし）→ 初めての提出なら、書いてない日は✖にする
  errors: string[];
};

export function norm(s: string): string {
  return String(s)
    .replace(/[０-９ａ-ｚＡ-Ｚ：／]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\uFE0E\uFE0F]/g, '')                       // 絵文字の見た目の指定（✖️ の「️」）を外す
    .replace(/[✖✕✗✘❌❎╳×ｘＸ]/g, '✖')                      // バツの書き方をそろえる
    .replace(/[⭕〇◯◎]/g, '○')                              // マルの書き方をそろえる
    .replace(/[🙆👌👍🆗]/gu, '○').replace(/[🙅🚫]/gu, '✖')   // 絵文字のマル・バツ
    .replace(/\p{Extended_Pictographic}/gu, c => (c === '✖' ? c : ''))   // そのほかの絵文字は外す
    .replace(/[♪☆★♡♥]/g, '')
    .replace(/(^|[^\d:.])(\d{1,2})[.．](\d{1,2})(?![\d:.．])/g, (m, p, a, b) => (+a >= 1 && +a <= 12 ? `${p}${a}/${b}` : m))   // 「11.5」→「11/5」
    .replace(/[〜～]/g, '〜').replace(/\r/g, '').trim();
}

/** 「です」「でお願いします」などを外す */
export function clean(l: string): string {
  let s = l.trim(), prev;
  do {
    prev = s;
    s = s.replace(/[。．.！!]+$/, '')
      .replace(/(よろしくお願いします|よろしくお願いいたします|よろしくです|よろしく|でお願いします|お願いします|お願いしま[すー〜]*|でお願い|でいいです|がいいです|いいです|でもいい|でいい|でも大丈夫です|でも大丈夫|大丈夫です|いけます|行けます|入れます|出れます|出られます|出勤できます|出勤可能|可能です|できます|希望します|希望です|です|でした|かな|かも|[wｗ]+)$/, '')
      .trim();
  } while (s !== prev);
  return s;
}

/** 値：○ → 何時でも、✖ → 無理、5 / 4:30 / 17時 → 入り時間、消す → null、読めない → undefined */
// 店の入り時間の範囲（時）。「11」がお昼の11時か夜の23時かを決めるのに使う
let RANGE: [number, number] | null = null;
function pickHour(h: number): number {
  if (h >= 12) return h;
  if (RANGE) { const hit = [h, h + 12].find(x => x >= RANGE![0] && x <= RANGE![1]); if (hit !== undefined) return hit; }
  return h + 12; // 5 → 17時（紙と同じ書き方）
}

export function parseValue(raw: string): Val | undefined {
  let v = clean(String(raw || '')).replace(/^(は|が|も|の|→|⇒|=)\s*/, '').trim();
  // 「17-22」「17:00〜22:00」「5時からラストまで」→ 入り時間だけ使う
  v = v.replace(/\s*(?:[-〜~ー－]|から)\s*(?:\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分?)?)?|ラスト|ラス|L|l|閉店|締め|クローズ|最後|終わり)\s*(?:まで)?$/, '');
  let prev;
  do { prev = v; v = v.replace(/(希望|入り|以降|以後|から入れる|から出れる|から可能|から|より|〜|~|-|ー|ok|OK|Ok|おk|(?<!不)可|で)$/, '').trim(); } while (v !== prev && v);
  v = v.replace(/^(午後|pm|PM|ｐｍ|夜)\s*/, '').trim();
  if (/^(✖|x|X|無理|むり|休|休み|やすみ|お休み|休みで|休希望|ng|NG|ばつ|バツ|だめ|ダメ|不可|なし|出れない|出れません|出られない|出られません|入れない|入れません|いけない|いけません|行けない|行けません|用事|予定あり|欠|×)$/.test(v)) return { s: 'ng' };
  if (v === '' || /^(○|o|O|ok|OK|Ok|おk|オッケー|オーケー|おけ|可|いける|行ける|出れる|出られる|入れる|何時でも|いつでも|何時からでも|何時でもok|何時でもOK|フル|終日|一日中|1日中|全然いける|大丈夫|どこでも)$/.test(v)) return { s: 'ok', st: null };
  if (/^(消す|けす|空白|未定|-)$/.test(v)) return null;
  let m = v.match(/^(\d{1,2})(?:[:時]?(\d{2}|半))?[時分]?$/) || v.match(/^(\d{2})(\d{2})$/);
  if (!m) return undefined;
  const h = pickHour(+m[1]);
  const min = m[2] === '半' ? 30 : m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return undefined;
  return { s: 'ok', st: `${h}:${String(min).padStart(2, '0')}` };
}

const DATE = '(?:\\d{1,2}\\/)?\\d{1,2}';
/**
 * 1行を、読める形にそろえる（いろいろな書き方に対応）。1行に何日分も書いてあれば分ける
 *  ・26 / 10/26 / 10月26日 / 26日(月) / 26日の / 26日→ / 26日：
 *  ・26-28 / 26日から28日まで → 26〜28
 *  ・26.27.28 / 26と27 / 26 27 28 → 26,27,28
 *  ・26○ 27✖ 28 5時 / 26日 5時 27日 6時 → 1日ずつに分ける
 */
export function canon(line0: string): string[] {
  let l = line0.trim();
  l = l.replace(/^[・\-－*＊●■◆▪▶►→]\s*(?=\d)/, '');                             // 箇条書きの記号
  l = l.replace(/[(（]\s*[月火水木金土日祝][曜日]*\s*[)）]/g, ' ').replace(/\s+/g, ' ').trim(); // 曜日のかっこ
  l = l.replace(/(\d{1,2})月(\d{1,2})日?/g, '$1/$2');                                     // 10月26日 → 10/26
  l = l.replace(new RegExp(`^(${DATE})(?:日\\s*[:：]|日?\\s*(?:の|→|⇒|=|ー>|->))\\s*`), '$1 ');   // 26日の 5時 / 26→5 / 26日：5時
  l = l.replace(new RegExp(`^(${DATE})日?\\s*[-ー－]\\s*(${DATE})日?(?:まで)?(?=\\s|$|[^\\d:])`), '$1〜$2 ').trim(); // 26-28
  l = l.replace(new RegExp(`^(${DATE})日\\s*から\\s*(${DATE})日(?:まで)?`), '$1〜$2 ').replace(/\s+/g, ' ').trim(); // 26日から28日まで
  // 26.27.28 / 26と27と28 / 26/27/28（26は月ではない）
  l = l.replace(/^(\d{1,2}(?:\s*[.．と]\s*\d{1,2})+)(?=\s|$|日|[はがも])/, x => x.replace(/\s*[.．と]\s*/g, ','));
  l = l.replace(/^(\d{1,2}(?:\/\d{1,2})+)(?=\s|$|日|[はがも])/, x => { const ns = x.split('/').map(Number); return ns[0] > 12 || ns.length > 2 ? ns.join(',') : x; });
  // 「26 27 28」「26 27 28 ○」（数字だけが3つ以上、または2つ目が時間にならない）
  const tk = l.split(' ');
  const lead = tk.findIndex(t => !/^\d{1,2}日?$/.test(t));
  const nums = lead < 0 ? tk.length : lead;
  if (nums >= 3 || (nums === 2 && +tk[1].replace('日', '') > 23)) l = [tk.slice(0, nums).join(','), ...tk.slice(nums)].join(' ');
  // 「26日 5時 27日 6時」→ 日付ごとに分ける
  const byDay = l.split(new RegExp(`\\s+(?=${DATE}日)`));
  if (byDay.length >= 2 && byDay.every(x => new RegExp(`^${DATE}日`).test(x))) return byDay;
  // 「26○ 27✖ 28 5時」→ 1日ずつに分ける
  const parts = l.split(/[\s、，,]+/).filter(Boolean);
  const isDateVal = (x: string) => { const m = x.match(new RegExp(`^${DATE}日?(\\D.*)$`)); return !!m && !/^[\/〜~]/.test(m[1]) && parseValue(m[1]) !== undefined; };
  const isDate = (x: string) => new RegExp(`^${DATE}日?$`).test(x);
  const segs: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (isDateVal(parts[i])) segs.push(parts[i]);
    else if (isDate(parts[i]) && i + 1 < parts.length && !isDate(parts[i + 1]) && !isDateVal(parts[i + 1]) && parseValue(parts[i + 1]) !== undefined) { segs.push(`${parts[i]} ${parts[i + 1]}`); i++; }
    else { segs.length = 0; break; }
  }
  if (segs.length >= 2) return segs;
  return [l];
}

function toDate(mon: string | number | null | undefined, day: number, key: string, split: Split): Date | null {
  if (!mon) {
    const hit = periodDays(parseISO(key), split).find(d => d.getUTCDate() === day);
    return hit ?? null;
  }
  const m = +mon, today = todayJST();
  let d = utc(today.getUTCFullYear(), m - 1, day);
  if (d.getTime() - today.getTime() < -60 * 864e5) d = utc(today.getUTCFullYear() + 1, m - 1, day);
  return d.getUTCMonth() === m - 1 ? d : null;
}

function parseLine(line: string, key: string, split: Split): { dates: Date[]; value: Val; empty: boolean } | null {
  let m = line.match(/^(?:(\d{1,2})[\/月])?(\d{1,2})日?\s*[〜~]\s*(?:(\d{1,2})[\/月])?(\d{1,2})日?\s*(.*)$/);
  if (m && m[5] !== undefined && /\S/.test(m[5])) {
    const a = toDate(m[1], +m[2], key, split), b = toDate(m[3], +m[4], key, split);
    const v = parseValue(m[5]);
    if (!a || !b || v === undefined || b < a) return null;
    const dates: Date[] = [];
    for (let d = a; d <= b; d = utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)) dates.push(d);
    if (dates.length > 31) return null;
    return { dates, value: v, empty: false };
  }
  m = line.match(/^(?:(\d{1,2})[\/月])?(\d{1,2})日?\s*(?:[(（][^)）]*[)）])?\s*(.*)$/);
  if (!m) return null;
  const d = toDate(m[1], +m[2], key, split);
  const v = parseValue(m[3]);
  if (!d || v === undefined) return null;
  return { dates: [d], value: v, empty: !/\S/.test(m[3]) };
}


// 曜日ごとの入り時間：「平日は6時から、金土日は何時からでも」「土日は5時」「それ以外は○」
const WD_CH = '日月火水木金土';
type Rule = { days: number[] | 'other'; val: Exclude<Val, null> };
function daysOf(spec: string): number[] | 'other' | null {
  const s = spec.replace(/曜日?/g, '').replace(/^毎週/, '').replace(/[\sと]/g, '');
  if (/^(それ以外|その他|他|ほか|残り|あと)$/.test(s)) return 'other';
  if (s === '平日') return [1, 2, 3, 4, 5];
  if (/^(週末|土日祝?)$/.test(s)) return [0, 6];
  if (!/^[月火水木金土日・,、〜~]+$/.test(s)) return null;
  const out = new Set<number>();
  const r = s.match(/^([月火水木金土日])[〜~]([月火水木金土日])$/);
  if (r) {
    // 月〜木 のような範囲（月曜はじまり）
    const order = [1, 2, 3, 4, 5, 6, 0];
    const a = order.indexOf(WD_CH.indexOf(r[1])), b = order.indexOf(WD_CH.indexOf(r[2]));
    if (a < 0 || b < 0 || b < a) return null;
    order.slice(a, b + 1).forEach(d => out.add(d));
  } else {
    for (const ch of s.replace(/[・,、]/g, '')) { const i = WD_CH.indexOf(ch); if (i < 0) return null; out.add(i); }
  }
  return out.size ? Array.from(out) : null;
}
function ruleValue(raw: string): Exclude<Val, null> | undefined {
  const v = raw.replace(/(で|の)$/, '').replace(/^(は|が|も)\s*/, '').trim();
  if (/^(何時|いつ)(から)?(でも)?(ok|OK|大丈夫)?$/.test(v)) return { s: 'ok', st: null };
  const p = parseValue(v);
  return p ?? undefined;
}
export function parseRuleLine(line: string): Rule[] | null {
  line = line.replace(/^毎週\s*/, '').replace(/([月火水木金土日])曜?日?と(?=[月火水木金土日])/g, '$1');
  if (!/^(平日|週末|土日|それ以外|その他|他|ほか|残り|あと|[月火水木金土日])/.test(line)) return null;
  const SPEC = /^(平日|週末|土日|それ以外|その他|他|ほか|残り|あと|[月火水木金土日])/;
  // 区切り（、 , 。 空白）で分ける。曜日で始まらないかけらは前にくっつける（「平日は 6時から」）
  const parts: string[] = [];
  line.split(/[、，,。\s]+/).filter(Boolean).forEach(x => {
    if (SPEC.test(x) || !parts.length) parts.push(x); else parts[parts.length - 1] += x;
  });
  const rules: Rule[] = [];
  let carry: number[] = [];
  for (const part of parts) {
    const m = part.match(/^(平日|週末|土日祝?|それ以外|その他|他|ほか|残り|あと|[月火水木金土日・〜~曜]+)(?:は|が|も)?(.*)$/);
    if (!m) return null;
    const d = daysOf(m[1]);
    if (!d) return null;
    if (!m[2]) { if (d === 'other') return null; carry = carry.concat(d); continue; } // 「金、土、日は…」の「金」「土」
    const v = ruleValue(m[2]);
    if (!v) return null;
    rules.push({ days: d === 'other' ? 'other' : carry.concat(d), val: v });
    carry = [];
  }
  return rules.length && !carry.length ? rules : null;
}

const LIST_RE = /^((?:\d{1,2}[\/月])?\d{1,2}日?(?:\s*[,，、・]\s*(?:\d{1,2}[\/月])?\d{1,2}日?)+)\s*(?:日)?(?:は|が|も)?\s*(.*)$/;
function splitDays(s: string) {
  return s.split(/\s*[,，、・]\s*/).map(t => {
    const m = t.match(/^(?:(\d{1,2})[\/月])?(\d{1,2})日?$/);
    return m ? { mon: m[1] ? +m[1] : null, day: +m[2] } : null;
  }).filter((x): x is { mon: number | null; day: number } => !!x);
}

export function parseMessage(text: string, split: Split, lastKey?: string | null, opts?: { from?: string; to?: string }): Parsed {
  const hh = (t?: string) => (t && /^\d{1,2}/.test(t) ? parseInt(t, 10) : NaN);
  RANGE = !isNaN(hh(opts?.from)) && !isNaN(hh(opts?.to)) ? [hh(opts!.from), hh(opts!.to)] : null;
  try { return parseMessageIn(text, split, lastKey); } finally { RANGE = null; }
}

function parseMessageIn(text: string, split: Split, lastKey?: string | null): Parsed {
  const today = todayJST();
  const next = iso(nextStartOf(periodStartOf(today, split), split));
  const after = iso(nextStartOf(parseISO(next), split));
  const lines = text.split('\n').map(clean).filter(Boolean).flatMap(l => canon(l)).map(clean).filter(Boolean);

  const bare: number[] = [];
  lines.forEach(l => {
    const lm = l.match(LIST_RE);
    if (lm) { splitDays(lm[1]).forEach(x => { if (!x.mon) bare.push(x.day); }); return; }
    const m = l.match(/^(\d{1,2})日?(?=\s|$|[(（はがも〜~以]|\D)/);
    if (m) bare.push(+m[1]);
  });
  const target = [next, after].find(k => bare.every(d => periodDays(parseISO(k), split).some(x => x.getUTCDate() === d))) || next;
  const helpKey = bare.length ? target : (lastKey && lastKey >= next ? lastKey : target);

  const res: Parsed = { target, changes: {}, helpSet: {}, fillRest: {}, listStyle: {}, okList: {}, errors: [] };
  const keyOf = (d: Date) => iso(periodStartOf(d, split));
  const pending: [string, string][] = [];
  const singles: Date[] = [];
  const okLines: Date[] = [];
  let ngSeen = false;
  let global: Val | undefined;
  const rules: Rule[] = [];
  const put = (d: Date, v: Val, empty: boolean) => {
    const k = keyOf(d);
    (res.changes[k] = res.changes[k] || {})[iso(d)] = v;
    if (empty) pending.push([k, iso(d)]);
  };

  lines.forEach(line => {
    if (/^ヘルプ\s*(ok|おk|可|いける|行ける|○)$/i.test(line)) { res.helpSet[helpKey] = true; return; }
    if (/^ヘルプ\s*(ng|不可|無理|✖|×|x)$/i.test(line)) { res.helpSet[helpKey] = false; return; }
    if (/^(残り|あと|ほか|他|その他)(全部|ぜんぶ)?\s*(は|も)?\s*(✖|x|無理|休み?|やすみ)$/i.test(line)) { res.fillRest[target] = true; return; }
    // 「全部✖」「全部○」「毎日5時から」：その期間を全部
    const all = line.match(/^(全部|ぜんぶ|全日|全て|すべて|全期間|毎日|いつでも|どの日も)\s*(?:は|も)?\s*(.*)$/);
    if (all) {
      const v = all[2] ? parseValue(all[2]) : { s: 'ok' as const, st: null };
      if (v !== undefined && v !== null) { periodDays(parseISO(target), split).forEach(d => put(d, v, false)); return; }
    }
    // 「26以外○」「26,28日以外は5時から」：書いた日は✖、それ以外は全部その値
    const ex = line.match(new RegExp(`^((?:${DATE}日?[,、・]?)+)\\s*(?:日)?以外(?:は|全部|ぜんぶ|の日)*\\s*(.*)$`));
    if (ex) {
      const v = ex[2] ? parseValue(ex[2]) : { s: 'ok' as const, st: null };
      if (v) {
        const no = new Set(splitDays(ex[1].replace(/日/g, '').replace(/[,、・]$/, '')).map(x => toDate(x.mon, x.day, target, split)).filter(Boolean).map(d => iso(d!)));
        periodDays(parseISO(target), split).forEach(d => put(d, no.has(iso(d)) ? { s: 'ng' } : v, false));
        return;
      }
    }
    // 「平日のみ」「土日だけ5時から」：その曜日だけ、ほかは✖
    const only = line.match(/^(平日|土日|週末|[月火水木金土日・と]+曜?日?)(?:の)?(?:のみ|だけ)\s*(?:は|で)?\s*(.*)$/);
    if (only) {
      const rl2 = parseRuleLine(`${only[1]}は${only[2] || '○'}、それ以外は✖`);
      if (rl2) { rules.push(...rl2); return; }
    }

    const rl = parseRuleLine(line);
    if (rl) { rules.push(...rl); return; }

    const g = line.match(/^(?:入り)?(?:時間)(?:は|も)?\s*(.*)$/) || line.match(/^(\d{1,2}(?::\d{2}|時半?|時\d{2}分?)?\s*から)$/) || line.match(/^(何時でも|いつでも|何時からでも)$/);
    if (g) { const v = parseValue(g[1]); if (v) { global = v; return; } }

    const lm = line.match(LIST_RE);
    if (lm) {
      const v = lm[2] ? parseValue(lm[2]) : null;
      if (lm[2] && v === undefined) { res.errors.push(line); return; }
      splitDays(lm[1]).forEach(x => {
        const d = toDate(x.mon, x.day, target, split);
        if (!d) { res.errors.push(`${x.mon ? x.mon + '/' : ''}${x.day}`); return; }
        put(d, v || { s: 'ok', st: null }, !lm[2]);
        if (!v || v.s === 'ok') { res.listStyle[keyOf(d)] = true; res.fillRest[keyOf(d)] = true; } else ngSeen = true;
      });
      return;
    }

    const r = parseLine(line, target, split);
    // 数字のない行（あいさつ・名前など）は、読めなくても気にしない
    if (!r) { if (/\d/.test(line)) res.errors.push(line); return; }
    r.dates.forEach(d => put(d, r.value, r.empty));
    if (r.empty && r.dates.length === 1) singles.push(r.dates[0]);
    else if (r.value?.s === 'ok') okLines.push(...r.dates);
    else if (r.value?.s === 'ng') ngSeen = true;
  });

  // 曜日のルールだけが送られた時（「土日休み」「平日は6時から、土日は無理」）は、期間の全部の日に当てはめる
  if (rules.length && !global && !Object.keys(res.changes).length && !Object.keys(res.fillRest).length) {
    periodDays(parseISO(target), split).forEach(d => {
      const wd = d.getUTCDay();
      const hit = rules.filter(r => r.days !== 'other' && r.days.includes(wd))
        .sort((x, y) => (x.days as number[]).length - (y.days as number[]).length)[0] ?? rules.find(r => r.days === 'other');
      if (hit) put(d, hit.val, false);
    });
  }
  if (singles.length >= 2) singles.forEach(d => { const k = keyOf(d); res.listStyle[k] = true; res.fillRest[k] = true; });
  if (!ngSeen && !rules.length && !global && okLines.length + singles.length >= 2 && !Object.keys(res.fillRest).length) [...okLines, ...singles].forEach(d => { res.okList[keyOf(d)] = true; });
  // 時間の書いてない日：曜日のルール → 「時間は…」の順に当てはめる
  if (global || rules.length) pending.forEach(([k, i]) => {
    const c = res.changes[k][i];
    if (!c || c.s !== 'ok') return;
    const wd = parseISO(i).getUTCDay();
    // 当てはまる中で、いちばん狭いルール（「平日」より「金土日」）を使う
    const hit = rules.filter(r => r.days !== 'other' && r.days.includes(wd))
      .sort((x, y) => (x.days as number[]).length - (y.days as number[]).length)[0] ?? rules.find(r => r.days === 'other');
    if (hit) res.changes[k][i] = hit.val;
    else if (global) res.changes[k][i] = global as Val;
  });
  return res;
}

/** ヘルプの質問への「はい」「いいえ」 */
export function yesNo(text: string): 'yes' | 'no' | null {
  const a = text.replace(/[。．.！!、\s]+$/, '').replace(/(です|でお願いします|お願いします)$/, '');
  if (/^(はい|うん|ええ|行ける|いける|行けます|いけます|ok|おk|大丈夫|いい|いいよ|可|○)$/i.test(a)) return 'yes';
  if (/^(いいえ|いや|行けない|いけない|行けません|いけません|無理|むり|ng|だめ|ダメ|不可|✖)$/i.test(a)) return 'no';
  return null;
}
