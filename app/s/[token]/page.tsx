import SubmitForm from '@/components/SubmitForm';
import { companyActive, splitOf, storeByToken } from '@/lib/data';
import { timeList } from '@/lib/shift';

export const dynamic = 'force-dynamic';

export default async function SubmitPage({ params }: { params: { token: string } }) {
  const store = await storeByToken(params.token);
  if (!store || !(await companyActive(store.company_id))) {
    return <div style={{ padding: 24 }}><p>この提出画面は使えません。お店に確認してください。</p></div>;
  }
  return (
    <SubmitForm
      token={params.token}
      storeName={store.name}
      split={splitOf(store)}
      times={timeList(store)}
      helpEnabled={store.help_enabled !== false}
    />
  );
}
