import { useEffect, useMemo, useState } from "react";

type Status = {
  date: string;
  status: "locked" | "opened";
  has_box: boolean;
};

type BoxResult = {
  exists: boolean;
  locked?: boolean;
  date: string;
  unlock_at?: string;
  content?: string;
  prompt?: string | null;
  opened_at?: string | null;
};

type Stats = {
  total: number;
  locked: number;
  opened: number;
  empty: number;
};

const API = "http://192.168.3.219:3001";
const CALENDAR_YEAR = 2027;
const CALENDAR_START = `${CALENDAR_YEAR}-01-01`;
const CALENDAR_END = `${CALENDAR_YEAR}-12-31`;
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function buildYearDays(year: number) {
  const start = new Date(Date.UTC(year, 0, 1));
  return Array.from({ length: 365 }, (_, i) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    return date.toISOString().slice(0, 10);
  });
}

export default function App() {
  const days = useMemo(() => buildYearDays(CALENDAR_YEAR), []);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [stats, setStats] = useState<Stats>({ total: 0, locked: 0, opened: 0, empty: 365 });
  const [selected, setSelected] = useState<BoxResult | null>(null);
  const [loading, setLoading] = useState(true);

  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    number: index + 1,
    days: days.filter(date => Number(date.slice(5, 7)) === index + 1)
  })), [days]);

  async function load() {
    setLoading(true);
    try {
      const [calendarRes, statsRes] = await Promise.all([
        fetch(`${API}/api/calendar?start=${CALENDAR_START}&end=${CALENDAR_END}`),
        fetch(`${API}/api/stats`)
      ]);
      const calendar: Status[] = await calendarRes.json();
      const next: Record<string, Status> = {};
      calendar.forEach(item => { next[item.date] = item; });
      setStatuses(next);
      setStats(await statsRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function open(date: string) {
    const result = await fetch(`${API}/api/box/${date}`).then(r => r.json());
    setSelected(result);
    await load();
  }

  return (
    <main className="page">
      <header>
        <div>
          <div className="eyebrow">365 DAY BOX</div>
          <h1>哥哥写给未来的盲盒</h1>
          <p className="sub">每一天一个盒子。未来的留言，等日期自己把锁打开。</p>
        </div>
        <div className="stats">
          <span>已准备 <b>{stats.total}</b></span>
          <span>已开启 <b>{stats.opened}</b></span>
          <span>空盒 <b>{stats.empty}</b></span>
        </div>
      </header>

      <section className="toolbar">
        <strong className="year">{CALENDAR_YEAR} 年日历</strong>
        <span className="range">{CALENDAR_START} → {CALENDAR_END}</span>
      </section>

      <section className="legend">
        <span><i className="dot empty" /> 空盒</span>
        <span><i className="dot locked" /> 已写入 · 未开启</span>
        <span><i className="dot opened" /> 已开启</span>
      </section>

      <section className="calendar" aria-label="2027 年盲盒日历">
        {loading ? <div className="loading">正在打开日历……</div> : months.map(month => {
          const firstWeekday = (new Date(`${month.days[0]}T00:00:00Z`).getUTCDay() + 6) % 7;
          return (
            <section className="month" key={month.number} aria-label={`${month.number} 月`}>
              <div className="monthHeading">
                <h2>{month.number} 月</h2>
                <span>{month.days.length} 天</span>
              </div>
              <div className="monthGrid">
                {WEEKDAYS.map(day => <span className="weekday" key={day}>{day}</span>)}
                {Array.from({ length: firstWeekday }, (_, index) => <span className="blank" key={`blank-${index}`} />)}
                {month.days.map(date => {
                  const status = statuses[date];
                  return (
                    <button
                      key={date}
                      className={["day", status?.has_box ? (status.status === "opened" ? "opened" : "locked") : "empty"].join(" ")}
                      onClick={() => status?.has_box && open(date)}
                      title={status?.has_box ? "点击查看" : "这个日期还没有盒子"}
                    >
                      <strong>{date.slice(8)}</strong>
                      <span>{status?.has_box ? (status.status === "opened" ? "🎁" : "🔒") : "＋"}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </section>

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)}>×</button>
            {!selected.exists ? (
              <>
                <div className="bigIcon">⬜</div>
                <h2>这个日期还没有盒子</h2>
                <p>{selected.date}</p>
              </>
            ) : selected.locked ? (
              <>
                <div className="bigIcon">🔒</div>
                <h2>还不能打开</h2>
                <p>{selected.date}</p>
                <div className="notice">等到这一天，盒子才会打开。</div>
              </>
            ) : (
              <>
                <div className="bigIcon">🎁</div>
                <h2>{selected.date}</h2>
                <div className="content">{selected.content}</div>
                {selected.prompt && <div className="prompt">提示：{selected.prompt}</div>}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
