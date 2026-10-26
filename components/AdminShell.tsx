import Link from 'next/link';

const MENU: [string, string][] = [
  ['/admin', '契約会社'],
  ['/admin/usage', '使われ方'],
  ['/admin/line', 'LINE送信数'],
  ['/admin/events', 'エラー記録'],
  ['/admin/notices', 'お知らせ'],
];

export default function AdminShell({ email, children, active = '/admin' }: { email: string; children: React.ReactNode; active?: string }) {
  return (
    <div className="shell">
      <aside className="side admin">
        <div><div className="brand">AXIA Shift</div><small>運営の管理画面</small></div>
        <nav aria-label="運営メニュー">
          {MENU.map(([href, label]) => <Link key={href} className={active === href ? 'on' : ''} href={href}>{label}</Link>)}
        </nav>
        <div className="who">{email}<br /><a href="/account/password">パスワード変更</a>　<a href="/logout">ログアウト</a></div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
