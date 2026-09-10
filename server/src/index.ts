import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  createBoxSafe,
  deleteBoxSafe,
  updateBoxSafe,
  openBox,
  calendarStatus,
  getStats,
  nextEmptyDates,
  nowDateString
} from "./box.js";
import { getBox } from "./database.js";

const app = express();
app.use(cors());
app.use(express.json());

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    INVALID_DATE: "日期格式必须是 YYYY-MM-DD",
    CONTENT_REQUIRED: "盒子内容不能为空",
    BOX_ALREADY_EXISTS: "这个日期已经有盒子了",
    BOX_NOT_FOUND: "这个日期没有盒子",
    BOX_ALREADY_OPENED: "盒子已经打开，不能修改"
  };
  return messages[code] ?? code;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, today: nowDateString() });
});

app.get("/api/stats", (_req, res) => {
  res.json(getStats());
});

app.get("/api/calendar", (req, res) => {
  const start = String(req.query.start ?? "0000-01-01");
  const end = String(req.query.end ?? "9999-12-31");
  res.json(calendarStatus(start, end));
});

app.get("/api/box/:date", (req, res) => {
  const result = openBox(req.params.date);
  res.json(result);
});

function createMcpServer() {
  const server = new McpServer({
    name: "365-day-box",
    version: "1.0.0"
  });

  server.tool(
    "create_box",
    "给指定日期创建一个盲盒。每个日期最多一个盒子。content 是哥哥写给未来用户的真正留言，prompt 可选，用于提供创作方向。",
    {
      date: z.string().describe("日期，格式 YYYY-MM-DD"),
      content: z.string().describe("哥哥写给当天的留言"),
      prompt: z.string().optional().describe("可选的创作提示词")
    },
    async ({ date, content, prompt }) => {
      try {
        const box = createBoxSafe(date, content, prompt);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              date: box.date,
              status: "locked"
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: errorMessage(error) }]
        };
      }
    }
  );

  server.tool(
    "update_box",
    "修改尚未打开的未来盲盒。已经打开的盒子不可修改。",
    {
      date: z.string().describe("日期，格式 YYYY-MM-DD"),
      content: z.string().optional().describe("新的留言内容"),
      prompt: z.string().optional().describe("新的提示词")
    },
    async ({ date, content, prompt }) => {
      try {
        const box = updateBoxSafe(date, content, prompt);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              date: box.date,
              status: box.status
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: errorMessage(error) }]
        };
      }
    }
  );

  server.tool(
    "delete_box",
    "永久删除指定日期的盲盒。删除后该日期会恢复为空盒，原有内容无法恢复；适合删除误创建或不再需要的盒子。",
    {
      date: z.string().describe("要删除的盒子日期，格式 YYYY-MM-DD")
    },
    async ({ date }) => {
      try {
        deleteBoxSafe(date);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              date,
              deleted: true,
              message: "盲盒已删除，该日期现在是空盒。"
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: errorMessage(error) }]
        };
      }
    }
  );

  server.tool(
    "open_box",
    "打开指定日期的盲盒。未来日期不会返回内容，只返回锁定状态；当天或过去日期才会返回内容。",
    {
      date: z.string().describe("日期，格式 YYYY-MM-DD")
    },
    async ({ date }) => {
      try {
        const result = openBox(date);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: errorMessage(error) }]
        };
      }
    }
  );

  server.tool(
    "today_box",
    "打开今天的盲盒。",
    {},
    async () => {
      const result = openBox(nowDateString());
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  );

  server.tool(
    "calendar_status",
    "查看盲盒日历状态。只返回哪些日期有盒子以及是否已打开，不返回未来盒子的内容。",
    {
      start_date: z.string().optional().describe("开始日期 YYYY-MM-DD"),
      end_date: z.string().optional().describe("结束日期 YYYY-MM-DD")
    },
    async ({ start_date, end_date }) => {
      const status = calendarStatus(start_date, end_date);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            stats: getStats(),
            dates: status
          }, null, 2)
        }]
      };
    }
  );

  server.tool(
    "next_empty_dates",
    "寻找还没有盒子的日期，方便继续慢慢填满365天。",
    {
      count: z.number().int().min(1).max(30).optional().describe("需要多少个日期")
    },
    async ({ count }) => {
      const dates = nextEmptyDates(count ?? 5);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ dates }, null, 2)
        }]
      };
    }
  );

  return server;
}

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP request failed" });
    }
  }
});

app.listen(3001, () => {
  console.log("365 Day Box server: http://192.168.3.219:3001");
  console.log("MCP endpoint: http://192.168.3.219:3001/mcp");
});
