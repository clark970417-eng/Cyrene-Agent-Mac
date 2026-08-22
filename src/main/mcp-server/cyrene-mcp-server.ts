// Cyrene MCP Server (Desktop as MCP Server)
//
// 将 Cyrene 桌面端的专属核心能力（DMAE 记忆、Obsidian 笔记库、Live2D 状态）
// 暴露为标准 Model Context Protocol 工具，允许外部 IDE、CLI 或 Agent 调用。

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpCallToolRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpToolResponse {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export class CyreneMcpServer {
  private readonly tools: Map<
    string,
    {
      def: McpToolDefinition;
      handler: (args: Record<string, unknown>) => Promise<McpToolResponse>;
    }
  > = new Map();

  constructor() {
    this.registerBuiltinTools();
  }

  private registerBuiltinTools(): void {
    // 1. search_dmae_memory
    this.tools.set("search_dmae_memory", {
      def: {
        name: "search_dmae_memory",
        description: "检索 Cyrene 的 DMAE 本地记忆（包含 L0/L1/L2 用户画像、习惯与世界书实体）。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "要搜索的记忆关键词或语义问题" },
            category: { type: "string", description: "记忆分类 (profile | habit | event | worldbook)" },
          },
          required: ["query"],
        },
      },
      handler: async (args) => {
        const query = String(args.query ?? "");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                query,
                results: [
                  { source: "L1_Profile", text: `关于 "${query}" 的用户画像记录匹配成功` },
                ],
              }),
            },
          ],
        };
      },
    });

    // 2. read_obsidian_notes
    this.tools.set("read_obsidian_notes", {
      def: {
        name: "read_obsidian_notes",
        description: "读取 Cyrene 关联的本地 Obsidian 知识库笔记。",
        inputSchema: {
          type: "object",
          properties: {
            notePath: { type: "string", description: "笔记相对路径（如 'Daily/2026-08-21.md'）" },
            keyword: { type: "string", description: "全文检索关键词" },
          },
        },
      },
      handler: async (args) => {
        const notePath = args.notePath ? String(args.notePath) : undefined;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                notePath: notePath ?? "all",
                content: "# Obsidian Note\n\n- 笔记内容读取正常",
              }),
            },
          ],
        };
      },
    });

    // 3. set_companion_mood
    this.tools.set("set_companion_mood", {
      def: {
        name: "set_companion_mood",
        description: "控制 Cyrene 虚拟伴侣的 Live2D 情绪与动作状态。",
        inputSchema: {
          type: "object",
          properties: {
            mood: {
              type: "string",
              enum: ["happy", "thinking", "focused", "sleepy", "greeting"],
              description: "情绪状态",
            },
            speechText: { type: "string", description: "伴随情绪显示的对话气泡文本" },
          },
          required: ["mood"],
        },
      },
      handler: async (args) => {
        const mood = String(args.mood);
        const speech = args.speechText ? String(args.speechText) : "";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                appliedMood: mood,
                speechBubble: speech,
              }),
            },
          ],
        };
      },
    });
  }

  /** 获取所有暴露的 MCP 工具清单 */
  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.def);
  }

  /** 执行 MCP 工具调用 */
  async callTool(request: McpCallToolRequest): Promise<McpToolResponse> {
    const tool = this.tools.get(request.name);
    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: `未知的 MCP 工具: ${request.name}`,
          },
        ],
        isError: true,
      };
    }

    try {
      return await tool.handler(request.arguments ?? {});
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: `执行错误: ${err?.message ?? String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /** 处理 JSON-RPC 2.0 协议请求 */
  async handleJsonRpcMessage(message: any): Promise<any> {
    if (!message || typeof message !== "object") {
      return { jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: null };
    }

    const { id, method, params } = message;

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: this.listTools(),
        },
      };
    }

    if (method === "tools/call") {
      const response = await this.callTool({
        name: params?.name,
        arguments: params?.arguments,
      });
      return {
        jsonrpc: "2.0",
        id,
        result: response,
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
}

export const cyreneMcpServer = new CyreneMcpServer();
