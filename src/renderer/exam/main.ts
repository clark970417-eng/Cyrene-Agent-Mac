import "../ui/theme";

interface MCQ {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
  hint: string;
  difficulty: string;
}

interface NotebookApi {
  addNotebookEntry?: (options: {
    category: string;
    title: string;
    content: string;
    author: string;
    tags: string[];
  }) => Promise<{ ok: boolean; error?: string }>;
}

interface ExamQuizApi {
  generate: (prompt: string) => Promise<{ success: boolean; text?: string; error?: string }>;
  onProgress: (callback: (progress: { phase: string; chars: number }) => void) => () => void;
  cancel: () => Promise<boolean>;
}

declare global {
  interface Window {
    examQuiz?: ExamQuizApi;
  }
}

const el = <T extends Element = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing exam element: ${id}`);
  return node as T;
};

const views = {
  setup: el("view-setup"),
  loading: el("view-loading"),
  quiz: el("view-quiz"),
  result: el("view-result"),
};

const subjectSelect = el<HTMLSelectElement>("subject-select");
const focusInput = el<HTMLTextAreaElement>("focus-input");
const setupError = el("setup-error");
const startBtn = el<HTMLButtonElement>("start-btn");
const cancelLoadingBtn = el<HTMLButtonElement>("cancel-loading-btn");
const loadingProgressBar = el("loading-progress");
const loadingLog = el("loading-log");
const quizSubject = el("quiz-subject");
const quizProgressText = el("quiz-progress-text");
const quizTimerText = el("quiz-timer-text");
const petalProgress = el("petal-progress");
const questionDifficulty = el("question-difficulty");
const questionNumber = el("question-number");
const quizQuestionText = el("quiz-question-text");
const quizOptionsList = el("quiz-options-list");
const hintPanel = el("hint-panel");
const hintText = el("hint-text");
const hintBtn = el<HTMLButtonElement>("hint-btn");
const questionTools = el("question-tools");
const quizFeedback = el("quiz-feedback");
const feedbackStatusTitle = el("feedback-status-title");
const feedbackExplanationText = el("feedback-explanation-text");
const nextBtn = el<HTMLButtonElement>("next-btn");
const resultScore = el("result-score-overlay-text");
const resultProgressCircle = el<SVGCircleElement>("result-svg-progress-bar");
const resultTitle = el("result-title");
const resultComment = el("result-comment-text");
const resultCorrectCount = el("result-correct-count");
const resultTotalTime = el("result-total-time");
const resultHintCount = el("result-hint-count");
const reviewSummary = el("review-summary");
const reviewList = el("review-list");
const saveStatus = el("save-status");
const saveNotebookBtn = el<HTMLButtonElement>("save-notebook-btn");
const restartBtn = el<HTMLButtonElement>("restart-btn");
const moreQuestionsBtn = el<HTMLButtonElement>("more-questions-btn");

let currentQuiz: MCQ[] = [];
let currentQuestionIndex = 0;
let userAnswers: number[] = [];
let hintUsage: boolean[] = [];
let correctCount = 0;
let selectedQuestionCount = 3;
let selectedDifficulty = "adaptive";
let currentSubject = "AP Calculus BC";
let currentFocus = "";
let startTime = 0;
let finalElapsedMs = 0;
let timerInterval: number | null = null;
let generationRevision = 0;
let removeGenerationListener: (() => void) | null = null;

function showView(view: keyof typeof views): void {
  Object.values(views).forEach((node) => node.classList.add("is-hidden"));
  views[view].classList.remove("is-hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showSetupError(message: string): void {
  setupError.textContent = message;
  setupError.hidden = !message;
}

function selectFromGroup(
  groupId: string,
  attribute: "count" | "difficulty",
  callback: (value: string) => void,
): void {
  el(groupId).querySelectorAll<HTMLButtonElement>(".choice-btn").forEach((button) => {
    button.addEventListener("click", () => {
      el(groupId).querySelectorAll(".choice-btn").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      callback(button.dataset[attribute] ?? "");
    });
  });
}

selectFromGroup("question-count-group", "count", (value) => {
  selectedQuestionCount = Number.parseInt(value, 10) || 3;
});
selectFromGroup("difficulty-group", "difficulty", (value) => {
  selectedDifficulty = value || "adaptive";
});

function cleanJsonString(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractJsonArray(value: string): string {
  const start = value.indexOf("[");
  const end = value.lastIndexOf("]");
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
}

function parseQuizResponse(value: string): MCQ[] {
  const raw = JSON.parse(extractJsonArray(cleanJsonString(value))) as unknown;
  if (!Array.isArray(raw)) throw new Error("昔漣收到的題目格式不完整，請再試一次。");

  const questions = raw.map((item, index) => {
    const candidate = item as Partial<MCQ>;
    const options = Array.isArray(candidate.options)
      ? candidate.options.map((option) => String(option).trim()).filter(Boolean)
      : [];
    const answer = Number(candidate.answer);
    if (!String(candidate.question ?? "").trim() || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new Error(`第 ${index + 1} 題的內容不完整，請讓昔漣重新整理。`);
    }
    return {
      question: String(candidate.question).trim(),
      options,
      answer,
      explanation: String(candidate.explanation ?? "").trim() || "Review the core concept, then eliminate each option that conflicts with the conditions in the question.",
      hint: String(candidate.hint ?? "").trim() || "Identify the given information first, then connect it to the most relevant core concept.",
      difficulty: String(candidate.difficulty ?? "Adaptive").trim(),
    };
  });

  if (!questions.length) throw new Error("沒有產生可用的題目，請再試一次。");
  return questions.slice(0, selectedQuestionCount);
}

const difficultyCopy: Record<string, string> = {
  foundation: "以核心概念和基本應用為主，避免偏題與冷知識",
  adaptive: "由淺入深，混合觀念判斷與應用，每一題難度逐步提升",
  challenge: "加入常見陷阱、跨概念整合與較高階推理，但答案必須明確",
};

function resolveSubject(): string {
  return subjectSelect.value;
}

function buildQuizPrompt(subject: string, focus: string): string {
  const isApEnglishSubject = /^AP\s+/i.test(subject);
  const languageInstruction = isApEnglishSubject
    ? "The question, all answer options, hint, explanation, and difficulty label MUST be written entirely in English. Do not include Chinese in any generated quiz content."
    : "題目、所有選項、提示、解析與難度標籤請使用繁體中文（如為外語學習題目，題目與選項以該外語為主，提示與解析使用繁體中文）。";

  const focusSection = focus
    ? `\n本次練習範圍或參考筆記：\n${focus}\n請優先依據這段內容出題，但不要引用不存在的材料。`
    : "";
  return `你是 Cyrene Agent 的昔漣，現在要為夥伴建立一份互動式練習測驗。
