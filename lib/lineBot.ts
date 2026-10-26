// LINEボットの中身（GAS版 line.gs の移植。1つのボットで全部の会社・店舗を受け付ける）
import { db } from './supabase/admin';
import { lineName, reply, text, type LineMessage } from './line';
import { clean, norm, parseMessage, yesNo } from './lineParse';
import { companyActive, getStore, loadGrid, splitOf } from './data';
import { addDays, iso, label, md, nextStartOf, parseISO, periodDays, periodLabel, periodStartOf, todayJST, utc, WD } from './period';
import { getMine, isLocked, saveRequests, type DayVal } from './requests';
import { memberText, shiftText } from './messages';
import { shortTime, type Member, type Store } from './shift';
import { inviteStaffSelf } from './invite';
import { logEvent } from './events';

type Event = {
  type: string; replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
};

const ASK_CODE = 'お店の「登録コード」（6けたの数字）を送ってください。店長に聞くと教えてもらえます。';

// コードの打ち間違い：15分で5回まで（総当たり防止）
const NG_MAX = 5, NG_WINDOW = 15 * 60e3;
const NG_LOCKED = 'コードの打ち間違いが続いたので、しばらく受け付けを止めています。15分ほどたってから、店長に確認したコードを送ってください。';
async function ngLocked(uid: string): Promise<boolean> {
  const { data } = await db().from('line_users').select('ng_count, ng_since').eq('line_user_id', uid).maybeSingle();
  if (!data?.ng_since) return false;
  return (data.ng_count ?? 0) >= NG_MAX && Date.now() - new Date(data.ng_since).getTime() < NG_WINDOW;
}
async function ngHit(uid: string) {
  const { data } = await db().from('line_users').select('ng_count, ng_since').eq('line_user_id', uid).maybeSingle();
  const fresh = !data?.ng_since || Date.now() - new Date(data.ng_since).getTime() >= NG_WINDOW;
  await db().from('line_users').upsert({
    line_user_id: uid, ng_count: fresh ? 1 : (data!.ng_count ?? 0) + 1,
    ng_since: fresh ? new Date().toISOString() : data!.ng_since,
  });
}

export async function handleEvent(ev: Event) {
  if (!ev.replyToken || ev.source?.type !== 'user' || !ev.source.userId) return;
  const uid = ev.source.userId;
  if (ev.type === 'follow') { await reply(ev.replyToken, [text(`友だち追加ありがとうございます。シフトの受付です。\n\n${ASK_CODE}`)]); return; }
  if (ev.type !== 'message' || ev.message?.type !== 'text') return;
  const t = norm(ev.message.text ?? '');
  const out = await respond(uid, t);
  await reply(ev.replyToken, out.messages, out.companyId);
}

