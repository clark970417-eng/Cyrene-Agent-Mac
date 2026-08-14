// Token 用量面板：指標卡片 + 柱狀圖 + Chart.js 波浪圖
// 從 settings.ts 抽離。

import type { Chart as ChartInstance, ChartConfiguration } from "chart.js";

/* ============================================================
   📊 Token 用量面板：指標卡片 + 柱狀圖 + Chart.js 波浪圖
   - 時間範圍 7d/14d/30d 切換，切換後調 IPC 拉真實數據並重渲
   - hover 柱子/波浪節點 → tooltip 顯示當天 輸入/輸出/命中/未命中
   - 全空時顯示空態（暫無用量數據）
   ============================================================ */

let chartModulePromise: Promise<typeof import("chart.js")> | null = null;

async function loadChartModule(): Promise<typeof import("chart.js")> {
  chartModulePromise ??= import("chart.js").then((module) => {
    module.Chart.register(...module.registerables);
    return module;
  });
  return chartModulePromise;
}

interface TokenDayData {
  date: string; // ISO 日期 "06-15"
  weekday: string; // "週日"
  input: number;
  output: number;
  hit: number; // 緩存命中（佔位 0）
  miss: number; // 緩存未命中（佔位 0）
  requests: number;
}

interface AgentActivityPayload {
  events: Array<{
    id: string;
    at: string;
    kind: "tool" | "permission" | "system";
    name: string;
    status: "success" | "failed" | "denied" | "running";
    durationMs: number;
    argsSummary?: string;
    resultSummary?: string;
    error?: string;
  }>;
  summary: {
    total: number;
    success: number;
    failed: number;
    denied: number;
    avgDurationMs: number;
  };
  models: Array<{ model: string; input: number; output: number; requests: number }>;
  resources: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    queue: { pending: number; running: number; limit: number };
    activityLimit: number;
    callContextTurnLimit: number;
  };
}

declare global {
  interface Window {
    tokenUsage?: {
      get: (days: number) => Promise<TokenDayData[]>;
    };
    agentActivity?: {
      get: (days: number) => Promise<AgentActivityPayload>;
      exportDiagnostic: () => Promise<{ filePath: string } | null>;
      testLocalAsr: (payload: {
        pcmBase64: string;
        language: string;
      }) => Promise<{ text: string; latencyMs: number }>;
    };
  }
}

// 根據天數生成假數據（帶隨機波動，模擬真實趨勢）
// 柱狀圖：根據數據動態生成柱子（複用 chart.css 的 .chart-bar 樣式）
function renderTokenBarChart(data: TokenDayData[]): void {
  const container = document.getElementById("token-bar-chart");
  if (!container) return;
  container.innerHTML = "";

  const maxVal = Math.max(...data.map((d) => d.input + d.output), 1);
  const peakIdx = data.reduce(
    (peak, d, i, arr) => (d.input + d.output > arr[peak].input + arr[peak].output ? i : peak),
    0,
  );

  // 柱狀圖最多顯示 14 根（30d 時隔天顯示），避免太擠
  const displayData = data.length > 14 ? data.filter((_, i) => i % 2 === 0) : data;

  // 容器實際可用高度（mini-chart 高度 112px - padding-top 18px - 底部 label 區 18px ≈ 76px）
  // 用固定像素高度，避免 flex 百分比高度在 padding 容器裡不可靠
  const chartHeight = 76;

  for (let i = 0; i < displayData.length; i++) {
    const d = displayData[i];
    const total = d.input + d.output;
    const barH = Math.max(6, Math.round((total / maxVal) * chartHeight));
    const bar = document.createElement("div");
    bar.className = "token-bar";
    // 峰值柱加標記
    const origIdx = data.indexOf(d);
    if (origIdx === peakIdx) bar.classList.add("token-bar--peak");

    // 真實 fill div（不用偽元素，直接控制像素高度）
    const fill = document.createElement("div");
    fill.className = "token-bar__fill";
    fill.style.height = barH + "px";

    const label = document.createElement("span");
    label.className = "token-bar__label";
    label.textContent = d.date.split("-")[1]; // 只顯示日
    bar.appendChild(fill);
    bar.appendChild(label);

    // hover tooltip
    bar.addEventListener("mouseenter", (e) => showTokenTooltip(e, d));
    bar.addEventListener("mousemove", (e) => moveTokenTooltip(e));
    bar.addEventListener("mouseleave", hideTokenTooltip);

    container.appendChild(bar);
  }

  // 日均標籤
  const avgEl = document.getElementById("token-avg-label");
  if (avgEl) {
    const avg = Math.round(data.reduce((s, d) => s + d.input + d.output, 0) / data.length);
    avgEl.textContent = `日均 ${formatTokenShort(avg)}`;
  }
}

