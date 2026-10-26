// 店長・本部アカウントにつないだ LINE（サーバーだけで使う）
import { db } from './supabase/admin';

/** つないでいる LINE（今までの1人分も含む） */
export async function myLines(userId: string) {
  const [{ data: p }, { data: ls }] = await Promise.all([
    db().from('profiles').select('line_user_id').eq('user_id', userId).maybeSingle(),
    db().from('profile_lines').select('line_user_id, name').eq('user_id', userId).order('created_at'),
  ]);
  const out = (ls ?? []).map(l => ({ id: l.line_user_id as string, name: (l.name as string | null) ?? '' }));
  if (p?.line_user_id && !out.some(l => l.id === p.line_user_id)) out.unshift({ id: p.line_user_id, name: '' });
  return out;
}