async function respond(uid: string, t: string): Promise<{ messages: LineMessage[]; companyId?: string }> {
  // 店長・本部の LINE 通知をつなぐ：「通知 123456」
  const lk = t.replace(/\s+/g, ' ').match(/^通知 ?(\d{6})$/);
  if (lk) {
    if (await ngLocked(uid)) return { messages: [text(NG_LOCKED)] };
    const { data: p } = await db().from('profiles').select('user_id, role, company_id, store_id, stores:store_id(name)').eq('line_link_code', lk[1]).maybeSingle();
    if (!p) { await ngHit(uid); return { messages: [text('そのコードが見つかりません。画面の「LINEでつなぐ」をもう一度押して、新しいコードを送ってください。')] }; }
    await db().from('profile_lines').upsert({ user_id: p.user_id, line_user_id: uid, name: (await lineName(uid)) || null });
    await db().from('profiles').update({ line_link_code: null }).eq('user_id', p.user_id);
    const who = p.role === 'hq' ? '本部' : `${(p as any).stores?.name ?? ''}の社員`;
    return { messages: [text(`${who}として、LINE通知をつなぎました。ヘルプの依頼や承認がここに届きます。\n（同じアカウントに、ほかの人のLINEもつなげます）`)], companyId: p.company_id };
  }
  const { data: me } = await db().from('members').select('*, stores(*)').eq('line_user_id', uid).eq('active', true).maybeSingle();

  // 名前の登録し直し
  if (/^(名前変更|登録し直す|店を変える)$/.test(t)) {
    if (me) await db().from('members').update({ line_user_id: null }).eq('id', me.id);
    await db().from('line_users').upsert({ line_user_id: uid, store_id: null, updated_at: new Date().toISOString() });
    return { messages: [text(`登録を外しました。\n${ASK_CODE}`)] };
  }

  if (!me) return register(uid, t);

  const store = (me as any).stores as Store;
  const member = me as Member;
  const isStaff = member.kind === 'staff';

  // ヘルプに行ける店（登録の続き・「ヘルプの店」で決め直し）
  const { data: lu0 } = await db().from('line_users').select('step').eq('line_user_id', uid).maybeSingle();
  if (!isStaff && (lu0?.step === 'help_stores' || /^(ヘルプの店|ヘルプ先|ヘルプに行ける店)$/.test(t))) {
    return helpStoresStep(uid, member, store, lu0?.step === 'help_stores' && !/^(ヘルプの店|ヘルプ先|ヘルプに行ける店)$/.test(t) ? t : null);
  }
  if (!(await companyActive(store.company_id))) return { messages: [text('このお店のシフト受付は止まっています。店長に確認してください。')] };
  const cid = store.company_id;
  const split = splitOf(store);
  const next = iso(nextStartOf(periodStartOf(todayJST(), split), split));

  if (/^(使い方|つかいかた|help)$/i.test(t)) return { messages: [text(isStaff ? STAFF_NOTE(member.name, store.name) : usage(store))], companyId: cid };
  if (/メンバー/.test(t)) return { messages: [text(await memberReply(store, t, isStaff ? member : null))], companyId: cid };
  if (!isStaff && /^(番号|バイト番号|ばんごう)$/.test(t)) {
    const { data: pm } = await db().from('members').select('pin').eq('id', member.id).maybeSingle();
    return { messages: [text(`${member.name}さんのバイト番号は「${pm?.pin ?? '----'}」です。\nシフトの提出画面で、最初にこの番号を入れてください。`)], companyId: cid };
  }
  if (/^(確定|確定シフト|シフト|シフト確認|今のシフト|かくてい)$/.test(t)) {
    const keys = [iso(periodStartOf(todayJST(), split)), next];
    const parts = await Promise.all(keys.map(async k => {
      const g = await loadGrid(store, parseISO(k));
      return g.confirmed ? shiftText(g, member.id) ?? '' : `【${g.label}】\nまだ確定していません`;
    }));
    return { messages: [text(parts.join('\n\n'))], companyId: cid };
  }
  // 社員の「確認」：今と次の期間の、自分のシフト（確定前も見れる）
  if (isStaff && /^(確認|かくにん)$/.test(t)) {
    const keys = [iso(periodStartOf(todayJST(), split)), next];
    const parts = await Promise.all(keys.map(async k => {
      const g = await loadGrid(store, parseISO(k));
      const s0 = shiftText(g, member.id) ?? '';
      return g.confirmed ? s0 : s0.replace('【確定シフト', '【作成中のシフト').replace('変更がある時は店長に直接連絡してください', 'まだ確定していません（変わることがあります）');
    }));
    return { messages: [text(parts.join('\n\n'))], companyId: cid };
  }
  // 社員：ログイン用アカウントを作る（「アカウント」→ メールアドレス）
  if (isStaff && (lu0?.step === 'account_email' || /^(アカウント|アカウント登録|ログイン|ログイン登録)$/.test(t))) {
    if (lu0?.step !== 'account_email' || /^(アカウント|アカウント登録|ログイン|ログイン登録)$/.test(t)) {
      await db().from('line_users').update({ step: 'account_email' }).eq('line_user_id', uid);
      return { messages: [text('シフト表を見たり変えたりできる、社員用のログインを作ります。\nログインに使うメールアドレスを送ってください。\n（やめる時は「やめる」）')], companyId: cid };
    }
    if (/^(やめる|キャンセル|中止)$/.test(t)) {
      await db().from('line_users').update({ step: null }).eq('line_user_id', uid);
      return { messages: [text('やめました。')], companyId: cid };
    }
    const r = await inviteStaffSelf(t, member, cid);
    if (r.ok) await db().from('line_users').update({ step: null }).eq('line_user_id', uid);
    return { messages: [text(r.message)], companyId: cid };
  }
  // 社員は希望を出さない：それ以外のことばには案内を返す
  if (isStaff) return { messages: [text(STAFF_NOTE(member.name, store.name))], companyId: cid };
  if (/^(確認|かくにん)$/.test(t)) {
    const after = iso(nextStartOf(parseISO(next), split));
    const a = await summary(member, store, next);
    const m2 = await getMine(member.id, after, split);
    return { messages: [text(m2.any ? `${a}\n\n${await summary(member, store, after)}` : a)], companyId: cid };
  }

  // ここから希望の入力
  const { data: lu } = await db().from('line_users').select('last_period').eq('line_user_id', uid).maybeSingle();
  const last = lu?.last_period ?? null;
  const helpOn = store.help_enabled !== false;
  const yn = last && helpOn ? yesNo(t) : null;
  const msgText = yn === 'yes' ? 'ヘルプOK' : yn === 'no' ? 'ヘルプNG' : t;
  const p = parseMessage(msgText, split, last, { from: store.time_from, to: store.time_to });
  // ヘルプを募集しない店：ヘルプの返事は受け付けない
  if (!helpOn && Object.keys(p.helpSet).length) {
    if (!Object.keys(p.changes).length && !Object.keys(p.fillRest).length) return { messages: [text('この店では、他の店へのヘルプの募集はしていません。')], companyId: cid };
    p.helpSet = {};
  }
  const keys = Array.from(new Set([...Object.keys(p.changes), ...Object.keys(p.helpSet), ...Object.keys(p.fillRest)])).sort();
  // 数字のないあいさつ・お礼（「送りました！」「ありがとう」など）には、エラーではなくひとこと返す
  if (!keys.length && !/\d/.test(t)) {
    if (/^(あとで|後で)(送る|おくる)?$/.test(t)) return { messages: [text('わかりました。締め切りまでに、残りの日も送ってください。')], companyId: cid };
    if (/(送りました|おくりました|出しました|提出しました|ありがと|了解|りょうかい|承知|よろしく|お願いします|お疲れ|おつかれ|はい|わかりました|分かりました|ok|おk|👍)/i.test(t))
      return { messages: [text('ありがとうございます！出した希望は「確認」で見られます。')], companyId: cid };
    return { messages: [text('シフトの希望は「27 5」「28 休み」のように、日にちと一緒に送ってください。\n（書き方の一覧は「使い方」）')], companyId: cid };
  }
  if (!keys.length) return { messages: [text(`読み取れませんでした。\n例）27 5 ／ 28 休み ／ 29 ○\n（書き方の一覧は「使い方」）`)], companyId: cid };
  const onlyHelp = !Object.keys(p.changes).length && !Object.keys(p.fillRest).length;

  const out: string[] = [];
  let lastKey = last;
  for (const key of keys) {
    const lbl = periodLabel(parseISO(key), split);
    if (await isLocked(store.id, key)) { out.push(`${lbl} は締め切り済みのため変更できません。店長に直接連絡してください。`); continue; }
    const cur = await getMine(member.id, key, split);
    // 初めての提出で、行ける日だけを並べてきた時は、書いてない日を✖にする
    if (p.okList[key] && !cur.any) { p.listStyle[key] = true; p.fillRest[key] = true; }
    const days: Record<string, DayVal | null> = p.listStyle[key] ? {} : { ...cur.days };
    Object.entries(p.changes[key] ?? {}).forEach(([d, v]) => { if (v) days[d] = v as DayVal; else delete days[d]; });
    if (p.fillRest[key]) periodDays(parseISO(key), split).forEach(d => { if (!days[iso(d)]) days[iso(d)] = { s: 'ng' }; });
    const helpOk = key in p.helpSet ? p.helpSet[key] : undefined;
    await saveRequests(member.id, key, split, days, { replace: true, helpOk, source: 'LINE' });
    if (onlyHelp) {
      out.push(`【${lbl}】\n` + (helpOk ? '他の店のヘルプ：行ける' : '他の店のヘルプ：行けない（行けるようになったら「ヘルプOK」と送ってください）'));
    } else {
      lastKey = key;
      out.push(await summary(member, store, key) + (p.listStyle[key] ? '\n\n書いてない日は✖にしました。違う日は「18 5」のように送れば直せます' : ''));
    }
  }
  if (p.errors.length) out.push(`読めなかった行：${p.errors.join("／")}\n（書き方は「使い方」）`);
  await db().from('line_users').upsert({ line_user_id: uid, store_id: store.id, last_period: lastKey, updated_at: new Date().toISOString() });

  // まだ入れていない日が残っている → 「ほかの日は全部✖でいいですか？」とボタンで聞く
  let blanks = 0;
  if (!onlyHelp && lastKey && !(await isLocked(store.id, lastKey))) {
    const mine = await getMine(member.id, lastKey, split);
    blanks = periodDays(parseISO(lastKey), split).filter(d => !mine.days[iso(d)]).length;
  }
  if (blanks > 0) {
    return { messages: [text(`${out.join('\n\n')}\n\nまだ入れていない日が${blanks}日あります。ほかの日は全部✖でいいですか？`, [['はい、全部✖', '残り休み'], ['あとで送る', 'あとで送る']])], companyId: cid };
  }
  const messages = [text(out.join('\n\n'))];
  // シフトを出したあと、その期間のヘルプをまだ答えていない／行ける日を並べて出し直した → 聞く
  if (helpOn && member.help_stores == null && !onlyHelp && lastKey && !(lastKey in p.helpSet) && !(await isLocked(store.id, lastKey))) {
    const { data: h } = await db().from('period_help').select('answered').eq('member_id', member.id).eq('period_start', lastKey).maybeSingle();
    if (!h?.answered || p.listStyle[lastKey]) {
      messages.push(text(`${periodLabel(parseISO(lastKey), split)} は、他の店のヘルプに行ってもいいですか？`, [['行ける', 'ヘルプOK'], ['行けない', 'ヘルプNG']]));
    }
  }
  return { messages, companyId: cid };
}

