#!/usr/bin/env node
/**
 * GAS版の書き出し（export-from-gas.gs で作った JSON）→ Supabase に流す SQL を作る
 *
 *   node scripts/gas-to-sql.mjs <書き出したJSON> --store <店舗のID> [--with-line] > import.sql
 *
 *  - 店舗のIDは、運営画面か本部画面で店舗を作ったあと、店長画面のURL /store/<ID> の部分
 *  - できた import.sql を Supabase の SQL Editor に貼って Run
 *  - 何回流しても大丈夫（同じ名前のメンバーは作り直さず、希望・シフトは上書き）
 *  - --with-line：LINE登録も移す。新しいボットが「前と同じプロバイダー」のチャネルの時だけ使う
 *    （LINEのユーザーIDはプロバイダーごとに違うので、別のプロバイダーだとつながらない）
 */
import fs from 'fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--store');
const storeId = args[args.indexOf('--store') + 1];
const withLine = args.includes('--with-line');
if (!file || !storeId || !/^[0-9a-f-]{36}$/i.test(storeId)) {
  console.error('使い方: node scripts/gas-to-sql.mjs <書き出したJSON> --store <店舗のID> [--with-line] > import.sql');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (data.version !== 1) { console.error('書き出しの形式が違います'); process.exit(1); }

const q = s => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const shortTime = t => {
  if (!t) return '○';
  const [h, m] = String(t).split(':').map(Number);
  return `${h > 12 ? h - 12 : h}${m ? ':' + String(m).padStart(2, '0') : ''}〜`;
};
const hhmm = t => {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${+m[1]}:${m[2]}` : null;
};

// メンバー：メンバーシートの順 → 回答だけある人 → 期間シートにだけいる人。社員は最後
const staff = new Set(data.staff || []);
const order = [];
const add = (name, kind) => { if (name && !order.some(o => o.name === name)) order.push({ name, kind }); };
(data.members || []).forEach(n => add(n, staff.has(n) ? 'staff' : 'part'));
(data.requests || []).forEach(r => add(r.name, staff.has(r.name) ? 'staff' : 'part'));
(data.sheets || []).forEach(s => s.rows.forEach(r => add(r.name, r.kind === 'staff' || staff.has(r.name) ? 'staff' : 'part')));
(data.staff || []).forEach(n => add(n, 'staff'));
const parts = order.filter(o => o.kind === 'part'), staffs = order.filter(o => o.kind === 'staff');
const all = [...parts, ...staffs];

const out = [];
out.push('-- AXIA Shift：GAS版からの移行（' + (data.storeName || '') + '）', 'begin;');
out.push(`do $$ begin if not exists (select 1 from stores where id = ${q(storeId)}) then raise exception '店舗が見つかりません：${storeId}'; end if; end $$;`);

// 店舗の設定
const times = data.times || [];
if (Array.isArray(data.split) && data.split.length === 2) {
  out.push(`update stores set split1 = ${+data.split[0]}, split2 = ${+data.split[1]}` +
    (times.length ? `, time_from = ${q(times[0])}, time_to = ${q(times[times.length - 1])}` : '') +
    (data.staffOptions?.length ? (() => { const isOff = x => /休|有給/.test(x) || ['✖', '×'].includes(x); const off = data.staffOptions.filter(isOff), on = data.staffOptions.filter(x => !isOff(x)); return `, staff_options = array[${on.map(q).join(',')}]::text[], staff_off_options = array[${(off.length ? off : ['休', '有給']).map(q).join(',')}]::text[]`; })() : '') +
    ` where id = ${q(storeId)};`);
}

// メンバー（同じ店に同じ名前の人がいれば作らない）
all.forEach((m, i) => {
  out.push(`insert into members (store_id, name, kind, sort) select ${q(storeId)}, ${q(m.name)}, ${q(m.kind)}, ${i + 1} ` +
    `where not exists (select 1 from members where store_id = ${q(storeId)} and name = ${q(m.name)} and active);`);
  out.push(`update members set sort = ${i + 1}, kind = ${q(m.kind)} where store_id = ${q(storeId)} and name = ${q(m.name)} and active;`);
});
const mid = name => `(select id from members where store_id = ${q(storeId)} and name = ${q(name)} and active limit 1)`;

// 希望
const reqKey = new Map();
(data.requests || []).forEach(r => {
  reqKey.set(`${r.name}|${r.date}`, r);
  out.push(`insert into requests (member_id, date, status, start_time) values (${mid(r.name)}, ${q(r.date)}, ${q(r.status)}, ${q(r.status === 'ok' ? hhmm(r.start) : null)}) ` +
    `on conflict (member_id, date) do update set status = excluded.status, start_time = excluded.start_time, updated_at = now();`);
});

// ヘルプOK
(data.help || []).forEach(h => {
  out.push(`insert into period_help (member_id, period_start, help_ok, answered) values (${mid(h.name)}, ${q(h.period)}, ${h.ok ? 'true' : 'false'}, true) ` +
    `on conflict (member_id, period_start) do update set help_ok = excluded.help_ok, answered = true;`);
});

// 期間シート：希望と違うところ＝店長が直したところだけ shifts に入れる
let shiftN = 0;
(data.sheets || []).forEach(s => {
  out.push(`insert into period_locks (store_id, period_start, locked) values (${q(storeId)}, ${q(s.period)}, ${s.locked ? 'true' : 'false'}) ` +
    `on conflict (store_id, period_start) do update set locked = excluded.locked;`);
  s.rows.forEach(row => {
    const isStaff = row.kind === 'staff' || staff.has(row.name);
    s.days.forEach((d, i) => {
      const cell = String(row.cells[i] ?? '').trim();
      let derived = '';
      if (!isStaff) {
        const r = reqKey.get(`${row.name}|${d}`);
        derived = !r ? '' : r.status === 'ng' ? '✖' : shortTime(hhmm(r.start));
      }
      if (cell === derived) return;
      shiftN++;
      out.push(`insert into shifts (member_id, date, value) values (${mid(row.name)}, ${q(d)}, ${q(cell)}) ` +
        `on conflict (member_id, date) do update set value = excluded.value, updated_at = now();`);
    });
  });
});

// LINE登録
if (withLine) {
  (data.line || []).forEach(l => {
    out.push(`update members set line_user_id = null where line_user_id = ${q(l.userId)};`);
    out.push(`update members set line_user_id = ${q(l.userId)} where id = ${mid(l.name)};`);
  });
}

out.push('commit;');
out.push(`-- メンバー ${all.length}人（社員 ${staffs.length}人） / 希望 ${(data.requests || []).length}件 / ヘルプOK ${(data.help || []).length}件 / 店長が直したマス ${shiftN}件 / 期間 ${(data.sheets || []).length}つ` + (withLine ? ` / LINE登録 ${(data.line || []).length}人` : ''));
process.stdout.write(out.join('\n') + '\n');
console.error(out[out.length - 1].replace(/^-- /, '作成しました：'));
