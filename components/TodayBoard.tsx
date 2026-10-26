import type { Lineup } from '@/lib/todayBoard';

/** 今日・明日の出勤（入り時間の早い順） */
export default function TodayBoard({ days }: { days: { title: string; l: Lineup }[] }) {
  return (
    <section className="today">
      {days.map(({ title, l }) => (
        <div key={l.iso} className="today-card">
          <div className="today-head">
            <b>{title}</b><span>{l.md}({l.wd})</span>
            {!l.confirmed && <em>未確定</em>}
            <span className={`today-count${l.total < l.need ? ' bad' : ''}`}>{l.total}人{l.need ? ` / 必要${l.need}人` : ''}</span>
          </div>
          {l.staff.length > 0 && (
            <div className="today-row staff"><span className="t">社員</span><span className="n">{l.staff.map(p => p.note ? `${p.name}（${p.note}）` : p.name).join('、')}</span></div>
          )}
          {l.slots.length === 0 && <p className="today-none">アルバイトの出勤はありません</p>}
          {l.slots.map(s => (
            <div key={s.time} className="today-row">
              <span className={`t${s.time === '時間未定' ? ' tbd' : ''}`}>{s.time === '時間未定' ? '時間未定' : `${s.time}〜`}</span>
              <span className="n">{s.people.map((p, k) => <span key={k} className="who">{p.name}{p.note && <small>{p.note}</small>}</span>)}</span>
            </div>
          ))}
          {l.away.length > 0 && <p className="today-away">ほかの店へヘルプ：{l.away.map(a => `${a.name}（${a.to}）`).join('、')}</p>}
        </div>
      ))}
    </section>
  );
}
