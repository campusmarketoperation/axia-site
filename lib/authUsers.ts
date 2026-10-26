// ログインの記録（Supabase Auth）から、最後にログインした日時を取る
import { db } from './supabase/admin';

export async function lastSignIns(userIds: string[]): Promise<Map<string, string | null>> {
  const want = new Set(userIds);
  const out = new Map<string, string | null>();
  if (!want.size) return out;
  for (let page = 1; page <= 20 && out.size < want.size; page++) {
    const { data } = await db().auth.admin.listUsers({ page, perPage: 200 });
    for (const u of data?.users ?? []) if (want.has(u.id)) out.set(u.id, u.last_sign_in_at ?? null);
    if (!data || data.users.length < 200) break;
  }
  return out;
}
