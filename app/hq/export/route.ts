// 本部：確定シフトを全店まとめて CSV で書き出す（Excel でそのまま開ける）
import { NextResponse } from 'next/server';
import { canManageCompany, getViewer } from '@/lib/auth';
import { companyStores, helpRows, loadGrid, splitOf } from '@/lib/data';
import { periodDays, periodFromParam } from '@/lib/period';
import { cellLabel, staffLabel, staffOffOptions } from '@/lib/shift';
import { db } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Excel で開いた時に式として動かないよう、= + - @ で始まる文字（数字だけは除く）の前に ' を付ける
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);
const esc = (raw: string) => { const s = safe(String(raw ?? '')); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v) return new NextResponse('ログインしてください', { status: 401 });
  const url = new URL(req.url);
  const companyId = v.isAdmin && url.searchParams.get('company') ? url.searchParams.get('company')! : v.companyId;
  if (!companyId || !canManageCompany(v, companyId)) return new NextResponse('権限がありません', { status: 403 });
  if (!v.isAdmin && v.companyStopped) return new NextResponse('ご利用が停止されています', { status: 403 });

  const stores = await companyStores(companyId);
  if (!stores.length) return new NextResponse('店舗がありません', { status: 404 });
  const split = splitOf(stores[0]);
  const start = periodFromParam(url.searchParams.get('p') ?? undefined, split);
  const days = periodDays(start, split);
  const grids = await Promise.all(stores.map(s => loadGrid(s, start, days)));
  const { data: co } = await db().from('companies').select('name').eq('id', companyId).maybeSingle();

  const g0 = grids[0];
  const head = ['店舗', '状態', '区分', '名前', ...g0.days.map(d => `${d.md}(${d.wd})`)];
  const lines: string[][] = [head];
  for (const g of grids) {
    const state = g.confirmed ? '確定' : g.locked ? '締め切り' : '受付中';
    g.parts.forEach(r => lines.push([g.store.name, state, 'アルバイト', r.member.name, ...r.cells.map(c => cellLabel(c.value))]));
    helpRows(g.helpIns.filter(h => h.status === 'approved')).forEach(r =>
      lines.push([g.store.name, state, `ヘルプ（${r.fromStore}から）`, r.memberName, ...g.days.map(d => r.byDate[d.iso] ? (r.byDate[d.iso].label || '○') : '')]));
    g.guests.forEach(x => lines.push([g.store.name, state, `ヘルプ（${x.from || '他店'}から）`, x.name, ...x.cells]));
    g.staff.forEach(r => lines.push([g.store.name, state, r.guest ? `社員（${g.storeNames[r.member.store_id] ?? ''}と兼務）` : '社員', r.member.name, ...r.cells.map(c => staffLabel(c.value, r.member, g.store.id, g.storeNames, staffOffOptions(g.store)))]));
    lines.push([g.store.name, state, '', '出れる人数', ...g.counts.map(String)]);
    lines.push([g.store.name, state, '', '必要人数', ...g.needs.map(String)]);
    g.memos.forEach((row, k) => { if (row.some(Boolean)) lines.push([g.store.name, state, '', g.memoLabels[k] || 'メモ', ...row]); });
  }
  // 先頭の BOM で、Excel が文字化けせずに開ける
  const csv = '﻿' + lines.map(l => l.map(x => esc(x ?? '')).join(',')).join('\r\n');
  const name = `シフト_${co?.name ?? ''}_${g0.days[0].iso}〜${g0.days[g0.days.length - 1].iso}.csv`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="shift.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
