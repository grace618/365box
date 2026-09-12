import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createBoxSafe,
  deleteBoxSafe,
  updateBoxSafe,
  openBox,
  inspectBox,
  calendarStatus,
  getStats,
  getRangeStats,
  nextEmptyDates,
  exportBoxesJson,
  nowDateString,
  TARGET_YEAR
} from "./box.js";
import { MCP_INSTRUCTIONS } from "./mcp-docs.js";
import { nowBeijingISO } from "./time.js";

/** 默认 0.0.0.0，方便 MCP 客户端用局域网 IP 连接；只要本机可用 HOST=127.0.0.1 */
const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3002);
/** 设置后启用鉴权：Authorization: Bearer <token> 或 X-Box-Token / ?token= */
const AUTH_TOKEN = (process.env.AUTH_TOKEN ?? "").trim();

function lanIPv4Addresses() {
  const result: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) result.push(entry.address);
    }
  }
  return result;
}

const app = express();
app.use(cors({
  origin(origin, callback) {
    // 无 Origin（MCP / curl）或本机 / 局域网浏览器都放行
    if (!origin) return callback(null, true);
    try {
      const { hostname } = new URL(origin);
      const local =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
      callback(null, local);
    } catch {
      callback(null, false);
    }
  }
}));
app.use(express.json());

function errorCode(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorMessage(error: unknown) {
  const code = errorCode(error);
  const messages: Record<string, string> = {
    INVALID_DATE: "日期格式必须是 YYYY-MM-DD，且必须是真实存在的日历日",
    DATE_YEAR_INVALID: `只能创建 ${TARGET_YEAR} 年的盒子`,
    DATE_IN_PAST: "不能创建过去的日期",
    CONTENT_REQUIRED: "盒子内容不能为空",
    BOX_ALREADY_EXISTS: "这个日期已经有盒子了",
    BOX_NOT_FOUND: "这个日期没有盒子",
    BOX_ALREADY_OPENED: "盒子已经打开，不能修改",
    DATE_RANGE_INVALID: "开始日期不能晚于结束日期，请交换 start_date / end_date",
    UNAUTHORIZED: "未授权，请提供正确的 token（Authorization: Bearer … 或 X-Box-Token）"
  };
  return messages[code] ?? code;
}

/** 失败条目：给人看的 error + 机器用的 code（与 HTTP API 一致） */
function failResult(date: string, error: unknown) {
  return {
    date,
    ok: false as const,
    error: errorMessage(error),
    code: errorCode(error)
  };
}

function textJson(data: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(data, null, 2)
    }]
  };
}

function sendApiError(res: express.Response, error: unknown, status = 400) {
  res.status(status).json({
    ok: false,
    error: errorMessage(error),
    code: errorCode(error)
  });
}

function extractAuthToken(req: express.Request): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }
  const header = req.headers["x-box-token"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();
  const q = req.query.token;
  if (typeof q === "string" && q.trim()) return q.trim();
  return undefined;
}

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!AUTH_TOKEN) {
    next();
    return;
  }
  if (extractAuthToken(req) === AUTH_TOKEN) {
    next();
    return;
  }
  sendApiError(res, new Error("UNAUTHORIZED"), 401);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    today: nowDateString(),
    now: nowBeijingISO(),
    timezone: "Asia/Shanghai",
    utc_offset: "+08:00",
    year: TARGET_YEAR,
    auth_required: Boolean(AUTH_TOKEN)
  });
});

app.get("/api/stats", requireAuth, (_req, res) => {
  res.json(getStats());
});

app.get("/api/calendar", requireAuth, (req, res) => {
  try {
    const start = String(req.query.start ?? "0000-01-01");
    const end = String(req.query.end ?? "9999-12-31");
    res.json(calendarStatus(start, end));
  } catch (error) {
    sendApiError(res, error);
  }
});

