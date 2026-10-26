import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import TodayBoard from '@/components/TodayBoard';
import { canEditStore, canViewStore, requireViewer, storesFor } from '@/lib/auth';
import { companyStores, getStore, loadGrid, splitOf } from '@/lib/data';
import { addDays, iso, periodStartOf, todayJST } from '@/lib/period';
import { lineupOf } from '@/lib/todayBoard';
import { db } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** 店を開いた時の最初の画面：今日・明日の出勤（入り時間の早い順） */
export default async function TodayPage({ params }: { params: { storeId: string } }) {
  const v = await requireViewer();
  const store = await getStore(params.storeId);
  if (!store) notFound();
  if (!canViewStore(v, store)) redirect('/');
  const split = splitOf(store);
  const today = todayJST(), tomorrow = addDays(today, 1);
  const [l0, l1, stores, company] = await Promise.all([
    loadGrid(store, periodStartOf(today, split), [today]).then(g => lineupOf(g, iso(today))),
    loadGrid(store, periodStartOf(tomorrow, split), [tomorrow]).then(g => lineupOf(g, iso(tomorrow))),
    companyStores(store.company_id).then(all => storesFor(v, all)),
    db().from('companies').select('name').eq('id', store.company_id).maybeSingle(),
  ]);
  const base = `/store/${store.id}`;
  // 承認待ちのヘルプ（自分の店の人への依頼）
  const { count: asks } = canEditStore(v, store)
    ? await db().from('help_assignments').select('id', { count: 'exact', head: true }).eq('from_store', store.id).eq('status', 'pending').gte('date', iso(today))
    : { count: 0 };

  return (
    <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={stores} storeId={store.id} active="today">
      <div className="head">
        <div className="period">
          <div>
            <small>{store.name}</small>
            <h1>今日の出勤</h1>
          </div>
        </div>
        <Link className="btn" href={base}>シフト表を開く →</Link>
      </div>
      {!!asks && <p className="notice" style={{ margin: 0 }}>ヘルプの依頼が <b>{asks}件</b> 承認待ちです。<Link href={`${base}/help`}>ヘルプで確認する →</Link></p>}
      {l0 && l1 && <TodayBoard days={[{ title: '今日', l: l0 }, { title: '明日', l: l1 }]} />}
    </AppShell>
  );
}