/** 登録：コード → 名前 */
async function register(uid: string, t: string): Promise<{ messages: LineMessage[]; companyId?: string }> {
  if (/^\d{6}$/.test(t)) {
    if (await ngLocked(uid)) return { messages: [text(NG_LOCKED)] };
    const { data: s } = await db().from('stores').select('*').eq('join_code', t).maybeSingle();
    if (!s || !(await companyActive(s.company_id))) { await ngHit(uid); return { messages: [text('そのコードのお店が見つかりません。店長にもう一度確認してください。')] }; }
    await db().from('line_users').upsert({ line_user_id: uid, store_id: s.id, step: null, updated_at: new Date().toISOString() });
    await db().from('line_users').update({ ng_count: 0, ng_since: null }).eq('line_user_id', uid);
    return { messages: [text(`${s.name}ですね。次に名前を教えてください。\n\n${await memberList(s.id)}`)], companyId: s.company_id };
  }
  const { data: lu } = await db().from('line_users').select('store_id, step').eq('line_user_id', uid).maybeSingle();
  if (!lu?.store_id) return { messages: [text(ASK_CODE)] };
  const { data: s } = await db().from('stores').select('*').eq('id', lu.store_id).maybeSingle();
  if (!s) return { messages: [text(ASK_CODE)] };
  // 社員として登録する時は、店長から聞いた4けたの社員番号で本人確認する（なりすまし防止）
  const sp = /^staff_pin:([0-9a-f-]{36}):(\d+)$/.exec(lu.step ?? '');
  if (sp) {
    const [, mid, triedStr] = sp;
    const tried = +triedStr;
    if (/^(やめる|キャンセル|中止)$/.test(t)) {
      await db().from('line_users').update({ step: null }).eq('line_user_id', uid);
      return { messages: [text(`やめました。名前を選び直してください。\n\n${await memberList(s.id)}`)], companyId: s.company_id };
    }
    const { data: sm } = await db().from('members').select('id, name, pin, line_user_id, kind').eq('id', mid).eq('store_id', s.id).eq('active', true).maybeSingle();
    if (sm && /^\d{4}$/.test(t)) {
      if (sm.pin === t && (!sm.line_user_id || sm.line_user_id === uid)) {
        await db().from('members').update({ line_user_id: uid }).eq('id', sm.id);
        await db().from('line_users').update({ step: null }).eq('line_user_id', uid);
        return { messages: [text(STAFF_NOTE(sm.name, s.name, true))], companyId: s.company_id };
      }
      if (tried + 1 >= 5) {
        await db().from('line_users').update({ step: null }).eq('line_user_id', uid);
        await logEvent('other', `LINE 登録：${s.name}の社員「${sm.name}」の番号を5回まちがえました`, s.company_id, 'warn');
        return { messages: [text('番号を5回まちがえたので、いったん止めました。店長に社員番号を確かめてから、もう一度名前を選んでください。')], companyId: s.company_id };
      }
      await db().from('line_users').update({ step: `staff_pin:${mid}:${tried + 1}` }).eq('line_user_id', uid);
      return { messages: [text(`番号がちがいます（あと${4 - tried}回）。店長から聞いた4けたの社員番号を送ってください。やめる時は「やめる」。`)], companyId: s.company_id };
    }
    return { messages: [text('店長から聞いた4けたの社員番号を送ってください。やめる時は「やめる」。')], companyId: s.company_id };
  }
  const list = await pickMembers(s.id);
  let picked: { id: string; name: string; kind?: string; line_user_id: string | null } | undefined;
  if (/^\d+$/.test(t)) picked = list[+t - 1];
  picked = picked ?? list.find(m => m.name === t);
  const m = t.match(/^名前\s*[:：]?\s*(.{1,20})$/);
  if (!picked && m) {
    const name = m[1].trim();
    picked = list.find(x => x.name === name);
    if (!picked) {
      const { data: lastSort } = await db().from('members').select('sort').eq('store_id', s.id).order('sort', { ascending: false }).limit(1).maybeSingle();
      const { data: c } = await db().from('members').insert({ store_id: s.id, name, kind: 'part', sort: (lastSort?.sort ?? 0) + 1 }).select('id, name, kind, line_user_id').single();
      picked = c ?? undefined;
    }
  }
  if (!picked) return { messages: [text(`名前を選んでください。\n\n${await memberList(s.id)}`)], companyId: s.company_id };
  if (picked.line_user_id && picked.line_user_id !== uid) return { messages: [text(`${picked.name}さんは、もう別のLINEで登録されています。間違いなら店長に「LINEの登録を外して」と伝えてください。`)], companyId: s.company_id };
  if (picked.kind === 'staff' && picked.line_user_id !== uid) {
    await db().from('line_users').update({ step: `staff_pin:${picked.id}:0` }).eq('line_user_id', uid);
    return { messages: [text(`${picked.name}さん（社員）ですね。本人確認のため、店長から聞いた4けたの「社員番号」を送ってください。\n（店長はメンバーの画面の「番号」で見られます）`)], companyId: s.company_id };
  }
  await db().from('members').update({ line_user_id: uid }).eq('id', picked.id);
  if (picked.kind === 'staff') return { messages: [text(STAFF_NOTE(picked.name, s.name, true))], companyId: s.company_id };
  const { data: pm } = await db().from('members').select('pin').eq('id', picked.id).maybeSingle();
  const done = `${picked.name}さんで登録しました。` + (pm?.pin ? `\nバイト番号は「${pm.pin}」です（提出画面で使います）。` : '');
  const ask = await helpStoresQuestion(uid, s as Store);
  if (ask) return { messages: [text(done), ask], companyId: s.company_id };
  return { messages: [text(`${done}\n${hint(s as Store)}`)], companyId: s.company_id };
}