function formatTokenShort(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

// tooltip 顯示/移動/隱藏
function showTokenTooltip(e: MouseEvent, d: TokenDayData): void {
  const tip = document.getElementById("token-tooltip");
  if (!tip) return;
  tip.innerHTML = `
    <div class="token-tooltip__date">${d.date} ${d.weekday}</div>
    <div class="token-tooltip__row"><span>📥 輸入</span><span>${d.input.toLocaleString()}</span></div>
    <div class="token-tooltip__row"><span>📤 輸出</span><span>${d.output.toLocaleString()}</span></div>
    <div class="token-tooltip__row"><span>🎯 命中</span><span>${d.hit > 0 ? d.hit.toLocaleString() : "N/A"}</span></div>
    <div class="token-tooltip__row"><span>❌ 未命中</span><span>${d.miss > 0 ? d.miss.toLocaleString() : "N/A"}</span></div>
  `;
  tip.hidden = false;
  moveTokenTooltip(e);
}

function moveTokenTooltip(e: MouseEvent): void {
  const tip = document.getElementById("token-tooltip");
  if (!tip || tip.hidden) return;
  const offset = 14;
  let x = e.clientX + offset;
  const y = e.clientY + offset;
  // 防止超出視口右邊
  const tipW = tip.offsetWidth;
  if (x + tipW > window.innerWidth) x = e.clientX - tipW - offset;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function hideTokenTooltip(): void {
  const tip = document.getElementById("token-tooltip");
  if (tip) tip.hidden = true;
}

// Chart.js 波浪面積圖
let tokenTrendChart: ChartInstance | null = null;
export let tokenRangeDays = 7;

async function renderTokenTrendChart(data: TokenDayData[]): Promise<void> {
  const canvas = document.getElementById("token-trend-chart") as HTMLCanvasElement | null;
  if (!canvas) return;

  const { Chart } = await loadChartModule();

  // 銷燬舊實例避免重疊
  if (tokenTrendChart) {
    tokenTrendChart.destroy();
    tokenTrendChart = null;
  }

  const labels = data.map((d) => d.date);
  const inputData = data.map((d) => d.input);
  const outputData = data.map((d) => d.output);

  const config: ChartConfiguration = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "📥 輸入",
          data: inputData,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.15)",
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#3b82f6",
        },
        {
          label: "📤 輸出",
          data: outputData,
          borderColor: "#ff8ccc",
          backgroundColor: "rgba(255, 140, 204, 0.15)",
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#ff8ccc",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            color: "rgba(235, 229, 245, 0.7)",
            font: { size: 11 },
            boxWidth: 12,
            boxHeight: 12,
          },
        },
        tooltip: {
          // 用 Chart.js 自帶 tooltip，顯示輸入/輸出/命中/未命中
          backgroundColor: "rgba(30, 20, 45, 0.95)",
          borderColor: "rgba(255, 182, 220, 0.3)",
          borderWidth: 1,
          titleColor: "rgba(254, 247, 255, 0.95)",
          bodyColor: "rgba(235, 229, 245, 0.85)",
          padding: 10,
          cornerRadius: 10,
          displayColors: true,
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              const d = data[idx];
              return `${d.date} ${d.weekday}`;
            },
            label: (item) => {
              const idx = item.dataIndex;
              const d = data[idx];
              const which = item.datasetIndex === 0 ? "input" : "output";
              const val = which === "input" ? d.input : d.output;
              return `${which === "input" ? "📥 輸入" : "📤 輸出"}: ${val.toLocaleString()}`;
            },
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const d = data[idx];
              return [
                `🎯 命中: ${d.hit > 0 ? d.hit.toLocaleString() : "N/A"}`,
                `❌ 未命中: ${d.miss > 0 ? d.miss.toLocaleString() : "N/A"}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "rgba(235, 229, 245, 0.45)",
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
          },
        },
        y: {
          grid: { color: "rgba(255, 182, 220, 0.08)" },
          ticks: {
            color: "rgba(235, 229, 245, 0.45)",
            font: { size: 10 },
            callback: (v) => formatTokenShort(Number(v)),
          },
          beginAtZero: true,
        },
      },
    },
  };

  tokenTrendChart = new Chart(canvas, config);
}

// 更新指標卡片
function updateTokenStats(data: TokenDayData[]): void {
  const totalInput = data.reduce((s, d) => s + d.input, 0);
  const totalOutput = data.reduce((s, d) => s + d.output, 0);
  const total = totalInput + totalOutput;
  const requests = data.reduce((s, d) => s + d.requests, 0);

  const set = (id: string, val: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("token-total", total.toLocaleString());
  set("token-requests", requests.toLocaleString());
  set("token-input", totalInput.toLocaleString());
  set("token-output", totalOutput.toLocaleString());
  set("token-hit", "N/A");
}

// 刷新整個面板：調 IPC 拉真實數據 → 有數據渲染圖表，無數據顯示空態
export async function refreshTokenPanel(days: number): Promise<void> {
  let data: TokenDayData[] = [];
  try {
    data = (await window.tokenUsage?.get(days)) ?? [];
  } catch (err) {
    console.warn("[settings] 拉取 Token 用量失敗:", err);
  }

  const hasData = data.some((d) => d.input > 0 || d.output > 0 || d.requests > 0);
  const emptyEl = document.getElementById("token-empty");
  const chartsEl = document.getElementById("token-charts");

  if (!hasData) {
    // 空態：隱藏圖表區，顯示空態提示，指標卡片歸零
    if (emptyEl) emptyEl.classList.remove("is-hidden");
    if (chartsEl) chartsEl.classList.add("is-hidden");
    const set = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set("token-total", "0");
    set("token-requests", "0");
    set("token-input", "0");
    set("token-output", "0");
    set("token-hit", "N/A");
    return;
  }

  // 有數據：顯示圖表區，隱藏空態
  if (emptyEl) emptyEl.classList.add("is-hidden");
  if (chartsEl) chartsEl.classList.remove("is-hidden");
  updateTokenStats(data);
  renderTokenBarChart(data);
  await renderTokenTrendChart(data);
}

// 時間範圍按鈕交互
document.querySelectorAll<HTMLButtonElement>(".token-range__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".token-range__btn").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");
    const days = Number(btn.dataset.range) || 7;
    tokenRangeDays = days;
    void refreshTokenPanel(days);
    void refreshAgentActivity(days);
  });
});

function formatResourceBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export async function refreshAgentActivity(days: number): Promise<void> {
  const payload = await window.agentActivity?.get(days).catch(() => null);
  if (!payload) return;
  const set = (id: string, value: string) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  set("activity-total", String(payload.summary.total));
  set(
    "activity-success-rate",
    payload.summary.total
      ? `${Math.round((payload.summary.success / payload.summary.total) * 100)}%`
      : "—",
  );
  set("activity-avg", payload.summary.total ? `${payload.summary.avgDurationMs} ms` : "—");
  set("activity-problems", String(payload.summary.failed + payload.summary.denied));
  set("activity-rss", formatResourceBytes(payload.resources.rssBytes));
  set(
    "activity-heap",
    `${formatResourceBytes(payload.resources.heapUsedBytes)} / ${formatResourceBytes(payload.resources.heapTotalBytes)}`,
  );
  set(
    "activity-queue",
    `${payload.resources.queue.running} 執行 · ${payload.resources.queue.pending}/${payload.resources.queue.limit} 等待`,
  );
  set("activity-context", `${payload.resources.callContextTurnLimit} 輪`);

  const events = document.getElementById("activity-events");
  if (events) {
    events.replaceChildren();
    if (!payload.events.length) events.innerHTML = '<p class="activity-empty">尚未有工具活動</p>';
    for (const event of payload.events) {
      const article = document.createElement("article");
      article.className = "activity-event";
      article.dataset.status = event.status;
      const strong = document.createElement("strong");
      strong.textContent = event.name;
      const badge = document.createElement("em");
      badge.textContent =
        event.status === "success" ? "成功" : event.status === "denied" ? "已拒絕" : "失敗";
      strong.appendChild(badge);
      const time = document.createElement("time");
      time.textContent = `${new Date(event.at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} · ${event.durationMs} ms`;
      const detail = document.createElement("p");
      detail.textContent =
        event.error ?? event.resultSummary ?? event.argsSummary ?? "沒有額外摘要";
      article.append(strong, time, detail);
      events.appendChild(article);
    }
  }

  const models = document.getElementById("activity-models");
  if (models) {
    models.replaceChildren();
    const max = Math.max(1, ...payload.models.map((model) => model.input + model.output));
    if (!payload.models.length) models.innerHTML = '<p class="activity-empty">尚無模型資料</p>';
    for (const model of payload.models.slice(0, 6)) {
      const row = document.createElement("div");
      row.className = "activity-model";
      const total = model.input + model.output;
      const label = document.createElement("div");
      label.className = "activity-model__row";
      const name = document.createElement("strong");
      name.textContent = model.model;
      const count = document.createElement("span");
      count.textContent = `${total.toLocaleString()} · ${model.requests} 次`;
      label.append(name, count);
      const bar = document.createElement("div");
      bar.className = "activity-model__bar";
      const fill = document.createElement("i");
      fill.style.width = `${Math.max(3, (total / max) * 100)}%`;
      bar.appendChild(fill);
      row.append(label, bar);
      models.appendChild(row);
    }
  }
}

document.getElementById("diagnostic-export-btn")?.addEventListener("click", async () => {
  const status = document.getElementById("activity-export-status");
  if (status) status.textContent = "正在整理…";
  try {
    const result = await window.agentActivity?.exportDiagnostic();
    if (status) status.textContent = result ? "已匯出" : "已取消";
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
});

// Token 圖表與 Chart.js 只在切到此面板時載入，避免每次打開設定頁都先解析大型圖表套件。

