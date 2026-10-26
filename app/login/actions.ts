'use server';
import { authClient } from '@/lib/supabase/server';
import { adminEmails } from '@/lib/auth';

export async function sendLoginLink(email: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const site = process.env.NEXT_PUBLIC_SITE_URL || '';
  const e = email.trim();
  const { error } = await authClient().auth.signInWithOtp({
    email: e,
    // 招待されていない人は作らない（運営・本部が招待した人だけログインできる）。運営のメールだけは最初の1回で作る
    options: { emailRedirectTo: `${site}/auth/callback`, shouldCreateUser: adminEmails().includes(e.toLowerCase()) },
  });
  if (error) {
    const why = error.message || '';
    console.error('login link failed', e, error);
    if (/signups? not allowed|not found|user not/i.test(why)) return { ok: false, message: 'このメールアドレスは登録されていません。お店の本部か運営に招待してもらってください。' };
    if (/rate limit|security purposes|seconds/i.test(why)) return { ok: false, message: `続けて送りすぎました。少し時間をおいてからもう一度押してください（${why}）` };
    if (/sending|smtp|mail/i.test(why)) return { ok: false, message: `メールを送れませんでした。運営に連絡してください（${why}）` };
    return { ok: false, message: `送れませんでした（${why}）` };
  }
  return { ok: true };
}

/** メールアドレスとパスワードでログイン */
export async function signInPassword(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await authClient().auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return { ok: true };
  const why = error.message || '';
  if (/invalid login credentials/i.test(why)) return { ok: false, message: 'メールアドレスかパスワードが違います。パスワードをまだ決めていない・忘れた時は、下の「ログイン用のリンクをメールで送る」から入ってください。' };
  if (/rate limit|too many/i.test(why)) return { ok: false, message: '続けて試しすぎました。少し時間をおいてください。' };
  return { ok: false, message: `ログインできませんでした（${why}）` };
}
