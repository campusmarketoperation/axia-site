import { notFound, redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import MembersEditor from '@/components/MembersEditor';
import { canManageStore, canViewStore, requireViewer, storesFor } from '@/lib/auth';
import { companyStores, getStore } from '@/lib/data';
import { db } from '@/lib/supabase/admin';
import type { Member } from '@/lib/shift';

export const dynamic = 'force-dynamic';

export default async function MembersPage({ params }: { params: { storeId: string } }) {
  const v = await requireViewer();
  const store = await getStore(params.storeId);
  if (!store) notFound();
  if (!canViewStore(v, store)) redirect('/');
  const readOnly = !canManageStore(v, store);
  const [{ data }, all, company] = await Promise.all([
    db().from('members').select('*').eq('store_id', store.id).eq('active', true).order('sort').order('created_at'),
    companyStores(store.company_id),
    db().from('companies').select('name').eq('id', store.company_id).maybeSingle(),
  ]);
  const stores = storesFor(v, all);
  const others = all.filter(s => s.id !== store.id).map(s => ({ id: s.id, name: s.name }));
  return (
    <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={stores} storeId={store.id} active="members">
      <h1 className="title">メンバー</h1>
      <p className="muted" style={{ margin: 0 }}>上から順にシフト表に並びます。バイトの人が初めて提出すると、自動で一番下に追加されます。「番号」は本人確認に使う4けたの番号です。バイトは提出画面で使います（本人は LINE で「番号」と送ると確認できます）。社員は LINE 登録のときに聞かれるので、店長から伝えてください。</p>
      <MembersEditor storeId={store.id} readOnly={readOnly} members={(data ?? []) as Member[]} others={others} />
    </AppShell>
  );
}
