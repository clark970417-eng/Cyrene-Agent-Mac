# Cyrene Agent 8 大核心優化提示詞集（Prompts）

本手冊包含針對 **Cyrene Agent**（`/Users/clark/Agent`）量身定制的 8 個模組優化提示詞。每個提示詞皆針對專案目前的實際代碼結構（`src/main/`、`orchestrator/`、`subagents/`、`memory/` 等）進行精確定義，可直接複製發送給 AI 程式碼助理執行。

---

## 目錄

- [模組一：獨立 Coding-Agent 子智能體](#模組一獨立-coding-agent-子智能體)
- [模組二：Critic / Reviewer Agent（自檢與反思審查）](#模組二critic--reviewer-agent自檢與反思審查)
- [模組三：Observation 工具輸出動態壓縮（Context Pruning）](#模組三observation-工具輸出動態壓縮context-pruning)
- [模組四：多輪任務滾動工作記憶（Rolling Scratchpad）](#模組四多輪任務滾動工作記憶rolling-scratchpad)
- [模組五：MCP 生態雙向增強（市集管理 + 反向暴露能力）](#模組五mcp-生態雙向增強市集管理--反向暴露能力)
- [模組六：DMAE 記憶後台非同步反思與情境主動關懷](#模組六dmae-記憶後台非同步反思與情境主動關懷)
- [模組七：代碼執行環境沙箱隔離（Sandbox Runtime）](#模組七代碼執行環境沙箱隔離sandbox-runtime)
- [模組八：鏈路可觀測性與除錯面板（Observability & Trace UI）](#模組八鏈路可觀測性與除錯面板observability--trace-ui)

---

## 模組一：獨立 Coding-Agent 子智能體

```markdown
【任務：為 Cyrene Agent 新增專屬的 Coding-Agent 子智能體】

目標：
請在 `src/main/orchestrator/subagents/` 目錄下新增 `coding-agent.ts`，將程式碼工程相關的工具鏈從主 Agent 循環中解耦出來，讓代碼任務在乾淨獨立的 Context 視窗中執行。

請依照以下規範實現：
1. 參考現有的 `src/main/orchestrator/subagents/search-agent.ts` 與 `document-agent.ts` 的架構與介面設計。
2. 封裝現有的代碼專用工具：`lsp-tool.ts`、`ast-grep-tools.ts`、`apply-patch-tools.ts`、`git-tools.ts` 與 `search-code-tools.ts` 到 CodingAgent 的專屬工具庫中。
3. 在 `src/main/orchestrator/subagents/runner.ts` 與 `types.ts` 中註冊 `coding-agent`，並在 `task-router.ts` 中配置自動路由規則：當任務屬於代碼重構、Bug 修復、檔案編輯時，自動委派給 `coding-agent`。
4. 撰寫單元測試 `coding-agent.test.ts`，確保委派調用、結果解析與錯誤回傳流程正常。
```

---

## 模組二：Critic / Reviewer Agent（自檢與反思審查）

```markdown
【任務：實現 Evaluator-Optimizer 模式的 Reviewer-Agent 自檢代理】

目標：
在執行程式碼重大變更、產生長篇學習筆記或輸出關鍵決策時，引入第二輪自動審查（Reviewer Agent）機制，減少幻覺與潛在 Bug。

請依照以下規範實現：
1. 在 `src/main/orchestrator/subagents/` 下新增 `reviewer-agent.ts`，設定專用的 System Prompt（專注於代碼安全性、語法正確性、邏輯漏洞審查與風格規範）。
2. 在 `src/main/orchestrator/verification-runner.ts` 或 `langgraph-agent-loop.ts` 中增加審查觸發節點：
   - 當生成內容涉及代碼修改或重要文檔時，呼叫 `reviewer-agent` 進行評分與問題清單產出。
   - 若審查未通過，將具體修改建議返回給前序 Agent 進行一次自動修復（最多重試 1~2 次）。
3. 提供配置項允許在 Settings 中開啟/關閉「嚴格審查模式」。
4. 撰寫相應的測試案例 `reviewer-agent.test.ts` 驗證自檢與修復循環。
```

---

## 模組三：Observation 工具輸出動態壓縮（Context Pruning）

```markdown
【任務：為工具調用結果增加 Observation 動態壓縮與截斷機制】

目標：
解決大型檔案檢索、長網頁爬取導致 Context Window 迅速膨脹和 Token 浪費的問題。

請依照以下規範實現：
1. 在 `src/main/orchestrator/` 下新增 `observation-compactor.ts`。
2. 當工具執行（`executeTool`）返回的字串或結構化數據超過設定的 Token 閾值（如 2000 tokens）時：
   - 提取關鍵前綴、結尾與語意摘要，標記 `[TRUNCATED / COMPACTED]` 標籤。
   - 將完整原始輸出存入臨時快取 `tool-output-cache`，並在壓縮後的文字中附帶 `Cache-Ref-ID`，供後續需要精確查詢時按需取用。
3. 在 `src/main/orchestrator/tool-outcome-normalizer.ts` 與 `langgraph-agent-loop.ts` 中接入此壓縮層。
4. 撰寫 `observation-compactor.test.ts` 驗證不同長度資料的壓縮表現與 Cache 索引功能。
```

---

## 模組四：多輪任務滾動工作記憶（Rolling Scratchpad）

```markdown
【任務：為長任務規劃實現滾動式進度總結與狀態壓縮】

目標：
在長多輪的 Work / Code 模式中，避免歷史對話過長導致 Agent 遺忘原始目標或卡在死循環。

請依照以下規範實現：
1. 檢查 `src/main/orchestrator/task-plan.ts` 與 `execution-ledger.ts`。
2. 實現 Rolling Scratchpad 機制：
   - 當執行輪數每經過 4~5 輪工具調用時，呼叫輕量模型快速生成一段當前狀態摘要（包含：已完成步驟、目前產出成果、下一步目標與未解決問題）。
   - 將這段最新狀態注入 System Prompt 的動態 Context 區域，同時對早期已完成的歷史對話進行折疊/精簡。
3. 在 `src/main/orchestrator/context-manager.ts` 中整合此邏輯，並確保中斷後恢復（Resume）時能直接讀取最新的 Scratchpad 狀態。
4. 撰寫單元測試驗證長任務下的狀態維持與上下文精簡。
```

---

## 模組五：MCP 生態雙向增強（市集管理 + 反向暴露能力）

```markdown
【任務：增強 MCP (Model Context Protocol) 雙向能力】

目標：
既能方便地在 UI 管理第三方 MCP Server，又能將 Cyrene 本地核心能力暴露為 MCP Server 供外部調用。

請依照以下規範實現：
1. **MCP Client 增強**：
   - 擴展 `src/main/orchestrator/mcp-manager.ts`，增加常用熱門預設（如 GitHub MCP、Brave Search、PostgreSQL、Fetch MCP）的一鍵開關與配置介面。
   - 支援在前端 Settings 面板顯示各 MCP Server 的即時連接狀態（Ping / Tool 數量）。
2. **Desktop as MCP Server（反向暴露）**：
   - 新增 `src/main/mcp-server/` 模組，透過 stdio / SSE 協議將 Cyrene 的專屬能力暴露出去：
     - `search_dmae_memory`（查詢 L0/L1/L2 記憶與世界書）
     - `read_obsidian_notes`（讀取 Obsidian 筆記庫）
     - `set_companion_mood`（控制 Live2D 表情與狀態）
3. 撰寫測試確保本地 MCP Server 符合標準 Model Context Protocol 規範。
```

---

## 模組六：DMAE 記憶後台非同步反思與情境主動關懷

```markdown
【任務：升級 DMAE 記憶系統的後台反思機制與主動關懷能力】

目標：
讓 Cyrene 在閒置時自動反思當日記憶、深化實體關係圖譜，並在適當時機發起自然的日常問候。

請依照以下規範實現：
1. **後台反思 Worker**：
   - 在 `src/main/memory/` 中新增 `memory-reflection-worker.ts`。
   - 結合 `memory-scheduler.ts`，在應用程式處於閒置或夜間靜默時段觸發：讀取近期對話與 L1/L2 記憶，更新 `entity-graph.ts`（合併重複實體、推論使用者習慣與偏好）。
2. **情境主動關懷（Proactive Care）**：
   - 擴展 `src/main/proactive/` 與 `src/main/chat-time-context.ts`：
   - 當檢測到使用者近期有學習目標（Obsidian 筆記進度）、特定日程或久未對話時，根據反思畫像生成溫暖且符合 Cyrene 人設的主動對話（支援免打擾時段設定）。
3. 撰寫 `memory-reflection-worker.test.ts` 驗證反思排程與實體圖譜更新。
```

---

## 模組七：代碼執行環境沙箱隔離（Sandbox Runtime）

```markdown
【任務：為代碼與終端執行增加分級安全沙箱機制】

目標：
提升 Agent 執行 Shell 命令與 Python 腳本時的安全性，防止意外刪除或污染本機重要目錄。

請依照以下規範實現：
1. 擴展 `src/main/orchestrator/shell-execution-policy.ts` 與 `permission-policy.ts`。
2. 實現三級執行策略：
   - **Level 1 (Safe / Direct)**：只讀操作（搜尋、讀取信任目錄檔案）直接本地執行。
   - **Level 2 (Workspace Scoped)**：寫入與普通命令限制在當前 Workspace 範圍內，超出範圍彈出 `AskClarificationCard` 人類確認。
   - **Level 3 (Sandboxed)**：執行未知 Python/Node 腳本時，支援切換至隔離環境（如輕量 Docker 容器、隔離子進程或臨時目錄沙箱）。
3. 撰寫測試驗證跨目錄非法操作攔截與審批機制。
```

---

## 模組八：鏈路可觀測性與除錯面板（Observability & Trace UI）

```markdown
【任務：實現 Agent 執行鏈路追蹤與視覺化除錯儀表板】

目標：
讓每輪對話與 Tool 執行的耗時、Token 花費、路由決策透明可視化，方便除錯與效能調優。

請依照以下規範實現：
1. 擴展 `src/main/agent-activity-store.ts` 與 `src/main/perf-trace.ts`，統一記錄每輪對話的完整 Trace：
   - `trace_id`、`user_query`、`route_decision`（路由至哪個 Agent）、`prompt_tokens`、`completion_tokens`、各 Tool 執行的耗時（ms）與成功/失敗狀態。
2. 在前端 `src/renderer/`（或開發者除錯面板中）新增一個「鏈路瀑布圖（Trace Waterfall View）」，視覺化展示每一步的執行耗時。
3. 支援將 Trace 記錄匯出為標準 JSON 或與 OpenTelemetry / Langfuse 格式相容。
4. 撰寫相應的測試與資料結構驗證。
```
