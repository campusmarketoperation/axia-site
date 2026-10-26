// 全員へのお知らせ（運営が出す）
import { db } from './supabase/admin';

export type Announcement = { id: string; body: string; level: 'info' | 'warn'; starts_on: string | null; ends_on: string | null; active: boolean };

export async function activeAnnouncements(): Promise<Announcement[]> {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const { data, error } = await db().from('announcements').select('*').eq('active', true).order('created_at', { ascending: false });
  if (error) return [];
  return ((data ?? []) as Announcement[]).filter(a => (!a.starts_on || a.starts_on <= today) && (!a.ends_on || a.ends_on >= today));
}
