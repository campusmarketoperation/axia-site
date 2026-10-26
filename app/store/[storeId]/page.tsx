import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ShiftGrid from '@/components/ShiftGrid';
import SubmitReminder from '@/components/SubmitReminder';
import { canEditStore, canHelpStore, canViewStore, requireViewer, storesFor } from '@/lib/auth';
import { companyStores, getStore, loadGrid, splitOf } from '@/lib/data';
import { iso, nextStartOf, periodFromParam, prevStartOf } from '@/lib/period';
import { partOptions, staffOptions } from '@/lib/shift';
import { db } from '@/lib/supabase/admin';
import { loadHistory } from '@/lib/history';
import { defaultDeadline } from '@/lib/deadline';


export const dynamic = 'force-dynamic';

export default async function StorePage({ params, searchParams }: { params: { storeId: string }; searchParams: { p?: string } }) {
  const v = await requireViewer();
  const store = await getStore(params.storeId);
  if (!store) notFound();
  if (!canViewStore(v, store)) redirect('/');
  const readOnly = !canEditStore(v, store);
  const split = splitOf(store);
  const start = periodFromParam(searchParams.p, split);
  const [g, stores, company] = await Promise.all([
    loadGrid(store, start),
    companyStores(store.company_id).then(all => storesFor(v, all)),
    db().from('companies').select('name').eq('id', store.company_id).maybeSingle(),
  ]);
  const history = await loadHistory(store.id, g.days[0].iso, g.days[g.days.length - 1].iso);
  const dl = (await db().from('period_locks').select('deadline, auto_reminded_at').eq('store_id', store.id).eq('period_start', g.start).maybeSingle()).data ?? { deadline: null, auto_reminded_at: null };
  const submitted = g.parts.filter(r => r.submitted).length;
  const short = g.counts.filter((c, i) => c < g.needs[i]).length;
  const helpOk = g.parts.filter(r => r.helpOk).length;
  const base = `/store/${store.id}`;

  return (
    <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={stores} storeId={store.id} active="grid">
      <div className="head">
        <div className="period">
          <Link className="round" aria-label="前の期間" href={`${base}?p=${iso(prevStartOf(start, split))}`}>‹</Link>
          <div>
            <small>{start.getUTCFullYear()}年　{store.name}</small>
            <h1>{g.label}</h1>
          </div>
          <Link className="round" aria-label="次の期間" href={`${base}?p=${iso(nextStartOf(start, split))}`}>›</Link>
          {g.confirmed ? <span className="pill done">確定済み</span> : g.locked ? <span className="pill wait">締め切り済み</span> : <span className="pill wait">受付中</span>}
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><span>提出</span><b>{submitted} / {g.parts.length}人</b></div>
        <div className="kpi"><span>足りない日</span><b className={short ? 'bad' : ''}>{short}日</b></div>
        {g.store.help_enabled !== false && <div className="kpi"><span>ヘルプOK</span><b>{helpOk}人</b></div>}
        <div className="kpi"><span>LINE配信</span><b style={{ fontSize: 16 }}>{g.sentAt ? new Date(g.sentAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' に送信' : 'まだ'}</b></div>
      </div>
      {g.parts.length === 0 && (
        <p className="notice">まだメンバーがいません。「メンバー」から追加するか、提出画面のURL・LINEからバイトの人に出してもらうと自動で増えます。</p>
      )}
      {!readOnly && g.helpAsks.length > 0 && (
        <p className="notice" style={{ margin: 0 }}>ヘルプの依頼が <b>{g.helpAsks.length}件</b> 承認待ちです。<Link href={`${base}/help`}>ヘルプで確認する →</Link></p>
      )}
      {!readOnly && !g.locked && g.parts.length > 0 && (
        <SubmitReminder
          key={`rem-${g.start}`}
          storeId={store.id}
          periodLabel={g.label}
          periodStart={g.start}
          submitUrl={`${process.env.NEXT_PUBLIC_SITE_URL || ''}/s/${store.submit_token}`}
          people={g.parts.map(r => ({ id: r.member.id, name: r.member.name, submitted: r.submitted, started: r.started, line: !!r.member.line_user_id }))}
          savedDeadline={dl.deadline ?? defaultDeadline(g.start)}
          autoSent={!!dl.auto_reminded_at}
        />
      )}
      <ShiftGrid key={`${store.id}:${g.start}`} readOnly={readOnly} grid={g} partOptions={partOptions(store)} staffOptions={staffOptions(store)} history={history} helpAllowed={canHelpStore(v, store)} />
    </AppShell>
  );
}