/** 社員：シフトの希望は出さない。確定シフトの写真とヘルプの通知だけ届く */
const STAFF_CMDS = [
  '使えることば',
  '・確認：今と次の期間の自分のシフト（確定前も）',
  '・確定シフト：確定した自分のシフト',
  '・メンバー：今日と明日の出勤メンバー（確定前も）',
  '　「明日のメンバー」「10/30 メンバー」でその日の分',
  '・アカウント：シフト表を見る・変えるログインを作る',
  '・登録し直す：名前や店を選び直す',
].join('\n');
const STAFF_NOTE = (name: string, store: string, first = false) => first
  ? `${name}さん（${store}の社員）で登録しました。\n確定シフトの写真とヘルプの通知が届きます。\n\n${STAFF_CMDS}`
  : `社員の方は希望の提出はいりません。\n\n${STAFF_CMDS}`;

/** 登録で選べる人：アルバイト → 社員の順 */
async function pickMembers(storeId: string) {
  const { data } = await db().from('members').select('id, name, kind, line_user_id').eq('store_id', storeId).eq('active', true).order('sort').order('created_at');
  const all = data ?? [];
  return [...all.filter(m => m.kind !== 'staff'), ...all.filter(m => m.kind === 'staff')];
}
async function memberList(storeId: string) {
  const list = await pickMembers(storeId);
  const lines = list.map((m, i) => `${i + 1}. ${m.name}${m.kind === 'staff' ? '（社員）' : ''}`);
  return (lines.length ? lines.join('\n') + '\n\n番号か名前を送ってください。' : '') + '\nリストにない人は「名前 山田」のように送ってください。';
}

