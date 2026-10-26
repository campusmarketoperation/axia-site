import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import NeighborBoard from '@/components/NeighborBoard';
import { canHelpStore, canViewStore, requireViewer, storesFor } from '@/lib/auth';
import { companyStores, diffsOf, getStore, helpAvailability, lendOf, loadGrid, splitOf } from '@/lib/data';
import { iso, nextStartOf, periodDays, periodFromParam, prevStartOf } from '@/lib/period';
import { db } from '@/lib/supabase/admin';
import type { Store } from '@/lib/shift';

export const dynamic = 'force-dynamic';

export default async function NeighborsPage({ params, searchParams }: { params: { storeId: string }; searchParams: { p?: string } }) {
  const v = await requireViewer();
  const store = await getStore(params.storeId);
  if (!store) notFound();
  if (!canViewStore(v, store)) redirect('/');
  const split = splitOf(store);
  const start = periodFromParam(searchParams.p, split);
  const days = periodDays(start, split);
  const { data: nbRows } = await db().from('store_neighbors').select('neighbor_id').eq('store_id', store.id);
  const ids = (nbRows ?? []).map(r => r.neighbor_id);
  const [own, all, company] = await Promise.all([
    loadGrid(store, start),
    companyStores(store.company_id),
    db().from('companies').select('name').eq('id', store.company_id).maybeSingle(),
  ]);
  const neighbors = all.filter(s => ids.includes(s.id));
  const grids = await Promise.all(neighbors.map((s: Store) => loadGrid(s, start, days)));
  const base = `/store/${store.id}/neighbors`;

  return (
    <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={storesFor(v, all)} storeId={store.id} active="neighbors">
      <div className="head">
        <div className="period">
          <Link className="round" aria-label="前の期間" href={`${base}?p=${iso(prevStartOf(start, split))}`}>‹</Link>
          <div><small>近隣のシフト</small><h1>{own.label}</h1></div>
          <Link className="round" aria-label="次の期間" href={`${base}?p=${iso(nextStartOf(start, split))}`}>›</Link>
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        他の店の「ヘルプOK」の人が、頼める日だけ出ます（締め切り済みの店は、自分の店に入っていない日。その店の店長が「ヘルプに出せない」にしている日は出ません）。「過不足」は出れる人数 − 必要人数（＋は余裕、−は足りない）。名前にカーソルを乗せると本人の希望が見れます。緑のマスを押すと、その人にヘルプを頼めます。
      </p>
      {neighbors.length === 0 && <p className="notice">近隣の店が設定されていません。本部が「店舗の設定」から選べます。</p>}
      <NeighborBoard
        storeId={store.id}
        storeName={store.name}
        days={own.days}
        own={{ counts: own.counts, needs: own.needs }}
        neighbors={grids.map(g => ({ id: g.store.id, name: g.store.name, locked: g.locked, counts: g.counts, needs: g.needs, diffs: diffsOf(g), lend: lendOf(g), people: helpAvailability(g) }))}
        canAsk={canHelpStore(v, store)}
      />
    </AppShell>
  );
}

