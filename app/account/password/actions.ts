'use server';
import { authClient } from '@/lib/supabase/server';

export async function setPassword(password: string, again: string): Promise<{ ok: boolean; message: string }> {
  if (password.length < 8) return { ok: false, message: 'パスワードは8文字以上にしてください' };
  if (password !== again) return { ok: false, message: '2回入れたパスワードが違います' };
  const sb = authClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return { ok: false, message: 'ログインし直してください' };
  const { error } = await sb.auth.updateUser({ password, data: { password_set: true } });
  if (error) {
    if (/same|different from the old/i.test(error.message)) return { ok: false, message: '前と同じパスワードです。別のものにしてください' };
    if (/weak|short|characters/i.test(error.message)) return { ok: false, message: `もっと長く・複雑なパスワードにしてください（${error.message}）` };
    return { ok: false, message: `保存できませんでした（${error.message}）` };
  }
  return { ok: true, message: 'パスワードを決めました。次からはメールアドレスとパスワードでログインできます' };
}