/** 書き方の一覧（「使い方」と送った時）。短く */
function usage(store: Store) {
  const split = splitOf(store);
  const next = nextStartOf(periodStartOf(todayJST(), split), split);
  return [
    `次の期間：${periodLabel(next, split)}`,
    '27 5　→ 27日 5時から',
    '28 休み → 無理',
    '29 ○　→ 何時でも',
    '26,27,28 → 行ける日だけ（ほかは✖）',
    '残り休み → 空いてる日を全部✖',
    ...(store.help_enabled !== false ? ['ヘルプOK／ヘルプの店 → 他店のヘルプ'] : []),
    '確認・確定シフト・メンバー も使えます',
  ].join('\n');
}

/** ひとこと案内（登録した時・読めなかった時） */
function hint(store: Store) {
  const split = splitOf(store);
  const next = nextStartOf(periodStartOf(todayJST(), split), split);
  return `次の期間は ${periodLabel(next, split)} です。\n例）27 5 ／ 28 休み ／ 29 ○\n（書き方の一覧は「使い方」）`;
}

export async function summary(member: Member, store: Store, key: string) {
  const split = splitOf(store);
  const cur = await getMine(member.id, key, split);
  const lines = [`【${periodLabel(parseISO(key), split)}】${member.name}さんの希望`];
  const blank: string[] = [];
  periodDays(parseISO(key), split).forEach(d => {
    const o = cur.days[iso(d)];
    if (!o) { blank.push(md(d)); return; }
    lines.push(`${label(d)}　${o.s === 'ng' ? '✖' : o.st ? shortTime(o.st) : '○ 何時でもOK'}`);
  });
  if (lines.length === 1) lines.push('まだ何も入っていません');
  if (blank.length) lines.push('', `未入力 ${blank.length}日：${blank.join(' ')}`);
  return lines.join('\n');
}

