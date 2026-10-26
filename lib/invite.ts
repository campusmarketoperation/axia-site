import { db } from './supabase/admin';
import { logEvent } from './events';

/** メールで招待して、店長／本部として登録する（もう登録済みの人なら役割だけ付け直す） */
export async function inviteUser(email: string, companyId: string, role: 'manager' | 'hq', storeId: string | null, name?: string, title?: string, extras?: string[]) {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, message: 'メールアドレスの形がおかしいです' };
  const site = process.env.NEXT_PUBLIC_SITE_URL || '';
  let userId: string | null = null;
  const inv = await db().auth.admin.inviteUserByEmail(e, { redirectTo: `${site}/auth/callback` });
  if (inv.data?.user) userId = inv.data.user.id;
  else {
    // すでにいる人：一覧から探す
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await db().auth.admin.listUsers({ page, perPage: 200 });
      const hit = data?.users.find(u => (u.email ?? '').toLowerCase() === e);
      if (hit) userId = hit.id;
      if (!data || data.users.length < 200) break;
    }
  }
  if (!userId) {
    const why = inv.error?.message ?? '';
    console.error('invite failed', e, inv.error);
    await logEvent('invite', `招待メールを送れませんでした（${e}）：${inv.error?.message ?? ''}`, companyId);
    const hint = /rate limit/i.test(why) ? '（メールを送れる回数の上限です。1時間ほど待ってください）'
      : /sending|smtp|mail/i.test(why) ? '（メールを送れませんでした。SupabaseのSMTP設定を確認してください）' : '';
    return { ok: false, message: `招待できませんでした${hint}${why ? `：${why}` : ''}` };
  }
  // ほかの会社ですでに使われているアカウントは、取り込まない（別の会社の人を勝手に移せないように）
  const { data: cur } = await db().from('profiles').select('company_id').eq('user_id', userId).maybeSingle();
  if (cur?.company_id && cur.company_id !== companyId) {
    await logEvent('invite', `ほかの会社で使われているメールアドレスを招待しようとしました（${e}）`, companyId, 'warn');
    return { ok: false, message: 'このメールアドレスは、ほかの会社のアカウントで使われています。別のメールアドレスで招待してください' };
  }
  const { error } = await db().from('profiles').upsert({ user_id: userId, company_id: companyId, role, store_id: role === 'manager' ? storeId : null, display_name: e, person_name: name?.trim().slice(0, 30) || null, title: role === 'manager' ? (title === '社員' ? '社員' : '店長') : null, extra_store_ids: role === 'manager' && extras?.length ? extras.filter(x => x !== storeId) : null });
  if (error) return { ok: false, message: '登録できませんでした' };
  return { ok: true, message: inv.data?.user ? '招待メールを送りました' : '登録しました（もうアカウントがある人です。ログイン画面からログインできます）' };
}

/**
 * 社員が LINE から自分でログイン用アカウントを作る（社員として、自分の店・兼務先の店で使える）
 * すでにアカウントがあるメール（店長・本部など）は上書きしない
 */
export async function inviteStaffSelf(email: string, m: { name: string; store_id: string; extra_store_ids?: string[] | null }, companyId: string) {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, message: 'メールアドレスの形がおかしいです。もう一度送ってください（やめる時は「やめる」）' };
  // もう同じメールの人がいるか
  for (let page = 1; page <= 20; page++) {
    const { data } = await db().auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find(u => (u.email ?? '').toLowerCase() === e);
    if (hit) {
      const { data: p } = await db().from('profiles').select('role').eq('user_id', hit.id).maybeSingle();
      if (p?.role) return { ok: false, message: 'そのメールアドレスはもう登録されています。ログイン画面からログインしてください（パスワードを忘れた時は、ログイン画面の「メールでログイン」）' };
      break;
    }
    if (!data || data.users.length < 200) break;
  }
  const r = await inviteUser(e, companyId, 'manager', m.store_id, m.name, '社員', m.extra_store_ids ?? []);
  return r.ok ? { ok: true, message: `${e} に招待メールを送りました。\nメールのリンクを開くと、社員としてログインできます。` } : r;
}
