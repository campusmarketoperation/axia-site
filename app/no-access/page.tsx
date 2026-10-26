import { getViewer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function NoAccess() {
  const v = await getViewer();
  const stopped = !!v?.companyStopped;
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 440 }}>
        {stopped ? <>
          <h2>ご利用が停止されています</h2>
          <p className="muted">この会社の AXIA Shift のご利用は、現在停止しています。お支払いの確認などについては、運営（axiaofficial.contact@gmail.com）までご連絡ください。</p>
        </> : <>
          <h2>使える店舗がありません</h2>
          <p className="muted">このアカウントはまだ店舗に登録されていません。お店の本部か運営に確認してください。</p>
        </>}
        <a className="btn" href="/logout">ログアウト</a>
      </div>
    </div>
  );
}