/** 「メンバー」→ 今日と明日 ／「明日のメンバー」／「10/17 メンバー」 */
async function memberReply(store: Store, t: string, staff: Member | null = null) {
  const rest = clean(t).replace(/メンバー/g, '').replace(/[のは？?\s]/g, '');
  const today = todayJST();
  let days: Date[];
  if (!rest) days = [today, addDays(today, 1)];
  else if (/^(今日|きょう)$/.test(rest)) days = [today];
  else if (/^(明日|あした|あす)$/.test(rest)) days = [addDays(today, 1)];
  else if (/^(明後日|あさって)$/.test(rest)) days = [addDays(today, 2)];
  else {
    const m = rest.match(/^(?:(\d{1,2})[\/月])?(\d{1,2})日?$/);
    if (!m) return '日にちが読めませんでした。\n「メンバー」「明日のメンバー」「10/17 メンバー」のように送ってください';
    let d = m[1] ? utc(today.getUTCFullYear(), +m[1] - 1, +m[2]) : utc(today.getUTCFullYear(), today.getUTCMonth(), +m[2]);
    if (d < today) d = m[1] ? utc(today.getUTCFullYear() + 1, +m[1] - 1, +m[2]) : utc(today.getUTCFullYear(), today.getUTCMonth() + 1, +m[2]);
    days = [d];
  }
  const split = splitOf(store);
  // 社員：確定前でも今の中身を見られる。兼務していて、その日にほかの店で出勤するなら、その店のメンバー
  const extras = staff?.extra_store_ids ?? [];
  const texts = await Promise.all(days.map(async d => {
    const g = await loadGrid(store, periodStartOf(d, split));
    if (!staff) return memberText(g, iso(d));
    let target = g;
    const i = g.days.findIndex(x => x.iso === iso(d));
    const v = g.staff.find(r => r.member.id === staff.id)?.cells[i]?.value ?? '';
    if (v.startsWith('@') && v.slice(1) !== store.id && extras.includes(v.slice(1))) {
      const other = await getStore(v.slice(1));
      if (other && other.company_id === store.company_id) target = await loadGrid(other, periodStartOf(d, splitOf(other)), [d]);
    }
    return memberText(target, iso(d), { draft: true, showStore: extras.length > 0 });
  }));
  return texts.join('\n\n');
}


