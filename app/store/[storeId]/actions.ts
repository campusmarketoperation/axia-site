'use server';
import { revalidatePath } from 'next/cache';
import { requireViewer, storeForEdit, storeForHelp } from '@/lib/auth';
import { diffsOf, helpAvailability, lendOf, loadGrid, MEMO_MAX, periodMemoLabels, splitOf } from '@/lib/data';
import { approveHelpRow, deleteHelpRow, requestHelpRow, setHelpTimeRow } from '@/lib/help';
import { helpInfo, notifyHelpDeclined } from '@/lib/notify';
import { db } from '@/lib/supabase/admin';
import { iso, parseISO, periodDays, periodLabel, periodStartOf, todayJST } from '@/lib/period';
import { image, push, text, type LineMessage } from '@/lib/line';
import { randomUUID } from 'crypto';
import { shiftText } from '@/lib/messages';
import { NOTE_MAX, staffOffOptions } from '@/lib/shift';
import { CONFIRMED_MSG, confirmedOn } from '@/lib/confirm';
import { actorOf, logChange, logHelp, type LogRow } from '@/lib/history';
import { cellLabel } from '@/lib/shift';
import { deadlineOf, saveDeadline } from '@/lib/deadline';

async function memberOf(storeId: string, memberId: string) {
  const { data } = await db().from('members').select('id, store_id').eq('id', memberId).maybeSingle();
  if (!data || data.store_id !== storeId) throw new Error('この店舗のメンバーではありません');
}

/** マスを書き換える。value が null なら店長の変更を消して希望に戻す */
export async function setCell(storeId: string, memberId: string, date: string, value: string | null) {
  const v = await requireViewer();
  const store = await storeForEdit(v, storeId);
  if (value?.startsWith('→') && v.role !== 'manager') throw new Error('本部の画面では、ヘルプは見るだけです');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('日付がおかしいです');
  if (value !== null && (typeof value !== 'string' || value.length > 60)) throw new Error('この値は選べません');
  if (await confirmedOn(storeId, date)) throw new Error(CONFIRMED_MSG);
  const { data: m } = await db().from('members').select('id, store_id, kind, extra_store_ids').eq('id', memberId).maybeSingle();
  if (!m) throw new Error('この店舗のメンバーではありません');
  if (m.store_id !== storeId) {
    // かけもちの社員（ほかの店がメイン）：この店で出勤／メインに戻す／休みだけ
    if (m.kind !== 'staff' || !(m.extra_store_ids ?? []).includes(storeId)) throw new Error('この店舗のメンバーではありません');
    if (value !== null && value !== `@${storeId}` && !staffOffOptions(store).includes(value)) throw new Error('この値は選べません');
  } else if (value?.startsWith('@') && !(m.extra_store_ids ?? []).includes(value.slice(1))) {
    throw new Error('兼務していない店です');
  }
  // かけもちの社員：関わっている店（メイン・兼務先）のどれかが確定済みなら変えられない
  const related = m.kind === 'staff' ? Array.from(new Set([m.store_id, ...(m.extra_store_ids ?? [])])).filter(id => id !== storeId) : [];
  for (const sid of related) {
    if (await confirmedOn(sid, date)) {
      const { data: os } = await db().from('stores').select('name').eq('id', sid).maybeSingle();
      throw new Error(`${os?.name ?? 'ほかの店'}が確定済みのため変えられません`);
    }
  }
  const { data: cur } = await db().from('shifts').select('value').eq('member_id', memberId).eq('date', date).maybeSingle();
  if (value === null) await db().from('shifts').delete().eq('member_id', memberId).eq('date', date);
  else await db().from('shifts').upsert({ member_id: memberId, date, value, updated_at: new Date().toISOString() });
  // 履歴：この店と、かけもちで関わる店の両方に残す
  const names = related.length ? Object.fromEntries(((await db().from('stores').select('id, name').in('id', [storeId, ...related])).data ?? []).map((r: any) => [r.id, r.name])) : { [storeId]: store.name };
  const lbl = (x: string | null | undefined) => x == null ? (m.kind === 'staff' ? '出勤（空白）' : '本人の希望') : x.startsWith('@') ? `→${names[x.slice(1)] ?? '他店'}` : x === '' ? '出勤（空白）' : cellLabel(x);
  const before = lbl(cur?.value ?? null), after = lbl(value);
  if (before !== after) {
    const actor = await actorOf(v);
    await logChange([storeId, ...related].map(sid => ({ store_id: sid, member_id: memberId, date, kind: 'cell', before, after, actor } as LogRow)));
  }
  return { ok: true };
}

