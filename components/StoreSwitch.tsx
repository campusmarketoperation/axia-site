'use client';
import { usePathname, useRouter } from 'next/navigation';

export default function StoreSwitch({ id, stores, value }: { id: string; stores: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  // 店を変えても、今いる画面（今日の出勤・シフト表など）のまま
  const sub = (usePathname() ?? '').replace(/^\/store\/[^/]+/, '').replace(/[^a-z/]/g, '');
  return (
    <select id={id} value={value} onChange={e => router.push(`/store/${e.target.value}${sub}`)}>
      {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}