// ---- ヘルプに行ける店 ----
async function otherStores(store: Store) {
  const { data } = await db().from('stores').select('id, name').eq('company_id', store.company_id).neq('id', store.id).order('sort').order('created_at');
  return data ?? [];
}

/** 同じ会社にほかの店があって、ヘルプを募集している店なら、行ける店を聞く */
async function helpStoresQuestion(uid: string, store: Store): Promise<LineMessage | null> {
  if (store.help_enabled === false) return null;
  const others = await otherStores(store);
  if (!others.length) return null;
  await db().from('line_users').update({ step: 'help_stores' }).eq('line_user_id', uid);
  return text([
    'ほかの店が人手不足の時に、ヘルプに行ってもいい店を教えてください。',
    '',
    ...others.map((o, i) => `${i + 1}. ${o.name}`),
    '',
    '行ける店の番号を送ってください（例：1,3）。',
    '全部OKなら「全部」、どこも行かないなら「なし」',
    '（あとで「ヘルプの店」と送ると変えられます。店長も変えられます）',
  ].join('\n'), [['全部', '全部'], ['なし', 'なし']]);
}

async function helpStoresStep(uid: string, member: Member, store: Store, answer: string | null): Promise<{ messages: LineMessage[]; companyId?: string }> {
  const cid = store.company_id;
  if (answer === null) {
    const q = await helpStoresQuestion(uid, store);
    return { messages: [q ?? text('この店では、ほかの店へのヘルプの募集はしていません。')], companyId: cid };
  }
  const others = await otherStores(store);
  const a = clean(answer);
  let picked: { id: string; name: string }[] | null = null;
  if (/^(全部|すべて|全て|全店|どこでも|ok|OK|全部OK)$/.test(a)) picked = others;
  else if (/^(なし|無し|ない|無理|行かない|ng|NG|✖|×)$/.test(a)) picked = [];
  else {
    const nums = a.split(/[\s,，、・]+/).filter(Boolean);
    if (nums.length && nums.every(n => /^\d+$/.test(n) && +n >= 1 && +n <= others.length)) picked = nums.map(n => others[+n - 1]);
    else {
      const byName = nums.map(n => others.find(o => o.name === n)).filter(Boolean) as { id: string; name: string }[];
      if (byName.length === nums.length && nums.length) picked = byName;
    }
  }
  if (!picked) {
    return { messages: [text('読み取れませんでした。シフトを出す前に、先にこれに答えてください。\n行ける店の番号を「1,3」のように送るか、「全部」「なし」と送ってください。', [['全部', '全部'], ['なし', 'なし']])], companyId: cid };
  }
  await db().from('members').update({ help_stores: picked.map(p => p.id) }).eq('id', member.id);
  await db().from('line_users').update({ step: null }).eq('line_user_id', uid);
  const msg = picked.length ? `ヘルプに行ける店：${picked.map(p => p.name).join('、')}` : 'ほかの店へのヘルプには行かない、にしました';
  return { messages: [text(`${msg}\n（「ヘルプの店」で変えられます）\n\n${hint(store)}`)], companyId: cid };
}
