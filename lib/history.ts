// シフトの変更の履歴：いつ・誰が・どのマスを・何から何に
import type { Viewer } from './auth';
import { db } from './supabase/admin';

export type LogRow = { store_id: string; member_id?: string | null; date?: string | null; kind: 'cell' | 'request' | 'help' | 'lock' | 'confirm'; before?: string | null; after?: string | null; note?: string | null; actor: string };
export type HistoryItem = { id: number; at: string; actor: string; kind: string; memberId: string | null; memberName: string; date: string | null; before: string | null; after: string | null; note: string | null };

/** 記録する（失敗してもシフトの操作は止めない） */
export async function logChange(rows: LogRow[]) {
  const list = rows.filter(r => r.store_id);
  if (!list.length) return;
  try { await db().from('shift_logs').insert(list); } catch (e) { console.error('shift_logs', e); }
}

/** 操作した人の名前：「tanaka（店長）」 */
export async function actorOf(v: Viewer): Promise<string> {
  return `${v.name}（${v.title || '店長'}）`;
}

/** その店の、その日付の範囲の履歴（新しい順） */
export async function loadHistory(storeId: string, from: string, to: string, limit = 300): Promise<HistoryItem[]> {
  const { data } = await db().from('shift_logs').select('id, created_at, actor, kind, member_id, date, before, after, note, members(name)')
    .eq('store_id', storeId).neq('kind', 'request').gte('date', from).lte('date', to).order('created_at', { ascending: false }).limit(limit);
  return (data ?? []).map((r: any) => ({
    id: r.id, at: r.created_at, actor: r.actor, kind: r.kind, memberId: r.member_id, memberName: r.members?.name ?? '',
    date: r.date, before: r.before, after: r.after, note: r.note,
  }));
}

/** ヘルプの記録：所属店とヘルプ先の両方に残す */
export async function logHelp(helpId: string, note: string, actor: string, extra?: { before?: string | null; after?: string | null }) {
  const { data: h } = await db().from('help_assignments').select('member_id, from_store, to_store, date, to:stores!help_assignments_to_store_fkey(name)').eq('id', helpId).maybeSingle();
  if (!h) return;
  const n = `${(h as any).to?.name ?? ''}へのヘルプ：${note}`;
  await logChange([h.from_store, h.to_store].map(sid => ({ store_id: sid, member_id: h.member_id, date: h.date, kind: 'help' as const, note: n, actor, before: extra?.before ?? null, after: extra?.after ?? null })));
}
