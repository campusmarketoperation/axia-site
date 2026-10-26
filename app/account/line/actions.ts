'use server';
import { revalidatePath } from 'next/cache';
import { requireViewer } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';

/** LINE 通知をつなぐコードを作る（LINEで「通知 123456」と送る） */
export async function createLineLinkCode() {
  const v = await requireViewer();
  const { data: p } = await db().from('profiles').select('user_id').eq('user_id', v.userId).maybeSingle();
  if (!p) return { ok: false, message: '店長・本部のアカウントだけ使えます' };
  for (let i = 0; i < 5; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { data: dup } = await db().from('profiles').select('user_id').eq('line_link_code', code).maybeSingle();
    if (dup) continue;
    await db().from('profiles').update({ line_link_code: code }).eq('user_id', v.userId);
    return { ok: true, code };
  }
  return { ok: false, message: 'もう一度押してください' };
}

/** LINE を1人分外す */
export async function unlinkMyLine(lineUserId: string) {
  const v = await requireViewer();
  await db().from('profile_lines').delete().eq('user_id', v.userId).eq('line_user_id', lineUserId);
  await db().from('profiles').update({ line_user_id: null }).eq('user_id', v.userId).eq('line_user_id', lineUserId);
  revalidatePath('/', 'layout');
  return { ok: true };
}
