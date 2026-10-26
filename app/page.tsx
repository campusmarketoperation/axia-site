import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ログインした人の役割で行き先を決める
export default async function Home() {
  const v = await getViewer();
  if (!v) redirect('/login');
  if (v.role === 'manager' && v.storeId && !v.companyStopped) redirect(`/store/${v.storeId}/today`);
  if (v.role === 'hq' && !v.companyStopped) redirect('/hq');
  if (v.isAdmin) redirect('/admin');
  redirect('/no-access');
}
