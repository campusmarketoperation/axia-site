// 会社が止まっているか：状態が「停止中」か、停止予定日を過ぎたか（日本時間）
export function todayIsoJST() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
export function isStopped(c: { status?: string | null; stop_on?: string | null } | null | undefined) {
  if (!c) return true;
  return c.status === 'stopped' || (!!c.stop_on && c.stop_on <= todayIsoJST());
}
