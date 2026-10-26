import crypto from 'crypto';
import { db } from './supabase/admin';
import { logEvent } from './events';

export type LineMessage = { type: 'text'; text: string; quickReply?: unknown } | { type: 'image'; originalContentUrl: string; previewImageUrl: string };

export function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const hash = crypto.createHmac('sha256', secret).update(body).digest('base64');
  const a = Buffer.from(hash), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function text(t: string, quick?: [string, string][]): LineMessage {
  const m: LineMessage & { type: 'text' } = { type: 'text', text: t.slice(0, 4900) };
  if (quick) m.quickReply = { items: quick.map(([label, tx]) => ({ type: 'action', action: { type: 'message', label, text: tx } })) };
  return m;
}

async function call(path: string, body: unknown): Promise<{ ok: boolean; status: number; detail: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
  try {
    const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, detail: res.ok ? '' : (await res.text().catch(() => '')).slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, detail: String(e).slice(0, 300) };
  }
}

/** LINE 公式アカウント全体の、今月の送信数と上限（運営画面用）。取れなければ null */
export async function lineQuota(): Promise<{ limit: number | null; used: number } | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const h = { Authorization: `Bearer ${token}` };
    const [q, c] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers: h, cache: 'no-store' }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: h, cache: 'no-store' }),
    ]);
    if (!q.ok || !c.ok) return null;
    const qj = await q.json(), cj = await c.json();
    return { limit: qj.type === 'limited' ? Number(qj.value) : null, used: Number(cj.totalUsage) || 0 };
  } catch { return null; }
}

export async function reply(replyToken: string, messages: LineMessage[], companyId?: string | null) {
  await call('reply', { replyToken, messages: messages.slice(0, 5) });
  await db().from('line_logs').insert({ company_id: companyId ?? null, kind: 'reply' });
}

/** プッシュ送信（LINEの月の通数に数えられる） */
export async function push(to: string, messages: LineMessage[], companyId?: string | null): Promise<boolean> {
  const r = await call('push', { to, messages: messages.slice(0, 5) });
  if (r.ok) await db().from('line_logs').insert({ company_id: companyId ?? null, kind: 'push' });
  else await logEvent('line_push', `LINEを送れませんでした（${r.status}）${r.status === 429 ? '：今月の送信数の上限か、送りすぎです' : ''} ${r.detail}`, companyId);
  return r.ok;
}

export function image(url: string, preview: string): LineMessage {
  return { type: 'image', originalContentUrl: url, previewImageUrl: preview };
}

/** LINE の表示名（取れなければ空） */
export async function lineName(userId: string): Promise<string> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return '';
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return '';
    const j = await res.json();
    return typeof j.displayName === 'string' ? j.displayName : '';
  } catch { return ''; }
}