/** 导出全部盒子 JSON（含正文） */
app.get("/api/export", requireAuth, (_req, res) => {
  const payload = exportBoxesJson();
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="365box-export-${payload.exported_at.slice(0, 10)}.json"`
  );
  res.json(payload);
});

/** 只读查看，不会标记已打开 */
app.get("/api/box/:date", requireAuth, (req, res) => {
  try {
    res.json(inspectBox(req.params.date));
  } catch (error) {
    sendApiError(res, error);
  }
});

/** 真正打开：到日会标记 opened */
app.post("/api/box/:date/open", requireAuth, (req, res) => {
  try {
    res.json(openBox(req.params.date));
  } catch (error) {
    sendApiError(res, error);
  }
});

function createMcpServer() {
  const server = new McpServer(
    {
      name: "365-day-box",
      version: "1.0.0"
    },
    {
      instructions: MCP_INSTRUCTIONS
    }
  );

  server.resource(
    "api_docs",
    "box://docs",
    {
      description: "给对接 AI 的操作说明：何时用哪个工具、怎么调用、出错怎么办",
      mimeType: "text/markdown"
    },
    async () => ({
      contents: [{
        uri: "box://docs",
        mimeType: "text/markdown",
        text: `# 365 Day Box MCP 接口说明

${MCP_INSTRUCTIONS}
`
      }]
    })
  );

  server.tool(
    "create_box",
    `往 ${TARGET_YEAR} 年今天或未来的空日期批量写入新盲盒。content=留言正文（必填）；prompt=可选创作方向/备注（不传也行，开盒时会原样返回，不影响解锁）。不能创建过去/非法日/非 ${TARGET_YEAR} 年；已有盒子不覆盖（改用 update_box）。出参 {results:[...]}，某条不合格只影响该条。`,
    {
      boxes: z.array(z.object({
        date: z.string().describe(`${TARGET_YEAR} 年今天或未来的真实日历日 YYYY-MM-DD，建议先 next_empty_dates`),
        content: z.string().nullish().describe("留言正文，必填；给到日打开的人看；缺了只让该条失败"),
        prompt: z.string().optional().describe("可选创作方向/备注；不传完全可以；存库，开盒时随 content 返回，不参与解锁")
      })).min(1).describe("要新建的盒子列表")
    },
    async ({ boxes }) => {
      const results = boxes.map(item => {
        try {
          const box = createBoxSafe(item.date, item.content ?? "", item.prompt);
          return { date: box.date, ok: true as const, status: "locked" as const };
        } catch (error) {
          return failResult(item.date, error);
        }
      });
      return textJson({ results });
    }
  );

  server.tool(
    "update_box",
    "批量修改尚未打开的盲盒。content 必填；prompt 可选（不传则保持原 prompt）。不存在或已打开会失败。不要用它新建。出参 {results:[...]}，某条不合格只影响该条。",
    {
      boxes: z.array(z.object({
        date: z.string().describe("已有盒子的日期 YYYY-MM-DD"),
        content: z.string().nullish().describe("新的留言正文，必填；缺了只让该条失败"),
        prompt: z.string().optional().describe("新的创作方向/备注；不传则保持原值")
      })).min(1).describe("要修改的盒子列表")
    },
    async ({ boxes }) => {
      const results = boxes.map(item => {
        try {
          const box = updateBoxSafe(item.date, item.content ?? "", item.prompt);
          return { date: box.date, ok: true as const, status: box.status };
        } catch (error) {
          return failResult(item.date ?? "", error);
        }
      });
      return textJson({ results });
    }
  );

  server.tool(
    "delete_box",
    "批量永久删除盲盒，不可恢复。入参 dates:[YYYY-MM-DD]。出参 {results:[...]}。",
    {
      dates: z.array(z.string()).min(1).describe("要删除的日期列表 YYYY-MM-DD")
    },
    async ({ dates }) => {
      const results = dates.map(date => {
        try {
          deleteBoxSafe(date);
          return {
            date,
            ok: true as const,
            deleted: true as const,
            message: "盲盒已删除，该日期现在是空盒。"
          };
        } catch (error) {
          return failResult(date, error);
        }
      });
      return textJson({ results });
    }
  );

  server.tool(
    "open_box",
    "按日期打开/查看盲盒。未到解锁日：只查看，locked=true，不改状态。已到解锁日且首次打开：返回 content 并标记 opened。已 opened 过：再读，不重复改状态。入参 dates:[YYYY-MM-DD]。出参 {results:[...]}。",
    {
      dates: z.array(z.string()).min(1).describe("要打开/查看的日期列表 YYYY-MM-DD")
    },
    async ({ dates }) => {
      const results = dates.map(date => {
        try {
          return { ok: true as const, ...openBox(date) };
        } catch (error) {
          return failResult(date, error);
        }
      });
      return textJson({ results });
    }
  );

  server.tool(
    "today_box",
    "打开今天的盲盒（北京时间）。规则同 open_box：未到日不改状态；到日首次打开会标 opened。无入参。出参 { results:[{ ok, ... }] }。",
    {},
    async () => {
      try {
        const result = openBox(nowDateString());
        return textJson({ results: [{ ok: true as const, ...result }] });
      } catch (error) {
        return textJson({
          results: [failResult(nowDateString(), error)]
        });
      }
    }
  );

  server.tool(
    "calendar_status",
    `查看日期范围内有盒日期及 locked/opened（无正文）。成功 { ok:true, stats, year_stats, dates }；失败（如 start>end）{ ok:false, error, code }，不抛 Step error。stats=本次范围；year_stats=固定 ${TARGET_YEAR} 整年。`,
    {
      start_date: z.string().optional().describe("开始日期 YYYY-MM-DD，默认今天"),
      end_date: z.string().optional().describe("结束日期 YYYY-MM-DD，默认等于 start_date；须 ≥ start_date")
    },
    async ({ start_date, end_date }) => {
      try {
        const start = start_date ?? nowDateString();
        const end = end_date ?? start;
        const status = calendarStatus(start, end);
        return textJson({
          ok: true as const,
          stats: getRangeStats(start, end),
          year_stats: getStats(),
          dates: status
        });
      } catch (error) {
        return textJson({
          ok: false as const,
          error: errorMessage(error),
          code: errorCode(error)
        });
      }
    }
  );

  server.tool(
    "next_empty_dates",
    `列出 ${TARGET_YEAR} 年还能写入的空日期（已自动排除过去的日期和已有盒子的日期）。写盒子前先调用。不传 count 返回全部可写空位；传 count(1–365) 返回前 N 个。`,
    {
      count: z.number().int().min(1).max(365).optional().describe("只要前 N 个空日期；不传=全部可写空位")
    },
    async ({ count }) => {
      const dates = nextEmptyDates(count);
      return textJson({ dates });
    }
  );

  server.tool(
    "export_boxes",
    "导出全部盲盒为 JSON（含 content/prompt/状态与时间戳），用于备份。无入参。出参 format=365box-export-v1。",
    {},
    async () => textJson(exportBoxesJson())
  );

  return server;
}

type SessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  queue: Promise<void>;
  /** 在途 POST 数；>0 时推迟因 onclose 触发的删除，避免并行请求踩空 */
  inflight: number;
  closing: boolean;
};

const sessions = new Map<string, SessionEntry>();

function normalizeSessionId(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 同一 session 上的并发 POST 串行化，避免 Streamable HTTP 并发串台 */
function enqueueSession(entry: SessionEntry, task: () => Promise<void>) {
  const run = entry.queue.then(task, task);
  entry.queue = run.then(() => undefined, () => undefined);
  return run;
}

async function destroySession(sessionId: string, entry: SessionEntry) {
  if (sessions.get(sessionId) === entry) {
    sessions.delete(sessionId);
  }
  try {
    await entry.transport.close();
  } catch {
    /* already closed */
  }
  try {
    await entry.server.close();
  } catch {
    /* already closed */
  }
}

function scheduleSessionCleanup(sessionId: string, entry: SessionEntry) {
  entry.closing = true;
  if (entry.inflight > 0) return;
  void destroySession(sessionId, entry);
}

async function handleStatelessMcp(
  req: express.Request,
  res: express.Response
) {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

async function createStatefulSession(
  req: express.Request,
  res: express.Response
) {
  const server = createMcpServer();
  let entry: SessionEntry | undefined;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: id => {
      entry = {
        transport,
        server,
        queue: Promise.resolve(),
        inflight: 0,
        closing: false
      };
      sessions.set(id, entry);
    }
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (!sid) return;
    const current = sessions.get(sid);
    if (current && current.transport === transport) {
      scheduleSessionCleanup(sid, current);
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp", requireAuth, async (req, res) => {
  try {
    const sessionId = normalizeSessionId(req.headers["mcp-session-id"]);

    // initialize：允许带过期/未知 session id（客户端重连常见），一律建新会话
    if (isInitializeRequest(req.body)) {
      if (sessionId && sessions.has(sessionId)) {
        const old = sessions.get(sessionId)!;
        await destroySession(sessionId, old);
      }
      await createStatefulSession(req, res);
      return;
    }

    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      if (entry.closing) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: 会话正在关闭，请重新 initialize"
          },
          id: null
        });
        return;
      }

      entry.inflight += 1;
      try {
        await enqueueSession(entry, async () => {
          await entry.transport.handleRequest(req, res, req.body);
        });
      } finally {
        entry.inflight -= 1;
        if (entry.closing && entry.inflight === 0) {
          void destroySession(sessionId, entry);
        }
      }
      return;
    }

    // 无 session：一次性调用（兼容直接 tools/call）
    if (!sessionId) {
      await handleStatelessMcp(req, res);
      return;
    }

    // 带了已失效的 session id：对工具调用降级为无状态，避免并行竞态下整批失败
    // （客户端仍应重新 initialize；此降级保证偶发失效时当次请求仍可用）
    console.warn(`mcp-session-id 已失效，降级无状态处理: ${sessionId}`);
    await handleStatelessMcp(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "MCP request failed" },
        id: null
      });
    }
  }
});

app.get("/mcp", requireAuth, async (req, res) => {
  const sessionId = normalizeSessionId(req.headers["mcp-session-id"]);
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing mcp-session-id");
    return;
  }
  // GET 是长连接 SSE，不能进 POST 串行队列，否则客户端开着 SSE 时 tools/* 会一直等到超时
  const entry = sessions.get(sessionId)!;
  await entry.transport.handleRequest(req, res);
});

app.delete("/mcp", requireAuth, async (req, res) => {
  const sessionId = normalizeSessionId(req.headers["mcp-session-id"]);
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing mcp-session-id");
    return;
  }
  const entry = sessions.get(sessionId)!;
  await destroySession(sessionId, entry);
  res.status(204).end();
});

const webDist =
  process.env.WEB_DIST ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api(?:\/|$)|\/mcp(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  const lans = lanIPv4Addresses();
  console.log(`365 Day Box server listening on ${HOST}:${PORT}`);
  console.log(`本机 MCP:     http://127.0.0.1:${PORT}/mcp`);
  for (const ip of lans) {
    console.log(`局域网 MCP:   http://${ip}:${PORT}/mcp`);
  }
  if (lans[0]) {
    console.log(`（多数 MCP 客户端请填上面的局域网地址）`);
  }
  if (AUTH_TOKEN) {
    console.log(`鉴权已开启：请求需带 Authorization: Bearer <AUTH_TOKEN> 或 X-Box-Token`);
  } else {
    console.log(`鉴权未开启：设置环境变量 AUTH_TOKEN 后启用`);
  }
}).on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用，请先关掉占用进程，或设置 PORT=其它端口`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
