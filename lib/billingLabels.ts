// 支払いの状態の表示（運営・本部の画面で共通）
export const SUB_LABEL: Record<string, [string, string]> = {
  none: ['未申し込み', 'wait'],
  trialing: ['お試し中（申し込み済み）', 'ok'],
  active: ['支払い中', 'ok'],
  past_due: ['支払いが遅れています', 'stop'],
  unpaid: ['未払い', 'stop'],
  canceled: ['解約済み', 'stop'],
  incomplete: ['手続き途中', 'wait'],
  incomplete_expired: ['手続き切れ', 'stop'],
  paused: ['一時停止', 'wait'],
};
export const INV_LABEL: Record<string, string> = {
  draft: '作成中', open: '支払い待ち', paid: '支払い済み', void: '取り消し', uncollectible: '回収不能',
};
export function yen(n: number | null | undefined) { return n == null ? '' : `${n.toLocaleString()}円`; }
export function ymd(s: string | null | undefined) {
  if (!s) return '';
  const d = new Date(s);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
export function overdue(status: string | null | undefined, due: string | null | undefined) {
  return status === 'open' && !!due && new Date(due).getTime() < Date.now();
}