主題：${subject}
題數：${selectedQuestionCount} 題
難度策略：${difficultyCopy[selectedDifficulty] ?? difficultyCopy.adaptive}${focusSection}

請出 4 個選項的單選題（包含 1 個明確正確答案），測驗真實理解而非死記硬背。
提示不可直接給出答案；解析須說明正確原因與常見誤區。
${languageInstruction}

只輸出 JSON Array，不要 Markdown、註解或其他文字：
[
  {
    "question": "${isApEnglishSubject ? "Question in English" : "題目內容"}",
    "options": ["${isApEnglishSubject ? "Option A" : "選項 A"}", "${isApEnglishSubject ? "Option B" : "選項 B"}", "${isApEnglishSubject ? "Option C" : "選項 C"}", "${isApEnglishSubject ? "Option D" : "選項 D"}"],
    "answer": 0,
    "hint": "${isApEnglishSubject ? "Hint in English that does not reveal the answer" : "不直接透露答案的提示"}",
    "explanation": "${isApEnglishSubject ? "Clear explanation in English" : "清晰解析"}",
    "difficulty": "${isApEnglishSubject ? "Foundation, Intermediate, or Challenge" : "基礎、自適應 或 挑戰"}"
  }
]`;
}

function setLoadingProgress(percent: number, message: string): void {
  loadingProgressBar.style.width = `${percent}%`;
  loadingLog.textContent = message;
}

async function generateQuiz(): Promise<MCQ[]> {
  if (!window.examQuiz) throw new Error("昔漣的大腦還沒有連線，請重新開啟 App 後再試。");
  const revision = ++generationRevision;
  showView("loading");
  setLoadingProgress(10, "正在理解你的練習範圍");

  removeGenerationListener?.();
  removeGenerationListener = window.examQuiz.onProgress(({ phase, chars }) => {
    if (revision !== generationRevision) return;
    const progress = Math.min(88, phase === "receiving" ? 32 + Math.round(chars / 45) : 24);
    setLoadingProgress(progress, chars > 320 ? "正在檢查答案與解析" : "正在編排題目與提示");
  });

  try {
    const result = await window.examQuiz.generate(buildQuizPrompt(currentSubject, currentFocus));
    if (revision !== generationRevision) throw new Error("CANCELLED");
    if (!result.success) throw new Error(result.error || "出題失敗");
    setLoadingProgress(94, "正在把題目放進考試房");
    const quiz = parseQuizResponse(result.text ?? "");
    setLoadingProgress(100, "題目準備好了");
    return quiz;
  } finally {
    removeGenerationListener?.();
    removeGenerationListener = null;
  }
}

function cancelGeneration(): void {
  generationRevision += 1;
  void window.examQuiz?.cancel();
  removeGenerationListener?.();
  removeGenerationListener = null;
  startBtn.disabled = false;
  moreQuestionsBtn.disabled = false;
  showView("setup");
}

cancelLoadingBtn.addEventListener("click", cancelGeneration);

function formatElapsed(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = Math.floor((elapsedMs % 60_000) / 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function startTimer(): void {
  startTime = Date.now();
  if (timerInterval !== null) window.clearInterval(timerInterval);
  const update = () => { quizTimerText.textContent = formatElapsed(Date.now() - startTime); };
  update();
  timerInterval = window.setInterval(update, 1_000);
}

function stopTimer(): number {
  if (timerInterval !== null) window.clearInterval(timerInterval);
  timerInterval = null;
  finalElapsedMs = Date.now() - startTime;
  return finalElapsedMs;
}

function beginQuiz(quiz: MCQ[]): void {
  currentQuiz = quiz;
  currentQuestionIndex = 0;
  userAnswers = new Array(quiz.length).fill(-1);
  hintUsage = new Array(quiz.length).fill(false);
  correctCount = 0;
  saveStatus.hidden = true;
  saveNotebookBtn.disabled = false;
  saveNotebookBtn.textContent = "存入如我所書";
  showView("quiz");
  startTimer();
  renderQuestion();
}

async function startNewQuiz(): Promise<void> {
  showSetupError("");
  const subject = resolveSubject();
  if (!subject) {
    showSetupError("請先選擇一個科目，昔漣才能替你出題。");
    return;
  }
  currentSubject = subject;
  currentFocus = focusInput.value.trim();
  startBtn.disabled = true;
  try {
    beginQuiz(await generateQuiz());
  } catch (error) {
    if (error instanceof Error && error.message === "CANCELLED") return;
    console.error("[ExamQuiz] generation failed:", error);
    showView("setup");
    showSetupError(error instanceof Error ? error.message : "出題時發生問題，請再試一次。");
  } finally {
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", () => void startNewQuiz());

function renderPetalProgress(): void {
  petalProgress.replaceChildren();
  currentQuiz.forEach((_, index) => {
    const segment = document.createElement("span");
    if (index < currentQuestionIndex) segment.className = "is-done";
    if (index === currentQuestionIndex) segment.className = "is-current";
    petalProgress.appendChild(segment);
  });
  petalProgress.setAttribute("aria-label", `目前第 ${currentQuestionIndex + 1} 題，共 ${currentQuiz.length} 題`);
}

function renderQuestion(): void {
  const question = currentQuiz[currentQuestionIndex];
  if (!question) return;

  quizSubject.textContent = currentSubject;
  quizProgressText.textContent = `第 ${currentQuestionIndex + 1} 題，共 ${currentQuiz.length} 題`;
  questionNumber.textContent = `QUESTION ${String(currentQuestionIndex + 1).padStart(2, "0")}`;
  questionDifficulty.textContent = question.difficulty || "Adaptive";
  quizQuestionText.textContent = question.question;
  hintPanel.classList.add("is-hidden");
  hintBtn.disabled = false;
  hintBtn.innerHTML = '<span aria-hidden="true">✦</span> 給我一點提示';
  questionTools.classList.remove("is-hidden");
  quizFeedback.classList.add("is-hidden");
  nextBtn.classList.add("is-hidden");
  nextBtn.querySelector("span")!.textContent = currentQuestionIndex === currentQuiz.length - 1 ? "查看測驗結果" : "下一題";
  renderPetalProgress();

  quizOptionsList.replaceChildren();
  question.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-btn";
    button.setAttribute("aria-label", `選項 ${String.fromCharCode(65 + index)}：${option}`);
    const badge = document.createElement("span");
    badge.className = "option-circle";
    badge.textContent = String.fromCharCode(65 + index);
    const copy = document.createElement("span");
    copy.className = "option-text";
    copy.textContent = option;
    button.append(badge, copy);
    button.addEventListener("click", () => selectAnswer(index));
    quizOptionsList.appendChild(button);
  });
}

hintBtn.addEventListener("click", () => {
  const question = currentQuiz[currentQuestionIndex];
  if (!question) return;
  hintUsage[currentQuestionIndex] = true;
  hintText.textContent = question.hint;
  hintPanel.classList.remove("is-hidden");
  hintBtn.disabled = true;
  hintBtn.textContent = "提示已展開";
});

function selectAnswer(selectedIndex: number): void {
  const question = currentQuiz[currentQuestionIndex];
  const buttons = [...quizOptionsList.querySelectorAll<HTMLButtonElement>(".option-btn")];
  if (!question || userAnswers[currentQuestionIndex] >= 0) return;

  userAnswers[currentQuestionIndex] = selectedIndex;
  const isCorrect = selectedIndex === question.answer;
  if (isCorrect) correctCount += 1;
  buttons.forEach((button, index) => {
    button.disabled = true;
    button.classList.add("is-disabled");
    if (index === question.answer) button.classList.add("is-correct");
    if (index === selectedIndex && !isCorrect) button.classList.add("is-incorrect");
  });

  feedbackStatusTitle.textContent = isCorrect
    ? "答對了，這個觀念抓得很準"
    : `差一點，答案是 ${String.fromCharCode(65 + question.answer)}`;
  feedbackStatusTitle.className = isCorrect ? "is-correct" : "is-incorrect";
  feedbackExplanationText.textContent = question.explanation;
  quizFeedback.classList.remove("is-hidden");
  questionTools.classList.add("is-hidden");
  nextBtn.classList.remove("is-hidden");

  const currentPetal = petalProgress.children[currentQuestionIndex];
  currentPetal?.classList.remove("is-current");
  currentPetal?.classList.add("is-done");
}

nextBtn.addEventListener("click", () => {
  currentQuestionIndex += 1;
  if (currentQuestionIndex < currentQuiz.length) {
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    finishQuiz();
  }
});

function resultCopy(percent: number, hints: number): { title: string; comment: string } {
  if (percent >= 90) return {
    title: "漂亮收尾，這一章你已經握得很穩。",
    comment: hints ? `拿到 ${percent} 分，而且你知道什麼時候該借一點提示。接下來只要把錯題的判斷路徑再走一次，就很完整了。` : `拿到 ${percent} 分，而且沒有使用提示。這不是運氣，是你真的把觀念連起來了。`,
  };
  if (percent >= 70) return {
    title: "主幹已經長好了，再補幾個細節。",
    comment: `你拿到 ${percent} 分。整體理解很穩，錯題多半是條件判讀或相近概念混在一起；回顧下面的解析，下一組會更順。`,
  };
  if (percent >= 50) return {
    title: "輪廓出現了，我們把薄弱處標好了。",
    comment: `這次是 ${percent} 分。先別急著重做全部，從錯題解析裡找出重複出現的觀念，再練一組會更有效。`,
  };
  return {
    title: "這不是失敗，是一張很清楚的學習地圖。",
    comment: `這次是 ${percent} 分。題目已經替我們指出起點：先看懂錯題解析，再回到核心概念補一小段，會比盲目刷題更有用。`,
  };
}

function appendReviewItem(question: MCQ, index: number): void {
  const selected = userAnswers[index];
  const isCorrect = selected === question.answer;
  const item = document.createElement("article");
  item.className = `review-item${isCorrect ? "" : " is-wrong"}`;

  const top = document.createElement("div");
  top.className = "review-item__top";
  const number = document.createElement("span");
  number.textContent = `QUESTION ${String(index + 1).padStart(2, "0")}`;
  const status = document.createElement("span");
  status.className = "review-item__status";
  status.textContent = isCorrect ? "答對" : "需要複習";
  top.append(number, status);

  const title = document.createElement("h3");
  title.textContent = question.question;
  const answer = document.createElement("p");
  answer.textContent = `你的答案：${selected >= 0 ? question.options[selected] : "未作答"}`;
  const correct = document.createElement("p");
  correct.textContent = `正確答案：${question.options[question.answer]}`;
  const explanation = document.createElement("p");
  explanation.className = "review-item__explanation";
  explanation.textContent = `昔漣解析：${question.explanation}`;
  item.append(top, title, answer, correct, explanation);
  reviewList.appendChild(item);
}

function finishQuiz(): void {
  const elapsed = stopTimer();
  const percent = Math.round((correctCount / currentQuiz.length) * 100);
  const hints = hintUsage.filter(Boolean).length;
  const copy = resultCopy(percent, hints);

  resultScore.textContent = String(percent);
  const circumference = 2 * Math.PI * 52;
  resultProgressCircle.style.strokeDasharray = String(circumference);
  resultProgressCircle.style.strokeDashoffset = String(circumference * (1 - percent / 100));
  resultTitle.textContent = copy.title;
  resultComment.textContent = copy.comment;
  resultCorrectCount.textContent = `${correctCount} / ${currentQuiz.length}`;
  resultTotalTime.textContent = formatElapsed(elapsed);
  resultHintCount.textContent = `${hints} 次`;
  reviewSummary.textContent = `${currentSubject} · ${currentQuiz.length} 題`;
  reviewList.replaceChildren();
  currentQuiz.forEach(appendReviewItem);
  showView("result");
}

restartBtn.addEventListener("click", () => showView("setup"));

moreQuestionsBtn.addEventListener("click", async () => {
  moreQuestionsBtn.disabled = true;
  try {
    beginQuiz(await generateQuiz());
  } catch (error) {
    if (error instanceof Error && error.message === "CANCELLED") return;
    showView("result");
    saveStatus.textContent = error instanceof Error ? error.message : "加練題目產生失敗，請再試一次。";
    saveStatus.hidden = false;
  } finally {
    moreQuestionsBtn.disabled = false;
  }
});

saveNotebookBtn.addEventListener("click", async () => {
  const sidebar = (window as typeof window & { sidebar?: NotebookApi }).sidebar;
  if (!sidebar?.addNotebookEntry) {
    saveStatus.textContent = "目前無法連上「如我所書」，請稍後再試。";
    saveStatus.hidden = false;
    return;
  }

  saveNotebookBtn.disabled = true;
  saveNotebookBtn.textContent = "正在保存…";
  const percent = Math.round((correctCount / currentQuiz.length) * 100);
  const wrongTopics = currentQuiz
    .filter((question, index) => userAnswers[index] !== question.answer)
    .map((question) => question.question)
    .slice(0, 3);
  const content = [
    `完成「${currentSubject}」互動測驗，得分 ${percent} 分（${correctCount}/${currentQuiz.length}），用時 ${formatElapsed(finalElapsedMs)}。`,
    wrongTopics.length ? `待複習：${wrongTopics.join("；")}` : "本次全部答對。",
  ].join(" ");

  try {
    const result = await sidebar.addNotebookEntry({
      category: "📚 學習",
      title: `${currentSubject} 測驗紀錄`,
      content,
      author: "昔漣",
      tags: ["考試房", "互動測驗"],
    });
    if (!result.ok) throw new Error(result.error || "保存失敗");
    saveNotebookBtn.textContent = "已存入如我所書";
    saveStatus.textContent = "這次的成績與待複習題目，我替你收好了。";
    saveStatus.hidden = false;
  } catch (error) {
    saveNotebookBtn.disabled = false;
    saveNotebookBtn.textContent = "重新保存";
    saveStatus.textContent = error instanceof Error ? error.message : "保存失敗，請再試一次。";
    saveStatus.hidden = false;
  }
});
