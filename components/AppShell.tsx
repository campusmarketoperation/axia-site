import Link from 'next/link';
import type { Viewer } from '@/lib/auth';
import type { Store } from '@/lib/shift';
import StoreSwitch from './StoreSwitch';
import { activeAnnouncements } from '@/lib/announce';

type Props = {
  viewer: Viewer;
  companyName: string;
  stores: Store[];          // 切り替えられる店舗
  storeId?: string;         // 今見ている店舗
  active: 'today' | 'grid' | 'neighbors' | 'help' | 'members' | 'settings' | 'hq';
  children: React.ReactNode;
};

export default async function AppShell({ viewer, companyName, stores, storeId, active, children }: Props) {
  const notices = await activeAnnouncements();
  const canHq = viewer.isAdmin || viewer.role === 'hq';
  const s = storeId ? `/store/${storeId}` : '';
  return (
    <div className="shell">
      <aside className="side">
        <div>
          <div className="brand">AXIA Shift</div>
          <small>{companyName}</small>
        </div>
        {storeId && stores.length > 1 && (
          <div className="field">
            <label htmlFor="store-switch" style={{ color: '#AEB5C8' }}>店舗</label>
            <StoreSwitch id="store-switch" stores={stores.map(x => ({ id: x.id, name: x.name }))} value={storeId} />
          </div>
        )}
        <nav aria-label="メニュー">
          {storeId && <>
            <Link className={active === 'today' ? 'on' : ''} href={`${s}/today`}>今日の出勤</Link>
            <Link className={active === 'grid' ? 'on' : ''} href={s}>シフト表</Link>
            <Link className={active === 'help' ? 'on' : ''} href={`${s}/help`}>ヘルプ</Link>
            <Link className={active === 'neighbors' ? 'on' : ''} href={`${s}/neighbors`}>近隣のシフト</Link>
            <Link className={active === 'members' ? 'on' : ''} href={`${s}/members`}>メンバー</Link>
            <Link className={active === 'settings' ? 'on' : ''} href={`${s}/settings`}>店舗の設定</Link>
          </>}
          {canHq && <Link className={active === 'hq' ? 'on' : ''} href={viewer.isAdmin && viewer.role !== 'hq' && stores[0] ? `/hq?company=${stores[0].company_id}` : '/hq'}>本部（全店）</Link>}
          {viewer.isAdmin && <Link href="/admin">運営の管理画面</Link>}
        </nav>
        <div className="who">
          <b style={{ color: '#fff' }}>{viewer.name}</b>{viewer.title && `（${viewer.title}）`}<br />
          <span style={{ fontSize: 11 }}>{viewer.email}</span><br />
          <a href="/account/password">パスワード変更</a>　<a href="/logout">ログアウト</a>
        </div>
      </aside>
      <main className="main">
        {notices.map(n => (
          <div key={n.id} role="status" style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 14, whiteSpace: 'pre-wrap', background: n.level === 'warn' ? '#FDECEC' : '#EEF4FB', color: n.level === 'warn' ? '#9B2C3F' : '#1F3B63', border: `1px solid ${n.level === 'warn' ? '#F1C2CC' : '#CFDDF0'}` }}>
            <b>{n.level === 'warn' ? '大事なお知らせ：' : 'お知らせ：'}</b>{n.body}
          </div>
        ))}
        {viewer.billingNotice && !viewer.isAdmin && (
          <div className="error" role="alert" style={{ padding: '12px 14px', borderRadius: 10, background: '#FDECEC', marginBottom: 16 }}>
            <b>お支払いが確認できていません。</b>
            {viewer.billingNotice.stopOn
              ? ` ${viewer.billingNotice.stopOn.replace(/-/g, '/')} までにお支払いが確認できない場合、ご利用（LINE・提出画面を含む）を停止します。`
              : ' お手数ですが、お支払いをお願いいたします。'}
            {viewer.billingNotice.invoiceUrl && <> <a href={viewer.billingNotice.invoiceUrl} target="_blank" rel="noreferrer">請求書を見る・支払う</a></>}
            {' '}すでにお支払い済みの場合は、反映まで少しお待ちください。お問い合わせ：axiaofficial.contact@gmail.com
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
