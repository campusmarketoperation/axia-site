import { NextResponse, type NextRequest } from 'next/server';
import { authClient } from '@/lib/supabase/server';

// メールのリンク（ログイン・招待）から戻ってきた時
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) {
    const sb = authClient();
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      // まだパスワードを決めていない人は、先に決めてもらう
      const set = data.user?.user_metadata?.password_set === true;
      return NextResponse.redirect(new URL(set ? '/' : '/account/password?first=1', url.origin));
    }
  }
  return NextResponse.redirect(new URL('/login?error=1', url.origin));
}
