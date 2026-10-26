// 社員・本部への LINE 通知（ヘルプの依頼・承認・お断り）
import { push, text } from './line';
import { label, parseISO } from './period';
import { db } from './supabase/admin';

const site = () => process.env.NEXT_PUBLIC_SITE_URL || '';

/** アカウントにつないだ LINE（1アカウントに何人でも） */
async function linesOf(profiles: { user_id: string; line_user_id: string | null }[] | null) {
  const ps = profiles ?? [];
  const ids = ps.map(p => p.line_user_id).filter((x): x is string => !!x);
  if (ps.length) {
    const { data } = await db().from('profile_lines').select('line_user_id').in('user_id', ps.map(p => p.user_id));
    ids.push(...(data ?? []).map(l => l.line_user_id as string));
  }
  return ids;
}
/** その店の社員（LINE登録済み）全員＋店長アカウントにつないだ LINE */
async function managerIds(storeId: string) {
  const [{ data }, { data: staff }] = await Promise.all([
    db().from('profiles').select('user_id, line_user_id').or(`store_id.eq.${storeId},extra_store_ids.cs.{${storeId}}`).eq('role', 'manager'),
    db().from('members').select('line_user_id').or(`store_id.eq.${storeId},extra_store_ids.cs.{${storeId}}`).eq('kind', 'staff').eq('active', true).not('line_user_id', 'is', null), // 兼務の社員にも
  ]);
  return [...await linesOf(data), ...(staff ?? []).map(m => m.line_user_id as string)];
}
async function hqIds(companyId: string) {
  const { data } = await db().from('profiles').select('user_id, line_user_id').eq('company_id', companyId).eq('role', 'hq');
  return linesOf(data);
}
async function send(ids: string[], body: string, companyId: string) {
  for (const id of Array.from(new Set(ids))) { try { await push(id, [text(body)], companyId); } catch { /* 通知の失敗で止めない */ } }
}

type HelpInfo = { id: string; date: string; from_store: string; to_store: string; requested_by: string; memberName: string; fromName: string; toName: string; companyId: string };
async function info(helpId: string): Promise<HelpInfo | null> {
  const { data: h } = await db().from('help_assignments')
    .select('id, date, from_store, to_store, requested_by, members(name), from:stores!help_assignments_from_store_fkey(name, company_id), to:stores!help_assignments_to_store_fkey(name)')
    .eq('id', helpId).maybeSingle();
  if (!h) return null;
  const a = h as any;
  return { id: h.id, date: h.date, from_store: h.from_store, to_store: h.to_store, requested_by: h.requested_by ?? '',
    memberName: a.members?.name ?? '', fromName: a.from?.name ?? '', toName: a.to?.name ?? '', companyId: a.from?.company_id ?? '' };
}

/** 依頼が来た → 所属店の店長へ */
export async function notifyHelpRequested(helpId: string) {
  const h = await info(helpId); if (!h) return;
  await send(await managerIds(h.from_store),
    `【ヘルプの依頼】\n${label(parseISO(h.date))}\n${h.memberName}さん → ${h.toName}\n依頼：${h.requested_by || h.toName}\n\n承認・お断りはこちら\n${site()}/store/${h.from_store}/help`, h.companyId);
}

/** 承認された → ヘルプ先の店長（本部が頼んだ時は本部も）へ */
export async function notifyHelpApproved(h: HelpInfo) {
  const ids = [...await managerIds(h.to_store), ...(h.requested_by === '本部' ? await hqIds(h.companyId) : [])];
  await send(ids, `【ヘルプ承認】\n${label(parseISO(h.date))}\n${h.memberName}さん（${h.fromName}）が ${h.toName} にヘルプに来ます。\n\n入り時間を決めてください（シフト表の「他店からのヘルプ」）\n${site()}/store/${h.to_store}`, h.companyId);
}

/** 断られた → ヘルプ先の店長（本部が頼んだ時は本部も）へ */
export async function notifyHelpDeclined(h: HelpInfo) {
  const ids = [...await managerIds(h.to_store), ...(h.requested_by === '本部' ? await hqIds(h.companyId) : [])];
  await send(ids, `【ヘルプお断り】\n${label(parseISO(h.date))}\n${h.memberName}さん（${h.fromName}）の ${h.toName} へのヘルプは、${h.fromName}の店長がお断りしました。`, h.companyId);
}

export { info as helpInfo };
