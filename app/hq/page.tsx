import Link from 'next/link';
import { redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import HqBoard, { type BoardStore } from '@/components/HqBoard';
import HqManage from '@/components/HqManage';
import HqBilling from '@/components/HqBilling';
import HqStaffList, { type StaffRow } from '@/components/HqStaffList';
import { stripeReady } from '@/lib/stripe';
import { canManageCompany, requireViewer } from '@/lib/auth';
import { companyStores, diffsOf, helpAvailability, lendOf, loadGrid, splitOf, type Grid } from '@/lib/data';
import { iso, nextStartOf, periodDays, periodFromParam, prevStartOf } from '@/lib/period';
import { defaultDeadline } from '@/lib/deadline';
import { helpMonth } from '@/lib/hqStats';
import { lastSignIns } from '@/lib/authUsers';
import { isWorkingPart, staffOffOptions, staffState } from '@/lib/shift';
import { db } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

type Tab = 'overview' | 'help' | 'work' | 'staff' | 'manage';
const TABS: [Tab, string][] = [['overview', '全店の状況'], ['help', 'ヘルプの集計'], ['work', '出勤の集計'], ['staff', 'スタッフ一覧'], ['manage', '店舗・アカウント・お支払い']];
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

export default async function HqPage({ searchParams }: { searchParams: { company?: string; p?: string; billing?: string; tab?: string; m?: string } }) {
  const v = await requireViewer();
  const companyId = v.isAdmin && searchParams.company ? searchParams.company : v.companyId;
  if (!companyId || !canManageCompany(v, companyId)) redirect('/');
  const tab: Tab = (TABS.map(t => t[0]) as string[]).includes(searchParams.tab ?? '') ? searchParams.tab as Tab : searchParams.billing ? 'manage' : 'overview';
  const [stores, company] = await Promise.all([
    companyStores(companyId),
    db().from('companies').select('*').eq('id', companyId).maybeSingle(),
  ]);
  const cq = v.isAdmin && searchParams.company ? `company=${companyId}&` : '';
  const href = (t: Tab, extra = '') => `/hq?${cq}tab=${t}${extra}`;

  const head = (
    <>
      <div className="hq-title">
        <small>本部</small>
        <h1 className="title" style={{ margin: 0 }}>{company.data?.name ?? ''}</h1>
      </div>
      <nav className="tabs" aria-label="本部のメニュー">
        {TABS.map(([t, l]) => <Link key={t} href={href(t, searchParams.p && t !== 'help' ? `&p=${searchParams.p}` : '')} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined}>{l}</Link>)}
      </nav>
    </>
  );

  if (stores.length === 0 || tab === 'manage') {
    const { data: profiles } = await db().from('profiles').select('user_id, display_name, role, store_id, person_name, title, extra_store_ids').eq('company_id', companyId);
    const logins = await lastSignIns((profiles ?? []).map(p => p.user_id));
    return (
      <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={stores} active="hq">
        {head}
        {stores.length === 0 && <p className="notice">まだ店舗がありません。下の「店舗」から追加してください。</p>}
        {stripeReady() && company.data && (company.data.price_per_store ?? 0) > 0 && stores.length > 0 && (
          <HqBilling
            companyId={companyId}
            method={company.data.billing_method ?? 'card'}
            status={company.data.billing_status ?? 'none'}
            monthly={(company.data.price_per_store ?? 0) * stores.length}
            stores={stores.length}
            trialEnds={company.data.status === 'trial' ? company.data.trial_ends : null}
            periodEnd={company.data.current_period_end ?? null}
            invStatus={company.data.last_invoice_status ?? null}
            invAmount={company.data.last_invoice_amount ?? null}
            invDue={company.data.last_invoice_due ?? null}
            invUrl={company.data.last_invoice_url ?? null}
            justPaid={searchParams.billing === 'ok'}
          />
        )}
        <HqManage
          companyId={companyId}
          hqCanEdit={company.data?.hq_can_edit !== false}
          managerNeighbors={company.data?.manager_neighbors === true}
          stores={stores.map(s => ({ id: s.id, name: s.name }))}
          people={(profiles ?? []).map((p: any) => ({ userId: p.user_id, email: p.display_name ?? '', name: p.person_name ?? '', title: p.title ?? '店長', extras: (p.extra_store_ids ?? []) as string[], role: p.role, storeId: p.store_id ?? '', store: stores.find(s => s.id === p.store_id)?.name ?? '', lastLogin: logins.get(p.user_id) ?? null }))}
          me={v.userId}
        />
      </AppShell>
    );
  }

  // ---- ヘルプの集計（月ごと）----
  if (tab === 'help') {
    const nowJ = new Date(Date.now() + 9 * 3600e3);
    const month = /^\d{4}-\d{2}$/.test(searchParams.m ?? '') ? searchParams.m! : nowJ.toISOString().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const shift = (k: number) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.toISOString().slice(0, 7); };
    const h = await helpMonth(stores, month);
    const max = Math.max(1, ...h.stores.map(s => Math.max(s.lent, s.borrowed)));
    return (
      <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={stores} active="hq">
        {head}
        <div className="period">
          <Link className="round" aria-label="前の月" href={href('help', `&m=${shift(-1)}`)}>‹</Link>
          <div><small>ヘルプの貸し借り（人日＝1人が1日行くと1）</small><h1>{y}年{m}月</h1></div>
          <Link className="round" aria-label="次の月" href={href('help', `&m=${shift(1)}`)}>›</Link>
        </div>
        <div className="kpis">
          <div className="kpi"><span>この月のヘルプ</span><b>{h.total}人日</b></div>
          <div className="kpi"><span>いちばん貸した店</span><b style={{ fontSize: 18 }}>{[...h.stores].sort((a, b) => b.lent - a.lent)[0]?.lent ? [...h.stores].sort((a, b) => b.lent - a.lent)[0].name : '—'}</b></div>
          <div className="kpi"><span>いちばん借りた店</span><b style={{ fontSize: 18 }}>{[...h.stores].sort((a, b) => b.borrowed - a.borrowed)[0]?.borrowed ? [...h.stores].sort((a, b) => b.borrowed - a.borrowed)[0].name : '—'}</b></div>
        </div>
        <div className="cols">
          <section className="card wide">
            <h2>店ごとの貸し借り</h2>
            <div className="legend"><span><i style={{ background: '#2F5D8A' }} />貸した（よその店へ行った）</span><span><i style={{ background: '#C9A227' }} />借りた（よその店から来た）</span></div>
            <div className="barlist">
              {h.stores.map(s => (
                <div key={s.id} className="barrow">
                  <span className="bname">{s.name}</span>
                  <div className="bars">
                    <div className="bar"><i style={{ width: `${(s.lent / max) * 100}%`, background: '#2F5D8A' }} /><b>{s.lent}</b></div>
                    <div className="bar"><i style={{ width: `${(s.borrowed / max) * 100}%`, background: '#C9A227' }} /><b>{s.borrowed}</b></div>
                  </div>
                  <span className={`diff ${s.borrowed - s.lent > 0 ? 'minus' : s.borrowed - s.lent < 0 ? 'plus' : ''}`}>{s.lent - s.borrowed > 0 ? `+${s.lent - s.borrowed}` : s.lent - s.borrowed}</span>
                </div>
              ))}
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>右の数字は「貸した − 借りた」。プラスの店は人を出していて、マイナスの店は人を借りています。</p>
          </section>
          <section className="card narrow">
            <h2>どこからどこへ</h2>
            {h.pairs.length === 0 ? <p className="muted" style={{ margin: 0 }}>この月のヘルプはまだありません</p> : (
              <table className="list">
                <thead><tr><th>から</th><th>へ</th><th style={{ textAlign: 'right' }}>人日</th></tr></thead>
                <tbody>{h.pairs.map(p => <tr key={`${p.from}-${p.to}`}><td>{p.from}</td><td>{p.to}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.count}</td></tr>)}</tbody>
              </table>
            )}
          </section>
        </div>
      </AppShell>
    );
  }

  // ---- スタッフ一覧 ----
  if (tab === 'staff') {
    const ids = stores.map(s => s.id);
    const { data: ms } = await db().from('members').select('id, name, kind, store_id, extra_store_ids, line_user_id, help_stores').in('store_id', ids).eq('active', true).order('sort');
    const nameOf = new Map(stores.map(s => [s.id, s.name]));
    const rows: StaffRow[] = (ms ?? []).map(m => ({
      id: m.id, name: m.name, kind: m.kind === 'staff' ? '社員' : 'アルバイト', store: nameOf.get(m.store_id) ?? '', storeId: m.store_id,
      extra: ((m.extra_store_ids ?? []) as string[]).map(x => nameOf.get(x)).filter(Boolean).join('、'),
      line: !!m.line_user_id,
      help: m.kind === 'staff' ? '—' : m.help_stores == null ? '未設定（どこでも）' : (m.help_stores as string[]).length === 0 ? '行かない' : (m.help_stores as string[]).map(x => nameOf.get(x)).filter(Boolean).join('、'),
    }));
    return (
      <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={stores} active="hq">
        {head}
        <HqStaffList rows={rows} stores={stores.map(s => ({ id: s.id, name: s.name }))} />
      </AppShell>
    );
  }

  // ---- ここから期間ごと（全店の状況・出勤の集計）----
  const split = splitOf(stores[0]);
  const start = periodFromParam(searchParams.p, split);
  const days = periodDays(start, split);
  const grids = await Promise.all(stores.map(s => loadGrid(s, start, days)));
  const label = grids[0].label;
  const nav = (t: Tab, title: string) => (
    <div className="period">
      <Link className="round" aria-label="前の期間" href={href(t, `&p=${iso(prevStartOf(start, split))}`)}>‹</Link>
      <div><small>{title}</small><h1>{label}</h1></div>
      <Link className="round" aria-label="次の期間" href={href(t, `&p=${iso(nextStartOf(start, split))}`)}>›</Link>
    </div>
  );

  if (tab === 'work') {
    const work = (g: Grid) => {
      const off = staffOffOptions(g.store);
      const rows = [
        ...g.parts.map(r => ({ name: r.member.name, kind: 'アルバイト', days: r.cells.filter(c => isWorkingPart(c.value)).length, help: r.cells.filter(c => c.value.startsWith('→')).length })),
        ...g.staff.filter(r => !r.guest).map(r => ({ name: r.member.name, kind: '社員', days: r.cells.filter(c => staffState(c.value, r.member, g.store.id, off) === 'work').length, help: r.cells.filter(c => c.value.startsWith('@')).length })),
      ];
      return rows.sort((a, b) => b.days - a.days);
    };
    return (
      <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={stores} active="hq">
        {head}
        {nav('work', '店ごと・人ごとの出勤日数（この期間）')}
        <p className="muted" style={{ margin: 0 }}>出勤日数は、シフト表で時間や○が入っている日（社員は出勤の日）です。「ほかの店」は、ヘルプや兼務でよその店に出る日です。確定前の期間は、変わることがあります。</p>
        <div className="work-grid">
          {grids.map(g => {
            const rows = work(g);
            const max = Math.max(1, ...rows.map(r => r.days + r.help));
            const total = rows.reduce((a, r) => a + r.days, 0);
            return (
              <section key={g.store.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <h2 style={{ margin: 0 }}>{g.store.name}</h2>
                  <span className="row" style={{ gap: 6 }}>
                    <span className={`pill ${g.confirmed ? 'done' : g.locked ? 'wait' : ''}`}>{g.confirmed ? '確定' : g.locked ? '締め切り' : '受付中'}</span>
                    <span className="muted">のべ {total}人日</span>
                  </span>
                </div>
                {rows.length === 0 ? <p className="muted">メンバーがいません</p> : (
                  <div className="barlist">
                    {rows.map(r => (
                      <div key={`${r.kind}${r.name}`} className="barrow compact">
                        <span className="bname">{r.name}{r.kind === '社員' && <small className="muted">（社員）</small>}</span>
                        <div className="bar"><i style={{ width: `${(r.days / max) * 100}%`, background: r.kind === '社員' ? '#16213E' : '#2F5D8A' }} /><i style={{ width: `${(r.help / max) * 100}%`, background: '#C9A227' }} /><b>{r.days}日{r.help ? `＋ほかの店${r.help}日` : ''}</b></div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </AppShell>
    );
  }

  // ---- 全店の状況（いちばん最初の画面）----
  const { data: locks } = await db().from('period_locks').select('store_id, deadline').in('store_id', stores.map(s => s.id)).eq('period_start', iso(start));
  const dl = new Map((locks ?? []).map(l => [l.store_id, l.deadline as string | null]));
  const board: BoardStore[] = grids.map(g => ({
    id: g.store.id,
    name: g.store.name,
    locked: g.locked,
    diffs: diffsOf(g),
    lend: lendOf(g),
    people: helpAvailability(g),
    helps: g.helpIns,
    guestIns: g.guests.flatMap(x => x.cells.flatMap((c, i) => isWorkingPart(c) ? [{ date: g.days[i].iso, name: x.name || 'ヘルプ', from: x.from }] : [])),
    lends: g.parts.flatMap(r => r.cells.flatMap((c, i) => c.value.startsWith('→') ? [{ date: g.days[i].iso, name: r.member.name, to: c.value.slice(1).trim() }] : [])),
  }));
  const totalShort = board.reduce((a, s) => a + s.diffs.reduce((b, d) => b + Math.max(0, -d), 0), 0);
  const parts = grids.reduce((a, g) => a + g.parts.length, 0);
  const submitted = grids.reduce((a, g) => a + g.parts.filter(r => r.submitted).length, 0);
  const confirmedN = grids.filter(g => g.confirmed).length;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  return (
    <AppShell viewer={v} companyName={company.data?.name ?? ''} stores={stores} active="hq">
      {head}
      <div className="head">
        {nav('overview', '全店のシフトの進み具合')}
        <a className="btn" href={`/hq/export?${cq}p=${iso(start)}`} download>シフトを書き出す（Excel で開けます）</a>
      </div>
      <div className="kpis">
        <div className="kpi"><span>確定した店</span><b>{confirmedN} / {stores.length}店</b></div>
        <div className="kpi"><span>シフトの提出</span><b>{submitted} / {parts}人</b></div>
        <div className="kpi"><span>足りない人数（全店・のべ）</span><b className={totalShort ? 'bad' : ''}>{totalShort}人</b></div>
        <div className="kpi"><span>この期間のヘルプ</span><b>{board.reduce((a, s) => a + s.lends.length + s.guestIns.length, 0)}件</b></div>
      </div>

      <section className="card scroll">
        <h2>店ごとの進み具合</h2>
        <table className="list progress">
          <thead><tr><th>店舗</th><th>シフトの提出</th><th>状態</th><th>提出の締め切り</th><th>足りない日</th><th>LINE で配った日</th><th /></tr></thead>
          <tbody>
            {grids.map((g, i) => {
              const sub = g.parts.filter(r => r.submitted).length, all = g.parts.length;
              const rate = all ? Math.round((sub / all) * 100) : 0;
              const deadline = dl.get(g.store.id) ?? defaultDeadline(g.start);
              const short = board[i].diffs.filter(d => d < 0).length;
              const late = !g.confirmed && deadline < today;
              return (
                <tr key={g.store.id}>
                  <td><b>{g.store.name}</b></td>
                  <td>
                    <div className="meter"><i style={{ width: `${rate}%`, background: rate === 100 ? '#2C6B3F' : rate >= 70 ? '#2F5D8A' : '#C9A227' }} /></div>
                    <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{sub}/{all}人</span>
                  </td>
                  <td><span className={`pill ${g.confirmed ? 'done' : g.locked ? 'wait' : ''}`} style={!g.confirmed && !g.locked ? { background: '#EEF0F4', color: '#4A5370' } : undefined}>{g.confirmed ? '確定' : g.locked ? '締め切り（調整中）' : '受付中'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{md(deadline)}{late && <span className="pill stop" style={{ marginLeft: 6 }}>過ぎています</span>}</td>
                  <td>{short ? <span className="error" style={{ fontWeight: 700 }}>{short}日</span> : <span className="muted">なし</span>}</td>
                  <td className="muted">{g.sentAt ? new Date(g.sentAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'まだ'}</td>
                  <td><Link className="btn sm" href={`/store/${g.store.id}?p=${g.start}`}>シフト表</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>締め切りを過ぎても確定していない店は「過ぎています」と出ます。</p>
      </section>

      <h2 className="section-title">人の過不足とヘルプ</h2>
      <p className="muted" style={{ margin: 0 }}>数字は「出れる人数 − 必要人数」。＋は余裕、−は足りない人数です（締め切り済みの店で足りている日は、カットの人数）。マスを押すと、その日のヘルプが見られます。</p>
      <HqBoard days={grids[0].days} stores={board} />
    </AppShell>
  );
}
