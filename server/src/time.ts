/** 全站统一：北京时间（Asia/Shanghai，固定 +08:00） */

const TIME_ZONE = "Asia/Shanghai";

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

/** 今天的日历日：YYYY-MM-DD（北京） */
export function todayBeijingDate(date = new Date()): string {
  const map = shanghaiParts(date);
  return `${map.year}-${map.month}-${map.day}`;
}

/** 当前时刻：YYYY-MM-DDTHH:mm:ss+08:00 */
export function nowBeijingISO(date = new Date()): string {
  const map = shanghaiParts(date);
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+08:00`;
}

/** 某日历日零点（北京）：YYYY-MM-DDT00:00:00+08:00 */
export function beijingDayStartISO(date: string): string {
  return `${date}T00:00:00+08:00`;
}