/** 締め切り：バイトの人が、その期間の希望を変えられなくなる（店長はシフト表を変えられる） */
export async function setLock(storeId: string, start: string, locked: boolean) {
  const v = await requireViewer();
  await storeForEdit(v, storeId);
  if (!locked && await confirmedOn(storeId, start)) return { ok: false, message: '確定済みです。先に「確定を外す」を押してください' };
  await db().from('period_locks').upsert({ store_id: storeId, period_start: start, locked });
  await logChange([{ store_id: storeId, date: start, kind: 'lock', note: locked ? '締め切った' : '締め切りを外した', actor: await actorOf(v) }]);
  // 締め切り日（当日を含む）以降に締め切ったら、バイト全員にLINEで知らせる（1期間1回）
  let notified = 0;
  if (locked && iso(todayJST()) >= await deadlineOf(storeId, start)) {
    const { data: lk } = await db().from('period_locks').select('lock_notified_at').eq('store_id', storeId).eq('period_start', start).maybeSingle();
    if (!lk?.lock_notified_at) {
      await db().from('period_locks').update({ lock_notified_at: new Date().toISOString() }).eq('store_id', storeId).eq('period_start', start);
      const store = await storeForEdit(v, storeId);
      const lbl = periodLabel(parseISO(start), splitOf(store));
      const { data: ms } = await db().from('members').select('line_user_id').eq('store_id', storeId).eq('kind', 'part').eq('active', true).not('line_user_id', 'is', null);
      const body = `【締め切り】\n${lbl} のシフトは締め切りました。\n変更がある時は、店長に直接連絡してください。`;
      for (const m of ms ?? []) if (await push(m.line_user_id!, [text(body)], store.company_id)) notified++;
    }
  }
  revalidatePath(`/store/${storeId}`);
  return { ok: true, notified };
}

/** 確定：店長もシフト表（時間・ヘルプ）を変えられなくなる。確定すると締め切りにもなる */
export async function setConfirmed(storeId: string, start: string, confirmed: boolean) {
  const v = await requireViewer();
  await storeForEdit(v, storeId);
  await db().from('period_locks').upsert(confirmed ? { store_id: storeId, period_start: start, locked: true, confirmed: true } : { store_id: storeId, period_start: start, confirmed: false });
  await logChange([{ store_id: storeId, date: start, kind: 'confirm', note: confirmed ? '確定した' : '確定を外した', actor: await actorOf(v) }]);
  revalidatePath(`/store/${storeId}`, 'layout');
  return { ok: true };
}

