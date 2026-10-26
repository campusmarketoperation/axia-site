import LoginForm from './LoginForm';

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--navy)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div className="brand" style={{ color: 'var(--navy)' }}>AXIA Shift</div>
          <p className="muted" style={{ margin: 0 }}>店長・本部の方のログイン</p>
        </div>
        {searchParams.error && <p className="error">ログインできませんでした。リンクの期限が切れているかもしれません。もう一度メールを送ってください。</p>}
        <LoginForm />
        <p className="muted" style={{ margin: 0 }}>アルバイトの方は、お店から届いたURLかLINEからシフトを出してください。</p>
      </div>
    </div>
  );
}
