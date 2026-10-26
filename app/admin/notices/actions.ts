'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';

const day = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export async function saveNotice(input: { id?: string; body: string; level: 'info' | 'warn'; starts: string; ends: string; active: boolean }) {
  await requireAdmin();
  const body = input.body.trim().slice(0, 300);
  if (!body) return { ok: false, message: 'お知らせの文を入れてください' };
  const row = { body, level: input.level === 'warn' ? 'warn' : 'info', starts_on: day(input.starts), ends_on: day(input.ends), active: input.active };
  const { error } = input.id ? await db().from('announcements').update(row).eq('id', input.id) : await db().from('announcements').insert(row);
  if (error) return { ok: false, message: '保存できませんでした（Supabase で 029 の SQL を実行したか確認してください）' };
  revalidatePath('/', 'layout');
  return { ok: true, message: '保存しました' };
}

export async function deleteNotice(id: string) {
  await requireAdmin();
  await db().from('announcements').delete().eq('id', id);
  revalidatePath('/', 'layout');
  return { ok: true };
}
