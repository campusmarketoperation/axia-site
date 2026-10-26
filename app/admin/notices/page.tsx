import AdminShell from '@/components/AdminShell';
import NoticeEditor from '@/components/NoticeEditor';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';
import type { Announcement } from '@/lib/announce';

export const dynamic = 'force-dynamic';

export default async function NoticesPage() {
  const v = await requireAdmin();
  const { data } = await db().from('announcements').select('*').order('created_at', { ascending: false });
  return (
    <AdminShell email={v.email} active="/admin/notices">
      <div className="head"><h1 className="title">お知らせ</h1></div>
      <p className="muted" style={{ margin: 0 }}>店長・社員・本部の画面のいちばん上に出ます（バイトの提出画面と LINE には出ません）。メンテナンスや新しい機能の案内に使います。</p>
      <NoticeEditor list={(data ?? []) as Announcement[]} />
    </AdminShell>
  );
}
