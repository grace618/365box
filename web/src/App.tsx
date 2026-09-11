import { useEffect, useMemo, useState } from "react";

type Status = {
  date: string;
  status: "locked" | "opened";
  has_box: boolean;
};

type BoxResult = {
  exists: boolean;
  locked?: boolean;
  opened?: boolean;
  ready?: boolean;
  date: string;
  unlock_at?: string;
  content?: string;
  prompt?: string | null;
  opened_at?: string | null;
  error?: string;
};

type Stats = {
  year?: number;
  total: number;
  locked: number;
  opened: number;
  empty: number;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function buildYearDays(year: number) {
  const days: string[] = [];
  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(`${year}-${pad2(month)}-${pad2(day)}`);
    }
  }
  return days;
}

function mondayBasedWeekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export default function App() {
  const [year, setYear] = useState(2027);
  const days = useMemo(() => buildYearDays(year), [year]);
  const calendarStart = `${year}-01-01`;
  const calendarEnd = `${year}-12-31`;
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [stats, setStats] = useState<Stats>({ total: 0, locked: 0, opened: 0, empty: 365 });
  const [selected, setSelected] = useState<BoxResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    number: index + 1,
    days: days.filter(date => Number(date.slice(5, 7)) === index + 1)
  })), [days]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const healthRes = await fetch("/api/health");
      if (!healthRes.ok) throw new Error("health failed");
      const health = await healthRes.json() as { year?: number };
      const nextYear = health.year ?? 2027;
      setYear(nextYear);
      const start = `${nextYear}-01-01`;
      const end = `${nextYear}-12-31`;

      const [calendarRes, statsRes] = await Promise.all([
        fetch(`/api/calendar?start=${start}&end=${end}`),
        fetch("/api/stats")
      ]);
      if (!calendarRes.ok || !statsRes.ok) {
        throw new Error("后端返回异常，请确认服务已启动");
      }
      const calendar: Status[] = await calendarRes.json();
      const next: Record<string, Status> = {};
      calendar.forEach(item => { next[item.date] = item; });
      setStatuses(next);
      setStats(await statsRes.json());
    } catch {
      setError("连不上后端。请先在项目根目录运行 npm run dev。");
      setStatuses({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function open(date: string) {
    const status = statuses[date];
    if (status?.status !== "opened") {
      const ok = window.confirm(`确定打开 ${date} 的盒子吗？打开后会标记为已开启。`);
      if (!ok) return;
    }

    try {
      setError(null);
      const res = await fetch(`/api/box/${date}/open`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) {
        setSelected({
          exists: false,
          date,
          error: result.error ?? "打开失败"
        });
        return;
      }
      setSelected(result);
      await load();
    } catch {
      setError("打开盒子失败，请检查后端是否在运行。");
    }
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

      {error && (
        <section className="bannerError" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>重试</button>
        </section>
      )}

      <section className="toolbar">
        <strong className="year">{year} 年日历</strong>
        <span className="range">{calendarStart} → {calendarEnd}</span>
      </section>

      <section className="legend">
        <span><i className="dot empty" /> 空盒</span>
        <span><i className="dot locked" /> 已写入 · 未开启</span>
        <span><i className="dot opened" /> 已开启</span>
      </section>

      <section className="calendar" aria-label={`${year} 年盲盒日历`}>
        {loading ? <div className="loading">正在打开日历……</div> : months.map(month => {
          const firstWeekday = mondayBasedWeekday(month.days[0]);
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
                      title={status?.has_box ? "点击打开" : "这个日期还没有盒子"}
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
            {selected.error ? (
              <>
                <div className="bigIcon">⚠️</div>
                <h2>打不开</h2>
                <p>{selected.date}</p>
                <div className="notice">{selected.error}</div>
              </>
            ) : !selected.exists ? (
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
