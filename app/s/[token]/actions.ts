'use server';
import { headers } from 'next/headers';
import { companyActive, splitOf, storeByToken } from '@/lib/data';
import { iso, isPeriodStart, parseISO, periodDays } from '@/lib/period';
import { getMine, isLocked, saveRequests, type DayVal } from '@/lib/requests';
import { db } from '@/lib/supabase/admin';

async function storeOf(token: string) {
  const s = await storeByToken(token);
  if (!s || !(await companyActive(s.company_id))) throw new Error('この提出画面は使えません');
  return s;
}

const pinOk = (m: { pin?: string | null } | null, pin: string) => !!m && String(m.pin ?? '') === String(pin ?? '').trim();

// ---- バイト番号の総当たり対策：15分のうちに、同じ端末から10回・店全体で60回まちがえたら止める ----
const LOCK_MSG = 'バイト番号を何度もまちがえたため、しばらく入れられません。15分ほど待つか、店長に番号を聞いてください';
function clientIp() {
  const h = headers();
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || '';
}
async function pinLocked(storeId: string): Promise<boolean> {
  const since = new Date(Date.now() - 15 * 60e3).toISOString();
  const ip = clientIp();
  const [mine, all] = await Promise.all([
    db().from('pin_attempts').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('ip', ip).gte('created_at', since),
    db().from('pin_attempts').select('id', { count: 'exact', head: true }).eq('store_id', storeId).gte('created_at', since),
  ]);
  return (mine.count ?? 0) >= 10 || (all.count ?? 0) >= 60;
}
async function pinFailed(storeId: string) {
  await db().from('pin_attempts').insert({ store_id: storeId, ip: clientIp() });
  await new Promise(r => setTimeout(r, 800));
}
const PIN_NG = 'バイト番号がちがいます。わからない時は店長に聞くか、LINEで「番号」と送ってください';

/** バイト番号から本人を探す（見つからなければ null） */
export async function whoByPin(token: string, pin: string): Promise<{ id: string; name: string } | { locked: true } | null> {
  const s = await storeOf(token);
  const p = String(pin ?? '').trim();
  if (!/^\d{4}$/.test(p)) return null;
  if (await pinLocked(s.id)) return { locked: true };
  const { data } = await db().from('members').select('id, name').eq('store_id', s.id).eq('kind', 'part').eq('active', true).eq('pin', p).limit(1);
  if (!data?.length) { await pinFailed(s.id); return null; }
  return { id: data[0].id, name: data[0].name };
}

export async function loadMine(token: string, memberId: string, pin: string, periodKey: string) {
  const s = await storeOf(token);
  const { data: m } = await db().from('members').select('store_id, help_stores, pin').eq('id', memberId).maybeSingle();
  if (!m || m.store_id !== s.id) return null;
  if (await pinLocked(s.id)) return { pinNg: true as const };
  if (!pinOk(m, pin)) { await pinFailed(s.id); return { pinNg: true as const }; }
  const r = await getMine(memberId, periodKey, splitOf(s));
  // その期間にまだ答えていなければ、店長が「行ける店」を決めている人はヘルプOKを最初からチェック
  const helpOk = r.helpAnswered ? r.helpOk : Array.isArray(m.help_stores) && m.help_stores.length > 0;
  return { ...r, helpOk, sent: r.any || r.helpAnswered };
}

export async function periodStatus(token: string, periodKey: string) {
  const s = await storeOf(token);
  return { locked: await isLocked(s.id, periodKey) };
}

export async function submitShift(token: string, input: { memberId?: string; pin?: string; newName?: string; periodKey: string; days: Record<string, DayVal>; helpOk?: boolean }) {
  const s = await storeOf(token);
  const split = splitOf(s);
  if (!isPeriodStart(parseISO(input.periodKey), split)) return { ok: false, message: '期間がおかしいです。画面を読み込み直してください' };
  const need = periodDays(parseISO(input.periodKey), split).map(iso);
  // 中身の形をそろえる（○ か ✖、時間は短い文字だけ）
  const days: Record<string, DayVal> = {};
  for (const d of need) {
    const v = (input.days ?? {})[d] as any;
    if (!v) continue;
    if (v.s === 'ng') days[d] = { s: 'ng' };
    else if (v.s === 'ok') days[d] = { s: 'ok', st: typeof v.st === 'string' && v.st.trim() ? v.st.trim().slice(0, 20) : null };
  }
  input = { ...input, days };
  if (need.some(d => !input.days[d])) return { ok: false, message: '空白の日があります。全部の日に○か✖をつけてください' };
  if (await isLocked(s.id, input.periodKey)) return { ok: false, message: 'この期間は締め切り済みのため変更できません。店長に直接連絡してください' };

  let memberId = input.memberId;
  let newPin: string | null = null;
  if (memberId) {
    const { data: m } = await db().from('members').select('store_id, active, pin').eq('id', memberId).maybeSingle();
    if (!m || m.store_id !== s.id || !m.active) return { ok: false, message: '名前を選び直してください' };
    if (await pinLocked(s.id)) return { ok: false, message: LOCK_MSG };
    if (!pinOk(m, input.pin ?? '')) { await pinFailed(s.id); return { ok: false, message: PIN_NG }; }
  } else {
    const name = (input.newName ?? '').trim();
    if (!name || name.length > 20) return { ok: false, message: '名前を入れてください' };
    // 同じ名前の人がもういる時は、その人の番号がないと出せない（なりすまし防止）
    const { data: same } = await db().from('members').select('id').eq('store_id', s.id).eq('name', name).eq('active', true).maybeSingle();
    if (same) return { ok: false, message: 'その名前の人はもう登録されています。バイト番号を入れて出してください（わからない時は店長に聞くか、LINEで「番号」と送ってください）' };
    // いたずらで大量に人を作られないよう、提出画面から増やせるのは1日20人まで
    const { count: recent } = await db().from('members').select('id', { count: 'exact', head: true }).eq('store_id', s.id).gte('created_at', new Date(Date.now() - 86400e3).toISOString());
    if ((recent ?? 0) >= 20) return { ok: false, message: '今日は新しい人をこれ以上追加できません。店長に連絡してください' };
    const { data: last } = await db().from('members').select('sort').eq('store_id', s.id).order('sort', { ascending: false }).limit(1).maybeSingle();
    const { data: created } = await db().from('members').insert({ store_id: s.id, name, kind: 'part', sort: (last?.sort ?? 0) + 1 }).select('id, pin').single();
    memberId = created!.id;
    newPin = created!.pin;
  }
  await saveRequests(memberId!, input.periodKey, split, input.days, { replace: true, source: '提出画面' } /* ヘルプOKは提出画面では聞かない（店長がヘルプのページで決める） */);
  return {
    ok: true, memberId, pin: newPin,
    message: newPin ? `送信しました。あなたのバイト番号は「${newPin}」です。次からは提出画面で最初にこの番号を入れてください` : '送信しました。直したら再送信すれば上書きされます',
  };
}
