import { lineupOf } from './todayBoard';
// LINEで送る文面（店長画面の送信ボタンとLINEボットで共通）
import type { Grid } from './data';
import { isWorkingPart, staffOffOptions, staffState } from './shift';

export function shiftText(g: Grid, memberId: string): string | null {
  const row = g.parts.find(r => r.member.id === memberId) || g.staff.find(r => r.member.id === memberId);
  if (!row) return null;
  const off = staffOffOptions(g.store);
  const isStaff = row.member.kind === 'staff';
  const work: string[] = [];
  row.cells.forEach((c, i) => {
    const d = g.days[i];
    const day = `${d.md}(${d.wd})`;
    if (isStaff) {
      // かけもちの社員：ほかの店で出勤する日は店の名前をつける
      const st = staffState(c.value, row.member, g.store.id, off);
      if (st === 'work') work.push(`${day}　${c.value && !c.value.startsWith('@') ? c.value : '出勤'}`);
      else if (c.value.startsWith('@')) work.push(`${day}　${g.storeNames[c.value.slice(1)] ?? '他店'}で出勤`);
      else if (st === 'away' && row.guest) return; // 兼務先の表で、メインの店にいる日（メインの表の方で出る）
      return;
    }
    if (c.value.startsWith('→')) work.push(`${day}　ヘルプ ${c.value.slice(1)}`);
    else if (isWorkingPart(c.value)) work.push(`${day}　${c.value || '出勤'}`);
  });
  return [
    `【確定シフト ${g.label}】`,
    `${g.store.name}　${row.member.name}さん`,
    '',
    ...(work.length ? work : ['この期間の出勤はありません']),
    ...(work.length ? ['', `出勤 ${work.length}日`] : []),
    '',
    '変更がある時は店長に直接連絡してください',
  ].join('\n');
}


/** その日のメンバー（「今日の出勤」の画面と同じ並び：入り時間の早い順、ヘルプの人も入れる） */
/**  opts.draft：確定前でも今の中身を出す（社員用）／opts.showStore：店の名前を見出しに入れる（兼務の社員用） */
export function memberText(g: Grid, dayIso: string, opts: { draft?: boolean; showStore?: boolean } = {}): string {
  const l = lineupOf(g, dayIso);
  if (!l) return 'その日のシフトが見つかりません';
  const head = `【${l.md}(${l.wd}) ${opts.showStore ? g.store.name : ''}のメンバー${!g.confirmed && opts.draft ? '（未確定）' : ''}】`;
  if (!g.confirmed && !opts.draft) return `${head}\nまだシフトが確定していません`;
  const who = (p: { name: string; note?: string }) => p.note ? `${p.name}（${p.note}）` : p.name;
  const lines = l.slots.map(s => `${s.time === '時間未定' ? '時間未定' : s.time + '〜'}　${s.people.map(who).join('、')}`);
  const total = l.slots.reduce((a, s) => a + s.people.length, 0);
  return [head,
    ...(l.staff.length ? [`社員　${l.staff.map(who).join('、')}`] : []),
    ...(lines.length ? lines : ['アルバイトの出勤はありません']),
    `アルバイト・ヘルプ ${total}人`,
    ...(!g.confirmed ? ['', '※ まだ確定していません（今の時点の内容です）'] : [])].join('\n');
}
