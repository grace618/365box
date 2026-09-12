import { useEffect, useMemo, useRef, useState } from "react";

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
  headline?: string;
};

type Stats = {
  year?: number;
  total: number;
  locked: number;
  opened: number;
  empty: number;
};

type Health = {
  ok: boolean;
  today: string;
  now?: string;
  timezone?: string;
  utc_offset?: string;
  start_date?: string;
  year?: number;
  min_year?: number;
  max_year?: number;
  auth_required?: boolean;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const TOKEN_KEY = "365box_token";

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

/** 日历日加减（按 YYYY-MM-DD，与时区无关） */
function shiftDate(date: string, deltaDays: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** 网页只能打开：今天 + 前 6 天（共 7 天，北京时间「今天」） */
const WEB_OPEN_LOOKBACK_DAYS = 6;

function isWithinWebOpenWindow(date: string, today: string) {
  if (!today) return false;
  const earliest = shiftDate(today, -WEB_OPEN_LOOKBACK_DAYS);
  return date >= earliest && date <= today;
}

function authHeaders(token: string): HeadersInit {
  if (!token.trim()) return {};
  return { Authorization: `Bearer ${token.trim()}` };
}

export default function App() {
  const [year, setYear] = useState<number | null>(null);
  const [minYear, setMinYear] = useState(2026);
  const [maxYear, setMaxYear] = useState(2029);
  const [startDate, setStartDate] = useState("2026-09-15");
  const days = useMemo(() => (year == null ? [] : buildYearDays(year)), [year]);
  const calendarStart = year == null ? "" : `${year}-01-01`;
  const calendarEnd = year == null ? "" : `${year}-12-31`;
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [stats, setStats] = useState<Stats>({ total: 0, locked: 0, opened: 0, empty: 0 });
  const [selected, setSelected] = useState<BoxResult | null>(null);
  const [confirmDate, setConfirmDate] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [now, setNow] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [tokenDraft, setTokenDraft] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");

  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    number: index + 1,
    days: days.filter(date => Number(date.slice(5, 7)) === index + 1)
  })), [days]);

  async function loadYearData(viewYear: number, nextToken: string, silent: boolean) {
    const start = `${viewYear}-01-01`;
    const end = `${viewYear}-12-31`;
    const headers = authHeaders(nextToken);

    const [calendarRes, statsRes] = await Promise.all([
      fetch(`/api/calendar?start=${start}&end=${end}`, { headers }),
      fetch(`/api/stats?year=${viewYear}`, { headers })
    ]);
    if (calendarRes.status === 401 || statsRes.status === 401) {
      throw new Error("token 无效或未提供");
    }
    if (!calendarRes.ok || !statsRes.ok) {
      throw new Error("后端返回异常，请确认服务已启动");
    }
    const calendar: Status[] = await calendarRes.json();
    const next: Record<string, Status> = {};
    calendar.forEach(item => { next[item.date] = item; });
    setStatuses(next);
    setStats(await statsRes.json());
    if (!silent) setLoading(false);
  }

  async function load(nextToken = token, options?: { silent?: boolean; keepYear?: boolean }) {
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    setError(null);
    try {
      const healthRes = await fetch("/api/health");
      if (!healthRes.ok) throw new Error("health failed");
      const health = await healthRes.json() as Health;
      const todayStr = health.today ?? "";
      setToday(todayStr);
      setNow(health.now ?? "");
      setAuthRequired(Boolean(health.auth_required));
      if (health.start_date) setStartDate(health.start_date);
      const nextMin = health.min_year ?? Number((health.start_date ?? "2026-09-15").slice(0, 4));
      const nextMax = health.max_year ?? (Number(todayStr.slice(0, 4)) || nextMin) + 3;
      setMinYear(nextMin);
      setMaxYear(nextMax);

      const defaultYear = health.year ?? Number(todayStr.slice(0, 4)) || nextMin;
      const viewYear = options?.keepYear && year != null
        ? Math.min(nextMax, Math.max(nextMin, year))
        : Math.min(nextMax, Math.max(nextMin, defaultYear));
      setYear(viewYear);

      if (health.auth_required && !nextToken.trim()) {
        setStatuses({});
        setStats({ total: 0, locked: 0, opened: 0, empty: 0 });
        setError("服务已开启鉴权，请先填写访问 token。");
        return;
      }

      await loadYearData(viewYear, nextToken, silent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "连不上后端。请先在项目根目录运行 npm run dev。");
      if (!silent) setStatuses({});
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首次拉取
  }, []);

  const skipYearEffect = useRef(true);

  useEffect(() => {
    if (year == null) return;
    if (skipYearEffect.current) {
      skipYearEffect.current = false;
      return;
    }
    if (authRequired && !token.trim()) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadYearData(year, token, false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载日历失败");
          setStatuses({});
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  function saveToken() {
    const value = tokenDraft.trim();
    localStorage.setItem(TOKEN_KEY, value);
    setToken(value);
    void load(value, { keepYear: true });
  }

  function changeYear(delta: number) {
    if (year == null) return;
    const next = year + delta;
    if (next < minYear || next > maxYear) return;
    setYear(next);
  }

  async function openBoxRequest(date: string) {
    try {
      setOpening(true);
      setError(null);
      const res = await fetch(`/api/box/${date}/open`, {
        method: "POST",
        headers: authHeaders(token)
      });
      const result = await res.json() as BoxResult & { error?: string };
      if (!res.ok) {
        setConfirmDate(null);
        setSelected({
          exists: false,
          date,
          error: result.error ?? "打开失败"
        });
        return;
      }
      setConfirmDate(null);
      setSelected(result);
      if (result.exists && !result.locked) {
        setStatuses(prev => ({
          ...prev,
          [date]: { date, status: "opened", has_box: true }
        }));
      }
      if (year != null) {
        try {
          await loadYearData(year, token, true);
        } catch {
          /* 静默刷新失败不影响已打开内容 */
        }
      }
    } catch {
      setError("打开盒子失败，请检查后端是否在运行。");
      setConfirmDate(null);
    } finally {
      setOpening(false);
    }
  }

  function open(date: string) {
    const status = statuses[date];
    if (!status?.has_box) return;

    // 未到解锁日
    if (today && date > today) {
      setSelected({
        exists: true,
        locked: true,
        date,
        unlock_at: `${date}T00:00:00+08:00`
      });
      return;
    }

    // 网页：仅今天及前 6 天可打开/查看（含已开启）
    if (!isWithinWebOpenWindow(date, today)) {
      setSelected({
        exists: true,
        date,
        headline: "已超出可打开范围",
        error: "网页只能打开或查看今天及前 6 天的盒子（共 7 天）。"
      });
      return;
    }

    if (status.status === "opened") {
      void openBoxRequest(date);
      return;
    }

    setConfirmDate(date);
  }

  const clockText = useMemo(() => {
    if (!now) return today ? `北京时间 ${today}` : "";
    const m = now.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    if (!m) return `北京时间 ${now}`;
    return `北京时间 ${m[1]} ${m[2]}`;
  }, [now, today]);

  return (
    <main className="page">
      <header>
        <div>
          <div className="eyebrow">365 DAY BOX</div>
          <h1>写给未来的盲盒</h1>
          <p className="sub">每一天一个盒子。未来的留言，等日期自己把锁打开。</p>
          {clockText && <p className="timeMeta">{clockText}</p>}
          {startDate && <p className="timeMeta">开放起点 {startDate}</p>}
        </div>
        <div className="stats">
          <span>已准备 <b>{stats.total}</b></span>
          <span>已开启 <b>{stats.opened}</b></span>
          <span>空盒 <b>{stats.empty}</b></span>
        </div>
      </header>

      {authRequired && (
        <section className="authBar">
          <label>
            访问 Token
            <input
              type="password"
              value={tokenDraft}
              onChange={e => setTokenDraft(e.target.value)}
              placeholder="Authorization Bearer token"
              autoComplete="off"
            />
          </label>
          <button type="button" onClick={saveToken}>保存并刷新</button>
        </section>
      )}

      {error && (
        <section className="bannerError" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load(token, { keepYear: true })}>重试</button>
        </section>
      )}

      <section className="toolbar">
        <div className="yearNav">
          <button
            type="button"
            className="yearBtn"
            disabled={year == null || year <= minYear}
            onClick={() => changeYear(-1)}
          >
            上一年
          </button>
          <strong className="year">{year ?? "—"} 年日历</strong>
          <button
            type="button"
            className="yearBtn"
            disabled={year == null || year >= maxYear}
            onClick={() => changeYear(1)}
          >
            下一年
          </button>
        </div>
        <span className="range">{calendarStart} → {calendarEnd}</span>
      </section>

      <section className="legend">
        <span><i className="dot empty" /> 空盒</span>
        <span><i className="dot locked" /> 已写入 · 未开启</span>
        <span><i className="dot opened" /> 已开启</span>
        <span className="legendNote">网页仅可打开/查看近 7 天（今天及前 6 天）</span>
      </section>

      <section className="calendar" aria-label={`${year ?? ""} 年盲盒日历`}>
        {loading || year == null ? <div className="loading">正在打开日历……</div> : months.map(month => {
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
                  const canOpenOnWeb = isWithinWebOpenWindow(date, today);
                  return (
                    <button
                      key={date}
                      className={["day", status?.has_box ? (status.status === "opened" ? "opened" : "locked") : "empty"].join(" ")}
                      onClick={() => status?.has_box && open(date)}
                      title={
                        !status?.has_box
                          ? "这个日期还没有盒子"
                          : today && date > today
                            ? "点击打开"
                            : canOpenOnWeb
                              ? (status.status === "opened" ? "点击查看" : "点击打开")
                              : "超出网页可打开范围（近 7 天）"
                      }
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

      {confirmDate && (
        <div className="overlay" onClick={() => !opening && setConfirmDate(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="close" type="button" disabled={opening} onClick={() => setConfirmDate(null)}>×</button>
            <div className="bigIcon">🔒</div>
            <h2>打开这个盒子？</h2>
            <p>{confirmDate}</p>
            <div className="modalActions">
              <button type="button" className="btnGhost" disabled={opening} onClick={() => setConfirmDate(null)}>
                取消
              </button>
              <button type="button" className="btnPrimary" disabled={opening} onClick={() => void openBoxRequest(confirmDate)}>
                {opening ? "打开中…" : "确认打开"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && !confirmDate && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)}>×</button>
            {selected.error ? (
              <>
                <div className="bigIcon">⚠️</div>
                <h2>{selected.headline ?? "打不开"}</h2>
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
                <p>{selected.date}（北京时间）</p>
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
