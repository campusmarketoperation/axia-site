import { push, text } from './line';
import { label, parseISO } from './period';
import { db } from './supabase/admin';
import { helpInfo, notifyHelpApproved, notifyHelpRequested } from './notify';
import { confirmedOn } from './confirm';

/**
 * ヘルプの流れ
 *  1. 依頼（本部・ヘルプ先の店長）            → status: pending（まだシフト表には入らない）
 *  2. 所属店の店長が承認                      → status: approved、所属店のシフト表に「漁火5〜」
 *  3. ヘルプ先の店長が入り時間を決める（いつでも変えられる）
 *  本人へのLINEは、承認された時と、入り時間が決まった・変わった時
 */
export async function requestHelpRow(memberId: string, toStoreId: string, date: string, requestedBy: string) {
  const [{ data: m }, { data: to }] = await Promise.all([
    db().from('members').select('id, name, store_id, active, help_stores, stores(company_id, name)').eq('id', memberId).maybeSingle(),
    db().from('stores').select('id, name, company_id').eq('id', toStoreId).maybeSingle(),
  ]);
  const from = (m as any)?.stores;
  if (!m || !m.active || !to || from?.company_id !== to.company_id || m.store_id === to.id) return { ok: false, message: '見つかりません' };
  if (m.help_stores && !m.help_stores.includes(to.id)) return { ok: false, message: `${m.name}さんは、${to.name}へのヘルプはNGにしています` };
  if (await confirmedOn(to.id, date)) return { ok: false, message: `${to.name}のその期間は確定済みです（頼む時は「確定を外す」）` };
  if (await confirmedOn(m.store_id, date)) return { ok: false, message: `${from.name}のその期間は確定済みのため頼めません` };
  const { data: row, error } = await db().from('help_assignments').insert({
    member_id: memberId, from_store: m.store_id, to_store: to.id, date, start_label: '', status: 'pending', requested_by: requestedBy,
  }).select('id').single();
  if (error || !row) return { ok: false, message: 'その日はもうヘルプの依頼があります' };
  await notifyHelpRequested(row.id);
  return { ok: true, message: `${from.name}の店長に、${m.name}さんのヘルプをお願いしました（承認待ち）` };
}

/** 所属店のシフト表のマス：「→漁火 5〜」（表示は「漁火5〜」） */
function lendValue(toName: string, startLabel: string) {
  return `→${toName} ${startLabel}`.trim();
}

/** 本人にLINEで知らせる（承認された時・入り時間が決まった／変わった時） */
async function notify(helpId: string) {
  const { data: h } = await db().from('help_assignments')
    .select('id, date, start_label, notified_label, status, members(name, line_user_id), to:stores!help_assignments_to_store_fkey(name, company_id)')
    .eq('id', helpId).maybeSingle();
  if (!h || h.status !== 'approved') return false;
  const m = (h as any).members, to = (h as any).to;
  if (!m?.line_user_id) return false;
  const changed = h.notified_label !== null && h.notified_label !== undefined;
  const ok = await push(m.line_user_id, [text(
    `【ヘルプ${changed ? 'の時間が決まりました' : 'のお願い'}】\n${label(parseISO(h.date))} ${to.name}\n入り ${h.start_label || '時間はあとで決まります（決まったらお知らせします）'}\n\n都合が悪い時は、店長に連絡してください`,
  )], to.company_id);
  if (ok) await db().from('help_assignments').update({ notified_label: h.start_label ?? '' }).eq('id', helpId);
  return ok;
}

/** 承認（所属店の店長） */
export async function approveHelpRow(helpId: string) {
  const { data: h } = await db().from('help_assignments').select('*, to:stores!help_assignments_to_store_fkey(name)').eq('id', helpId).maybeSingle();
  if (!h || h.status !== 'pending') return { ok: false, message: 'もう処理されています' };
  if (await confirmedOn(h.from_store, h.date) || await confirmedOn(h.to_store, h.date)) return { ok: false, message: 'どちらかの店のその期間が確定済みのため承認できません（「確定を外す」と承認できます）' };
  await db().from('help_assignments').update({ status: 'approved' }).eq('id', helpId);
  await db().from('shifts').upsert({ member_id: h.member_id, date: h.date, value: lendValue((h as any).to?.name ?? '', h.start_label ?? ''), updated_at: new Date().toISOString() });
  const sent = await notify(helpId);
  const hi = await helpInfo(helpId);
  if (hi) await notifyHelpApproved(hi);
  return { ok: true, message: '承認しました' + (sent ? '（本人にLINEで知らせました）' : '（LINE未登録のため、本人に直接伝えてください）') };
}

/** 入り時間を決める（ヘルプ先の店長） */
export async function setHelpTimeRow(helpId: string, startLabel: string) {
  const { data: h } = await db().from('help_assignments').select('*, to:stores!help_assignments_to_store_fkey(name)').eq('id', helpId).maybeSingle();
  if (!h) return { ok: false, message: '見つかりません' };
  if (await confirmedOn(h.to_store, h.date)) return { ok: false, message: 'この期間は確定済みのため変えられません（変える時は「確定を外す」）' };
  await db().from('help_assignments').update({ start_label: startLabel }).eq('id', helpId);
  if (h.status !== 'approved') return { ok: true, message: '入り時間を入れました（承認されたら本人に知らせます）' };
  await db().from('shifts').upsert({ member_id: h.member_id, date: h.date, value: lendValue((h as any).to?.name ?? '', startLabel), updated_at: new Date().toISOString() });
  const sent = startLabel !== (h.notified_label ?? '') ? await notify(helpId) : false;
  return { ok: true, message: '入り時間を決めました' + (sent ? '（本人にLINEで知らせました）' : '') };
}

/** 取り消し・断る（どちらの店からでも）：所属店のマスも元に戻す */
export async function deleteHelpRow(helpId: string) {
  const { data: h } = await db().from('help_assignments').select('*').eq('id', helpId).maybeSingle();
  if (!h) return null;
  await db().from('help_assignments').delete().eq('id', helpId);
  if (h.status === 'approved') await db().from('shifts').delete().eq('member_id', h.member_id).eq('date', h.date).like('value', '→%');
  return h;
}
