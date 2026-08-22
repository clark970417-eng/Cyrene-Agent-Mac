import { describe, expect, it } from "vitest";
import { CyreneMcpServer } from "./cyrene-mcp-server";

describe("Cyrene Desktop as MCP Server", () => {
  it("lists exposed MCP tools conforming to specification", () => {
    const server = new CyreneMcpServer();
    const tools = server.listTools();

    expect(tools.length).toBeGreaterThanOrEqual(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_dmae_memory");
    expect(names).toContain("read_obsidian_notes");
    expect(names).toContain("set_companion_mood");
  });

  it("handles JSON-RPC tools/list and tools/call requests", async () => {
    const server = new CyreneMcpServer();

    // 1. tools/list
    const listRes = await server.handleJsonRpcMessage({
      jsonrpc: "2.0",
      id: "req-1",
      method: "tools/list",
    });
    expect(listRes.result.tools).toBeDefined();

    // 2. tools/call
    const callRes = await server.handleJsonRpcMessage({
      jsonrpc: "2.0",
      id: "req-2",
      method: "tools/call",
      params: {
        name: "set_companion_mood",
        arguments: { mood: "happy", speechText: "你好！" },
      },
    });
    expect(callRes.result.content[0].text).toContain("appliedMood");
    expect(callRes.result.content[0].text).toContain("happy");
  });
});
