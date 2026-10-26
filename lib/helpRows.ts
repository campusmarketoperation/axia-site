// 画面（ブラウザ）からも使うので、サーバー専用のものは import しない
import type { HelpIn } from './data';

/** 他店からのヘルプを、人ごとに1行にまとめる */
export function helpRows(helpIns: HelpIn[]): { memberId: string; memberName: string; fromStore: string; byDate: Record<string, HelpIn> }[] {
  const map = new Map<string, { memberId: string; memberName: string; fromStore: string; byDate: Record<string, HelpIn> }>();
  for (const h of helpIns) {
    const row = map.get(h.memberId) ?? { memberId: h.memberId, memberName: h.memberName, fromStore: h.fromStore, byDate: {} };
    row.byDate[h.date] = h;
    map.set(h.memberId, row);
  }
  return Array.from(map.values());
}
