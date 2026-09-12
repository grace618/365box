/** 开放起点（含）；可写日期还须 ≥ 北京时间「今天」；无结束日 */
export const START_DATE = "2026-09-15";

/** 网页年切换：最早年为 START_DATE 所在年；最晚为当年 + 此偏移 */
export const MAX_YEAR_OFFSET = 3;

/** next_empty_dates 不传 count 时的默认条数；传 count 时上限 */
export const NEXT_EMPTY_DEFAULT = 90;
export const NEXT_EMPTY_MAX = 366;
