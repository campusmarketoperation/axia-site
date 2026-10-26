import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import CompanyAdmin from '@/components/CompanyAdmin';
import AdminBilling from '@/components/AdminBilling';
import DeleteCompany from '@/components/DeleteCompany';
import { dashboardUrl, stripeReady, stripeTestMode } from '@/lib/stripe';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function CompanyPage({ params }: { params: { companyId: string } }) {
  const v = await requireAdmin();
  const { data: c } = await db().from('companies').select('*').eq('id', params.companyId).maybeSingle();
  if (!c) notFound();
  const [stores, profiles] = await Promise.all([
    db().from('stores').select('id, name, join_code').eq('company_id', c.id).order('sort'),
    db().from('profiles').select('user_id, display_name, role, store_id, person_name, title').eq('company_id', c.id),
  ]);
  const storeName = new Map((stores.data ?? []).map(s => [s.id, s.name]));
  return (
    <AdminShell email={v.email} active="/admin">
      <div className="head">
        <div><Link href="/admin" className="muted">← 契約会社</Link><h1 className="title">{c.name}</h1></div>
        <Link className="btn" href={`/hq?company=${c.id}`}>本部画面を見る</Link>
      </div>
      <CompanyAdmin
        company={{ id: c.id, name: c.name, status: c.status, price: c.price_per_store, note: c.note, trialEnds: c.trial_ends, hqCanEdit: c.hq_can_edit !== false }}
        stores={(stores.data ?? []).map(s => ({ id: s.id, name: s.name, code: s.join_code }))}
        people={(profiles.data ?? []).map((p: any) => ({ id: p.user_id, email: p.display_name ?? '', name: p.person_name ?? '', title: p.title ?? '店長', role: p.role, store: p.store_id ? storeName.get(p.store_id) ?? '' : '' }))}
      />
      <AdminBilling b={{
        companyId: c.id, method: c.billing_method ?? 'card', email: c.billing_email ?? '', days: c.invoice_days ?? 30,
        status: c.billing_status ?? 'none', periodEnd: c.current_period_end ?? null,
        customerUrl: c.stripe_customer_id ? dashboardUrl(`customers/${c.stripe_customer_id}`) : null,
        invStatus: c.last_invoice_status ?? null, invAmount: c.last_invoice_amount ?? null, invDue: c.last_invoice_due ?? null, invUrl: c.last_invoice_url ?? null,
        monthly: (c.price_per_store ?? 0) * Math.max(1, (stores.data ?? []).length), ready: stripeReady(), test: stripeTestMode(),
        companyStatus: c.status, notice: !!c.billing_notice, stopOn: c.stop_on ?? null, stoppedReason: c.stopped_reason ?? null,
      }} />
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0 }}>データ</h2>
        <p className="muted" style={{ margin: 0 }}>この会社のデータ（店舗・メンバー・希望・シフト・ヘルプ・メモ）を、まとめて1つのファイルに書き出します。解約のときのお渡しや保存に使います。消す前に書き出しておくと安心です。</p>
        <div className="row">
          <a className="btn" href={`/admin/${c.id}/export`}>データを書き出す（JSON）</a>
          <Link className="btn" href={`/admin/events?company=${c.id}`}>この会社のエラー記録</Link>
        </div>
      </section>
      <DeleteCompany companyId={c.id} name={c.name} />
    </AdminShell>
  );
}
