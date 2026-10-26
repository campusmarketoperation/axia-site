import { notFound, redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import SettingsForm from '@/components/SettingsForm';
import { canEditNeighbors, canManageStore, canViewStore, requireViewer, storesFor } from '@/lib/auth';
import { companyStores, getStore } from '@/lib/data';
import { db } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: { storeId: string } }) {
  const v = await requireViewer();
  const store = await getStore(params.storeId);
  if (!store) notFound();
  if (!canViewStore(v, store)) redirect('/');
  const readOnly = !canManageStore(v, store);
  const [all, nb, company] = await Promise.all([
    companyStores(store.company_id),
    db().from('store_neighbors').select('neighbor_id').eq('store_id', store.id),
    db().from('companies').select('name').eq('id', store.company_id).maybeSingle(),
  ]);
  const site = process.env.NEXT_PUBLIC_SITE_URL || '';
  return (
    <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={storesFor(v, all)} storeId={store.id} active="settings">
      <h1 className="title">店舗の設定</h1>
      <div className="cols">
        <section className="card narrow" style={{ maxWidth: 'none', flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>バイトの人に配るもの</h2>
          <div className="field">
            <label htmlFor="submit-url">シフト提出画面のURL（グループLINEなどに貼る）</label>
            <input id="submit-url" className="input" readOnly value={`${site}/s/${store.submit_token}`} />
          </div>
          <div className="field">
            <label htmlFor="join-code">LINEで出す人の登録コード</label>
            <input id="join-code" className="input" readOnly value={store.join_code} style={{ fontSize: 20, fontWeight: 700, letterSpacing: '.2em' }} />
            <span className="muted">LINEで友だち追加したあと、このコードを送ると店に登録されます。</span>
          </div>
        </section>
        <SettingsForm
          store={store}
          stores={all.filter(s => s.id !== store.id).map(s => ({ id: s.id, name: s.name }))}
          neighbors={(nb.data ?? []).map(r => r.neighbor_id)}
          canEditNeighbors={canEditNeighbors(v, store)}
          readOnly={readOnly}
        />
      </div>
    </AppShell>
  );
}