/** 確定シフトを一人ずつLINEで送る */
export async function sendConfirmed(storeId: string, start: string, img?: { full: string; preview: string } | null) {
  const v = await requireViewer();
  const store = await storeForEdit(v, storeId);
  const g = await loadGrid(store, parseISO(start));
  // シフト全体の画像：Storage に置いて、LINE の画像メッセージで送る（ファイル名はランダム）
  let pic: LineMessage | null = null;
  let imageError = img?.full ? '' : '画面で画像を作れませんでした';
  if (img?.full && img.preview) {
    try {
      const base = `${storeId}/${start}/${randomUUID()}`;
      const bucket = db().storage.from('shift-images');
      const up = async (name: string, b64: string) => {
        const buf = Buffer.from(String(b64), 'base64');
        // JPEG 以外・大きすぎるものは置かない（公開の置き場所なので）
        if (buf.length < 4 || buf.length > 8e6 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new Error('画像の形式がおかしいです');
        const { error } = await bucket.upload(`${base}-${name}.jpg`, buf, { contentType: 'image/jpeg', upsert: true });
        if (error) throw error;
        return bucket.getPublicUrl(`${base}-${name}.jpg`).data.publicUrl;
      };
      pic = image(await up('full', img.full), await up('preview', img.preview));
    } catch (e) {
      console.error('shift image upload', e);
      const m = (e as { message?: string })?.message ?? String(e);
      imageError = /bucket|not found/i.test(m) ? '画像の置き場所がありません（Supabase で 012_shift_images.sql を流してください）' : `画像を保存できませんでした：${m}`;
    }
  }
  const missing: string[] = [], failed: string[] = [];
  let sent = 0;
  // 社員には確定シフトの写真だけ（写真が作れなかった時は送らない）
  for (const r of g.staff) {
    if (!r.member.line_user_id) { missing.push(r.member.name); continue; }
    if (!pic) continue;
    const ok = await push(r.member.line_user_id, [pic], store.company_id);
    if (ok) sent++; else failed.push(r.member.name);
  }
  for (const r of g.parts) {
    if (!r.member.line_user_id) { missing.push(r.member.name); continue; }
    const t = shiftText(g, r.member.id);
    if (!t) continue;
    const ok = await push(r.member.line_user_id, pic ? [text(t), pic] : [text(t)], store.company_id);
    if (ok) sent++; else failed.push(r.member.name);
  }
  await logChange([{ store_id: storeId, date: start, kind: 'confirm', note: `${g.confirmed ? '' : '確定して'}全員にLINEで送った（${sent}人）`, actor: await actorOf(v) }]);
  // 送る＝確定（まだなら確定して締め切りにもする）
  await db().from('period_locks').upsert({ store_id: storeId, period_start: start, locked: true, confirmed: true, sent_at: new Date().toISOString() });
  return { sent, failed, missing, image: !!pic, imageError };
}

/** ヘルプを取り消す */
export async function removeHelp(storeId: string, helpId: string) {
  const v = await requireViewer();
  await storeForHelp(v, storeId);
  const { data: h } = await db().from('help_assignments').select('*').eq('id', helpId).maybeSingle();
  if (!h || (h.to_store !== storeId && h.from_store !== storeId)) throw new Error('見つかりません');
  if (h.status === 'approved' && (await confirmedOn(h.from_store, h.date) || await confirmedOn(h.to_store, h.date))) throw new Error('どちらかの店のその期間が確定済みのため取り消せません（「確定を外す」と取り消せます）');
  await logHelp(helpId, '取り消した', await actorOf(v));
  await deleteHelpRow(helpId);
  revalidatePath(`/store/${storeId}`, 'layout');
  return { ok: true };
}

/** ヘルプの依頼を承認する（所属店の店長） */
export async function approveHelp(storeId: string, helpId: string) {
  const v = await requireViewer();
  await storeForHelp(v, storeId);
  const { data: h } = await db().from('help_assignments').select('from_store').eq('id', helpId).maybeSingle();
  if (!h || h.from_store !== storeId) return { ok: false, message: '見つかりません' };
  const r = await approveHelpRow(helpId);
  if (r.ok) await logHelp(helpId, '承認した', await actorOf(v));
  revalidatePath(`/store/${storeId}`, 'layout');
  return r;
}

/** ヘルプの依頼を断る（所属店の店長） */
export async function declineHelp(storeId: string, helpId: string) {
  const v = await requireViewer();
  await storeForHelp(v, storeId);
  const { data: h } = await db().from('help_assignments').select('from_store, status').eq('id', helpId).maybeSingle();
  if (!h || h.from_store !== storeId) return { ok: false, message: '見つかりません' };
  const hi = await helpInfo(helpId);
  await logHelp(helpId, '断った', await actorOf(v));
  await deleteHelpRow(helpId);
  if (hi) await notifyHelpDeclined(hi);
  revalidatePath(`/store/${storeId}`, 'layout');
  return { ok: true, message: '断りました' };
}

/** ヘルプの入り時間を決める（ヘルプ先の店長） */
export async function setHelpTime(storeId: string, helpId: string, startLabel: string) {
  const v = await requireViewer();
  await storeForHelp(v, storeId);
  const { data: h } = await db().from('help_assignments').select('to_store').eq('id', helpId).maybeSingle();
  if (!h || h.to_store !== storeId) return { ok: false, message: '見つかりません' };
  const { data: old } = await db().from('help_assignments').select('start_label').eq('id', helpId).maybeSingle();
  const r = await setHelpTimeRow(helpId, startLabel.trim().slice(0, 20));
  if (r.ok) await logHelp(helpId, '入り時間を決めた', await actorOf(v), { before: old?.start_label || '未定', after: startLabel.trim().slice(0, 20) || '未定' });
  revalidatePath(`/store/${storeId}`, 'layout');
  return r;
}

/** 店長が近隣の店のヘルプOKの人に、自分の店のヘルプを頼む */
export async function requestHelp(storeId: string, memberId: string, date: string) {
  const v = await requireViewer();
  const store = await storeForHelp(v, storeId);
  const { data: m } = await db().from('members').select('store_id').eq('id', memberId).maybeSingle();
  if (!m) return { ok: false, message: '見つかりません' };
  const { data: nb } = await db().from('store_neighbors').select('neighbor_id').eq('store_id', storeId).eq('neighbor_id', m.store_id).maybeSingle();
  if (!nb) return { ok: false, message: '近隣の店の人だけ頼めます' };
  const { data: fromStore } = await db().from('stores').select('*').eq('id', m.store_id).maybeSingle();
  if (!fromStore || fromStore.company_id !== store.company_id) return { ok: false, message: '見つかりません' };
  // その日に本当に行けるか（ヘルプOK・自分の店に入っていない・相手の店が足りている）を確かめ直す
  const g = await loadGrid(fromStore, periodStartOf(parseISO(date), splitOf(fromStore)));
  const i = g.days.findIndex(d => d.iso === date);
  const p = helpAvailability(g).find(x => x.memberId === memberId);
  const c = i >= 0 && p ? p.cells[i] : null;
  if (!c || !c.free) return { ok: false, message: 'その日は行けない人です' };
  if (!lendOf(g)[i]) return { ok: false, message: diffsOf(g)[i] < 0 ? `${fromStore.name}もその日は人が足りていません` : `${fromStore.name}の店長が、その日はヘルプに出せないにしています` };
  const r = await requestHelpRow(memberId, storeId, date, `${store.name}の店長`);
  if (r.ok) { const actor = await actorOf(v); await logChange([m.store_id, storeId].map(sid => ({ store_id: sid, member_id: memberId, date, kind: 'help' as const, note: `${store.name}へのヘルプ：依頼した`, actor }))); }
  revalidatePath(`/store/${storeId}`, 'layout');
  return r;
}

/** 提出の締め切り日を決める（当日の夜に自動でリマインドが行く） */
export async function setDeadline(storeId: string, periodStart: string, deadline: string) {
  const v = await requireViewer();
  await storeForEdit(v, storeId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return { ok: false, message: '日付がおかしいです' };
  if (!(await saveDeadline(storeId, periodStart, deadline))) return { ok: false, message: '保存できませんでした（Supabase で 020 の SQL を実行したか確認してください）' };
  revalidatePath(`/store/${storeId}`);
  const d = new Date(`${deadline}T00:00:00Z`);
  return { ok: true, message: `締め切りを ${d.getUTCMonth() + 1}/${d.getUTCDate()} にしました。この日の夜10時ごろに自動でリマインドします` };
}

/** 提出のお願いをLINEで送る（全員・未提出の人・選んだ人） */
export async function sendReminder(storeId: string, memberIds: string[], message: string) {
  const v = await requireViewer();
  const store = await storeForEdit(v, storeId);
  const body = message.trim().slice(0, 1000);
  if (!body) return { ok: false, message: '文面を入れてください', sent: 0, missing: [] as string[] };
  if (!memberIds.length) return { ok: false, message: '送る人を選んでください', sent: 0, missing: [] as string[] };
  const { data: ms } = await db().from('members').select('id, name, line_user_id').eq('store_id', storeId).eq('active', true).in('id', memberIds);
  let sent = 0;
  const missing: string[] = [], failed: string[] = [];
  for (const m of ms ?? []) {
    if (!m.line_user_id) { missing.push(m.name); continue; }
    if (await push(m.line_user_id, [text(body)], store.company_id)) sent++; else failed.push(m.name);
  }
  return {
    ok: true, sent, missing,
    message: `${sent}人にLINEで送りました。` + (missing.length ? ` LINE未登録：${missing.join('、')}` : '') + (failed.length ? ` 送れなかった人：${failed.join('、')}` : ''),
  };
}

/** 店長がその期間の「他の店のヘルプもOK」を付け外しする */
export async function setHelpOk(storeId: string, memberId: string, periodStart: string, ok: boolean) {
  const v = await requireViewer();
  await storeForHelp(v, storeId);
  await memberOf(storeId, memberId);
  if (await confirmedOn(storeId, periodStart)) throw new Error(CONFIRMED_MSG);
  await db().from('period_help').upsert({ member_id: memberId, period_start: periodStart, help_ok: ok, answered: true });
  revalidatePath(`/store/${storeId}`, 'layout');
  return { ok: true };
}

/** その日をヘルプに「出せる／出せない／自動」にする（ok が null なら自動に戻す） */
export async function setLend(storeId: string, date: string, ok: boolean | null) {
  const v = await requireViewer();
  await storeForHelp(v, storeId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付がおかしいです');
  if (await confirmedOn(storeId, date)) throw new Error(CONFIRMED_MSG);
  if (ok === null) await db().from('store_lend_days').delete().eq('store_id', storeId).eq('date', date);
  else await db().from('store_lend_days').upsert({ store_id: storeId, date, ok });
  return { ok: true };
}

/** その期間のメモの行（名前の一覧）を保存する */
async function saveMemoLabels(storeId: string, periodStart: string, labels: string[]) {
  await db().from('period_locks').upsert({ store_id: storeId, period_start: periodStart, memo_labels: labels }, { onConflict: 'store_id,period_start' });
  revalidatePath(`/store/${storeId}`);
}

/** メモの行の名前（その期間だけ。line は1から。空にすると「メモ」と表示） */
export async function setMemoLabel(storeId: string, periodStart: string, line: number, label: string) {
  const v = await requireViewer();
  const store = await storeForEdit(v, storeId);
  const cur = await periodMemoLabels(store, periodStart);
  if (!Number.isInteger(line) || line < 1 || line > cur.length) return { ok: false, label: '' };
  const t = label.replace(/\s+/g, ' ').trim().slice(0, 8);
  cur[line - 1] = t;
  await saveMemoLabels(storeId, periodStart, cur);
  return { ok: true, label: t };
}

/** メモの行を画像に載せる（みんなに送る）か。その期間だけ */
export async function setMemoShared(storeId: string, periodStart: string, line: number, shared: boolean) {
  const v = await requireViewer();
  const store = await storeForEdit(v, storeId);
  const labels = await periodMemoLabels(store, periodStart);
  if (!Number.isInteger(line) || line < 1 || line > labels.length) return { ok: false };
  const { data } = await db().from('period_locks').select('memo_shared, memo_labels').eq('store_id', storeId).eq('period_start', periodStart).maybeSingle();
  const cur = labels.map((_, i) => (data?.memo_shared as boolean[] | null)?.[i] ?? true);
  cur[line - 1] = shared;
  await db().from('period_locks').upsert({ store_id: storeId, period_start: periodStart, memo_shared: cur, memo_labels: data?.memo_labels ?? labels }, { onConflict: 'store_id,period_start' });
  return { ok: true };
}

/** メモの行を1つ増やす（その期間だけ） */
export async function addMemoRow(storeId: string, periodStart: string) {
  const v = await requireViewer();
  const store = await storeForEdit(v, storeId);
  const cur = await periodMemoLabels(store, periodStart);
  if (cur.length >= MEMO_MAX) return { ok: false, message: `メモは${MEMO_MAX}行までです` };
  await saveMemoLabels(storeId, periodStart, [...cur, '']);
  return { ok: true, message: 'メモの行を追加しました（この期間だけ）' };
}

/** 一番下のメモの行を消す（その期間だけ。その行に書いたメモも消える） */
export async function removeMemoRow(storeId: string, periodStart: string) {
  const v = await requireViewer();
  const store = await storeForEdit(v, storeId);
  const cur = await periodMemoLabels(store, periodStart);
  if (cur.length <= 1) return { ok: false, message: 'メモは1行は残ります' };
  const ds = periodDays(parseISO(periodStart), splitOf(store)).map(iso);
  await db().from('store_memos').delete().eq('store_id', storeId).eq('line', cur.length).gte('date', ds[0]).lte('date', ds[ds.length - 1]);
  await saveMemoLabels(storeId, periodStart, cur.slice(0, -1));
  return { ok: true, message: '一番下のメモの行を消しました（この期間だけ）' };
}

/** 日ごとのメモ（line は1から。空にすると消す） */
export async function setNote(storeId: string, date: string, note: string, line = 1) {
  const v = await requireViewer();
  const store = await storeForEdit(v, storeId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付がおかしいです');
  if (!Number.isInteger(line) || line < 1 || line > MEMO_MAX) throw new Error('メモの行がおかしいです');
  // メモを書いた期間は、今の行の形をその期間に固定する（ほかの期間で行を減らしても消えないように）
  const ps = iso(periodStartOf(parseISO(date), splitOf(store)));
  const { data: lk } = await db().from('period_locks').select('memo_labels').eq('store_id', storeId).eq('period_start', ps).maybeSingle();
  if (!lk?.memo_labels) await saveMemoLabels(storeId, ps, await periodMemoLabels(store, ps, null));
  const t = note.replace(/\r/g, '').trim().slice(0, NOTE_MAX);
  if (!t) await db().from('store_memos').delete().eq('store_id', storeId).eq('date', date).eq('line', line);
  else await db().from('store_memos').upsert({ store_id: storeId, date, line, note: t, updated_at: new Date().toISOString() });
  return { ok: true, note: t };
}

/** その人の「ヘルプに行ける店」を決める（ids が null＝決めていない＝どの店でもOK） */
export async function setMemberHelpStores(storeId: string, memberId: string, ids: string[] | null) {
  const v = await requireViewer();
  const store = await storeForHelp(v, storeId);
  await memberOf(storeId, memberId);
  let clean: string[] | null = null;
  if (ids) {
    const { data } = await db().from('stores').select('id').eq('company_id', store.company_id).neq('id', storeId).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    clean = (data ?? []).map(s => s.id);
  }
  await db().from('members').update({ help_stores: clean }).eq('id', memberId);
  // 行ける店を決めたら、今の期間とこれからの期間（確定前）にすぐ反映する：
  // 本人が「行けない」と答えていた期間も、店長の設定を優先してヘルプOKにする
  if (clean && clean.length) {
    const cur = iso(periodStartOf(todayJST(), splitOf(store)));
    const { data: done } = await db().from('period_locks').select('period_start').eq('store_id', storeId).eq('confirmed', true).gte('period_start', cur);
    const skip = new Set((done ?? []).map(r => r.period_start as string));
    const { data: rows } = await db().from('period_help').select('period_start').eq('member_id', memberId).eq('help_ok', false).gte('period_start', cur);
    const keys = (rows ?? []).map(r => r.period_start as string).filter(k => !skip.has(k));
    if (keys.length) await db().from('period_help').update({ help_ok: true }).eq('member_id', memberId).in('period_start', keys);
  }
  revalidatePath(`/store/${storeId}`, 'layout');
  return { ok: true };
}

/* ───── 他店から借りたヘルプ（名前で手入力） ───── */
async function guestOf(storeId: string, guestId: string) {
  const { data } = await db().from('help_guests').select('id, store_id, period_start').eq('id', guestId).maybeSingle();
  if (!data || data.store_id !== storeId) throw new Error('見つかりません');
  return data;
}

/** 借りる人を追加（その期間の表に1行増える） */
export async function addGuest(storeId: string, periodStart: string, name: string, fromStore: string) {
  const v = await requireViewer();
  await storeForHelp(v, storeId);
  if (await confirmedOn(storeId, periodStart)) return { ok: false, message: CONFIRMED_MSG, id: '', name: '' };
  const f = fromStore.trim().slice(0, 20);
  let n = name.trim().slice(0, 20);
  if (!n) {
    // 名前なし：「ヘルプ1」「ヘルプ2」…と番号を付ける
    const { count } = await db().from('help_guests').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('period_start', periodStart);
    n = `ヘルプ${(count ?? 0) + 1}`;
  }
  const { data, error } = await db().from('help_guests').insert({ store_id: storeId, period_start: periodStart, name: n, from_store: f }).select('id').single();
  if (error || !data) return { ok: false, message: '追加できませんでした（Supabase で 028 の SQL を実行したか確認してください）', id: '', name: '' };
  revalidatePath(`/store/${storeId}`);
  return { ok: true, message: `${n}${f ? `（${f}）` : ''}を追加しました。来る日のマスを押して時間を入れてください`, id: data.id as string, name: n };
}

/** 借りた人のマス（value が空なら消す） */
export async function setGuestCell(storeId: string, guestId: string, date: string, value: string) {
  const v = await requireViewer();
  await storeForHelp(v, storeId);
  await guestOf(storeId, guestId);
  if (await confirmedOn(storeId, date)) throw new Error(CONFIRMED_MSG);
  const t = value.trim().slice(0, 12);
  if (!t) await db().from('help_guest_days').delete().eq('guest_id', guestId).eq('date', date);
  else await db().from('help_guest_days').upsert({ guest_id: guestId, date, value: t });
  return { ok: true };
}

/** 借りた人を表から外す */
export async function removeGuest(storeId: string, guestId: string) {
  const v = await requireViewer();
  await storeForHelp(v, storeId);
  const g = await guestOf(storeId, guestId);
  if (await confirmedOn(storeId, g.period_start)) return { ok: false, message: CONFIRMED_MSG };
  await db().from('help_guests').delete().eq('id', guestId);
  revalidatePath(`/store/${storeId}`);
  return { ok: true, message: '外しました' };
}
