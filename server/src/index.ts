import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import os from "node:os";
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
  nowDateString,
  TARGET_YEAR
} from "./box.js";
import { MCP_INSTRUCTIONS } from "./mcp-docs.js";

/** 默认 0.0.0.0，方便 MCP 客户端用局域网 IP 连接；只要本机可用 HOST=127.0.0.1 */
const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3001);

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

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    INVALID_DATE: "日期格式必须是 YYYY-MM-DD，且必须是真实存在的日历日",
    DATE_YEAR_INVALID: `只能创建 ${TARGET_YEAR} 年的盒子`,
    DATE_IN_PAST: "不能创建过去的日期",
    CONTENT_REQUIRED: "盒子内容不能为空",
    BOX_ALREADY_EXISTS: "这个日期已经有盒子了",
    BOX_NOT_FOUND: "这个日期没有盒子",
    BOX_ALREADY_OPENED: "盒子已经打开，不能修改"
  };
  return messages[code] ?? code;
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
  const code = error instanceof Error ? error.message : String(error);
  res.status(status).json({
    ok: false,
    error: errorMessage(error),
    code
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, today: nowDateString(), year: TARGET_YEAR });
});

app.get("/api/stats", (_req, res) => {
  res.json(getStats());
});

app.get("/api/calendar", (req, res) => {
  try {
    const start = String(req.query.start ?? "0000-01-01");
    const end = String(req.query.end ?? "9999-12-31");
    res.json(calendarStatus(start, end));
  } catch (error) {
    sendApiError(res, error);
  }
});

/** 只读查看，不会标记已打开 */
app.get("/api/box/:date", (req, res) => {
  try {
    res.json(inspectBox(req.params.date));
  } catch (error) {
    sendApiError(res, error);
  }
});

/** 真正打开：到日会标记 opened */
app.post("/api/box/:date/open", (req, res) => {
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
    `往 ${TARGET_YEAR} 年今天或未来的空日期批量写入新盲盒。一次传入多个不同日期更好。不能创建过去/非法日历日/非 ${TARGET_YEAR} 年的日期；已有盒子不会覆盖（要改用 update_box）。入参 boxes:[{date,content,prompt?}]。出参 {results:[...]}。`,
    {
      boxes: z.array(z.object({
        date: z.string().describe(`${TARGET_YEAR} 年今天或未来的真实日历日 YYYY-MM-DD，建议先 next_empty_dates`),
        content: z.string().describe("留言正文，必填"),
        prompt: z.string().optional().describe("可选，给创作用的提示词")
      })).min(1).describe("要新建的盒子列表")
    },
    async ({ boxes }) => {
      const results = boxes.map(item => {
        try {
          const box = createBoxSafe(item.date, item.content, item.prompt);
          return { date: box.date, ok: true as const, status: "locked" as const };
        } catch (error) {
          return { date: item.date, ok: false as const, error: errorMessage(error) };
        }
      });
      return textJson({ results });
    }
  );

  server.tool(
    "update_box",
    "批量修改尚未打开的盲盒。content 必填。不存在或已打开会失败。不要用它来新建。入参 boxes:[{date,content,prompt?}]。出参 {results:[...]}。",
    {
      boxes: z.array(z.object({
        date: z.string().describe("已有盒子的日期 YYYY-MM-DD"),
        content: z.string().describe("新的留言正文，必填"),
        prompt: z.string().optional().describe("新提示词；不传则保持原值")
      })).min(1).describe("要修改的盒子列表")
    },
    async ({ boxes }) => {
      const results = boxes.map(item => {
        try {
          const box = updateBoxSafe(item.date, item.content, item.prompt);
          return { date: box.date, ok: true as const, status: box.status };
        } catch (error) {
          return { date: item.date, ok: false as const, error: errorMessage(error) };
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
          return { date, ok: false as const, error: errorMessage(error) };
        }
      });
      return textJson({ results });
    }
  );

  server.tool(
    "open_box",
    "批量打开或查看指定日期。可查已开过的盒子。未到北京时间解锁日则 locked=true 且无 content。入参 dates:[YYYY-MM-DD]。出参 {results:[...]}。",
    {
      dates: z.array(z.string()).min(1).describe("要打开/查看的日期列表 YYYY-MM-DD")
    },
    async ({ dates }) => {
      const results = dates.map(date => {
        try {
          return { ok: true as const, ...openBox(date) };
        } catch (error) {
          return { date, ok: false as const, error: errorMessage(error) };
        }
      });
      return textJson({ results });
    }
  );

  server.tool(
    "today_box",
    "打开今天的盲盒（北京时间）。无入参。出参与 open_box 单条一致：{ results:[{ ok, ... }] }。",
    {},
    async () => {
      try {
        const result = openBox(nowDateString());
        return textJson({ results: [{ ok: true as const, ...result }] });
      } catch (error) {
        return textJson({
          results: [{
            date: nowDateString(),
            ok: false as const,
            error: errorMessage(error)
          }]
        });
      }
    }
  );

  server.tool(
    "calendar_status",
    "查看日期范围内哪些天有盒子、开没开过。不返回留言正文。可选 start_date/end_date，默认今天。stats 对应该查询范围；year_stats 为整年。",
    {
      start_date: z.string().optional().describe("开始日期 YYYY-MM-DD，默认今天"),
      end_date: z.string().optional().describe("结束日期 YYYY-MM-DD，默认等于 start_date")
    },
    async ({ start_date, end_date }) => {
      const start = start_date ?? nowDateString();
      const end = end_date ?? start;
      const status = calendarStatus(start, end);
      return textJson({
        stats: getRangeStats(start, end),
        year_stats: getStats(),
        dates: status
      });
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

  return server;
}

type SessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  queue: Promise<void>;
};

const sessions = new Map<string, SessionEntry>();

/** 同一 session 上的并发 POST 串行化，避免 Streamable HTTP 并发串台 */
function enqueueSession(entry: SessionEntry, task: () => Promise<void>) {
  const run = entry.queue.then(task, task);
  entry.queue = run.then(() => undefined, () => undefined);
  return run;
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

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      await enqueueSession(entry, async () => {
        await entry.transport.handleRequest(req, res, req.body);
      });
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: id => {
          sessions.set(id, {
            transport,
            server,
            queue: Promise.resolve()
          });
        }
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // 无 session 的一次性调用（兼容直接 tools/call）
    if (!sessionId) {
      await handleStatelessMcp(req, res);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: 无效的 mcp-session-id，请重新 initialize"
      },
      id: null
    });
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

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing mcp-session-id");
    return;
  }
  const entry = sessions.get(sessionId)!;
  await enqueueSession(entry, async () => {
    await entry.transport.handleRequest(req, res);
  });
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing mcp-session-id");
    return;
  }
  const entry = sessions.get(sessionId)!;
  await entry.transport.close();
  await entry.server.close();
  sessions.delete(sessionId);
  res.status(204).end();
});

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
}).on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用，请先关掉占用进程，或设置 PORT=其它端口`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
