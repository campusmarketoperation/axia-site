import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import HelpAsks from '@/components/HelpAsks';
import HelpStoresEditor from '@/components/HelpStoresEditor';
import { canHelpStore, canViewStore, requireViewer, storesFor } from '@/lib/auth';
import { companyStores, getStore, splitOf, type HelpAsk } from '@/lib/data';
import { iso, periodStartOf, todayJST } from '@/lib/period';
import { db } from '@/lib/supabase/admin';
import type { Member } from '@/lib/shift';

export const dynamic = 'force-dynamic';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = (s: string) => { const d = new Date(`${s}T00:00:00Z`); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`; };

export default async function HelpPage({ params }: { params: { storeId: string } }) {
  const v = await requireViewer();
  const store = await getStore(params.storeId);
  if (!store) notFound();
  if (!canViewStore(v, store)) redirect('/');
  const readOnly = !canHelpStore(v, store);
  // 今の期間の最初から（過去の日の依頼も、承認待ちなら全部出す）
  const today = iso(periodStartOf(todayJST(), splitOf(store)));
  const [all, company, mem, outs, ins] = await Promise.all([
    companyStores(store.company_id),
    db().from('companies').select('name').eq('id', store.company_id).maybeSingle(),
    db().from('members').select('*').eq('store_id', store.id).eq('kind', 'part').eq('active', true).order('sort').order('created_at'),
    db().from('help_assignments').select('id, date, status, start_label, requested_by, members(name), to:stores!help_assignments_to_store_fkey(name)')
      .eq('from_store', store.id).or(`status.eq.pending,date.gte.${today}`).order('date').limit(200),
    db().from('help_assignments').select('id, date, status, start_label, members(name), from:stores!help_assignments_from_store_fkey(name)')
      .eq('to_store', store.id).gte('date', today).order('date').limit(100),
  ]);
  const others = all.filter(s => s.id !== store.id).map(s => ({ id: s.id, name: s.name }));
  const asks: HelpAsk[] = (outs.data ?? []).filter((h: any) => h.status === 'pending')
    .map((h: any) => ({ id: h.id, memberName: h.members?.name ?? '', toStore: h.to?.name ?? '', date: h.date, requestedBy: h.requested_by ?? '' }));
  const lent = (outs.data ?? []).filter((h: any) => h.status === 'approved');
  const got = ins.data ?? [];

  return (
    <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={storesFor(v, all)} storeId={store.id} active="help">
      <h1 className="title">ヘルプ</h1>
      {(outs.error || ins.error) && <p className="error" style={{ margin: 0 }}>ヘルプの一覧を読めませんでした（{(outs.error || ins.error)?.message}）。Supabase で 009 の SQL を流したか確認してください。</p>}
      {!readOnly && <HelpAsks storeId={store.id} asks={asks} />}
      {!readOnly && asks.length === 0 && <p className="muted" style={{ margin: 0 }}>承認待ちのヘルプの依頼はありません。</p>}

      <div className="cols">
        <section className="card wide" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0 }}>この店の人が行くヘルプ（今の期間から）</h2>
          {lent.length === 0 && <p className="muted" style={{ margin: 0 }}>ありません</p>}
          {lent.map((h: any) => (
            <div key={h.id} className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
              <span>{md(h.date)}　{h.members?.name}さん → <b>{h.to?.name}</b></span>
              <span className="muted">{h.start_label || '時間未定'}</span>
            </div>
          ))}
        </section>
        <section className="card narrow" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0 }}>来てもらうヘルプ（今の期間から）</h2>
          {got.length === 0 && <p className="muted" style={{ margin: 0 }}>ありません</p>}
          {got.map((h: any) => (
            <div key={h.id} className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
              <span>{md(h.date)}　{h.members?.name}さん（{h.from?.name}）</span>
              {h.status === 'pending' ? <span className="pill wait" style={{ fontSize: 11 }}>承認待ち</span> : <span className="muted">{h.start_label || '時間未定'}</span>}
            </div>
          ))}
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>入り時間は <Link href={`/store/${store.id}`}>シフト表</Link> の「他店からのヘルプ」のマスを押して決めます。ヘルプを頼むのは <Link href={`/store/${store.id}/neighbors`}>近隣のシフト</Link> から。</p>
        </section>
      </div>

      {store.help_enabled !== false && others.length > 0 && (
        <HelpStoresEditor storeId={store.id} readOnly={readOnly} stores={others}
          members={((mem.data ?? []) as Member[]).map(m => ({ id: m.id, name: m.name, line: !!m.line_user_id, helpStores: m.help_stores ?? null }))} />
      )}
    </AppShell>
  );
}
