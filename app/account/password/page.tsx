import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import PasswordForm from './PasswordForm';

export const dynamic = 'force-dynamic';

export default async function PasswordPage({ searchParams }: { searchParams: { first?: string } }) {
  const v = await getViewer();
  if (!v) redirect('/login');
  const first = searchParams.first === '1';
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--navy)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div className="brand" style={{ color: 'var(--navy)' }}>AXIA Shift</div>
          <p className="muted" style={{ margin: 0 }}>{first ? 'はじめに、ログイン用のパスワードを決めてください' : 'パスワードの変更'}</p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{v.email}</p>
        </div>
        <PasswordForm first={first} />
      </div>
    </div>
  );
}
