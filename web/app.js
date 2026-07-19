const views = document.querySelectorAll(".view");
const railItems = document.querySelectorAll(".rail-item[data-view]");
const interpretForm = document.getElementById("interpretForm");
const makeForm = document.getElementById("makeForm");
const interpretTender = document.getElementById("interpretTender");
const makeTender = document.getElementById("makeTender");
const interpretCards = document.getElementById("interpretCards");
const makeCards = document.getElementById("makeCards");
const outputList = document.getElementById("outputList");
const historyList = document.getElementById("historyList");
const sourcePreview = document.getElementById("sourcePreview");
const analysisTabs = document.getElementById("analysisTabs");
const analysisContent = document.getElementById("analysisContent");
const analysisSummary = document.getElementById("analysisSummary");
const outlineList = document.getElementById("outlineList");
const chapterEditor = document.getElementById("chapterEditor");
const chapterRefs = document.getElementById("chapterRefs");
const chapterEditorTitle = document.getElementById("chapterEditorTitle");
const lengthModal = document.getElementById("lengthModal");
const customPages = document.getElementById("customPages");
const wordEstimate = document.getElementById("wordEstimate");
const libraryForm = document.getElementById("libraryForm");
const libraryStatus = document.getElementById("libraryStatus");
const libraryTabs = document.getElementById("libraryTabs");
const libraryFields = document.getElementById("libraryFields");
const libraryFormTitle = document.getElementById("libraryFormTitle");
const libraryAssetList = document.getElementById("libraryAssetList");
const libraryGeneralUpload = document.getElementById("libraryGeneralUpload");
const checkTenderInput = document.getElementById("checkTenderInput");
const checkBidInput = document.getElementById("checkBidInput");
const checkBidList = document.getElementById("checkBidList");
const checkTenderStatus = document.getElementById("checkTenderStatus");
const checkTenderHint = document.getElementById("checkTenderHint");
const settingsForm = document.getElementById("settingsForm");
const taskProgressPanel = document.getElementById("taskProgressPanel");
const outlineTaskStatus = document.getElementById("outlineTaskStatus");
const knowledgeIndexStatus = document.getElementById("knowledgeIndexStatus");
const modelChatForm = document.getElementById("modelChatForm");
const modelChatInput = document.getElementById("modelChatInput");
const modelChatMessages = document.getElementById("modelChatMessages");
const modelIdentity = document.getElementById("modelIdentity");

let projects = [];
let currentProject = null;
let currentProjectData = null;
let currentAnalysisTab = "insight";
let libraryData = {};
let selectedChapterId = "";
let pendingMakeProject = null;
let activeLibraryTab = "company";
let checkBidFiles = [];
const settingsStorageKey = "biaoshu-agent:model-settings";
let modelChatHistory = [];

if (window.location.protocol === "file:") {
  document.getElementById("serverWarning")?.classList.remove("hidden");
}

const demoProject = {
  name: "云南省第一人民医院辅助类服务项目咨询公告 - 云南省第一人民医院.pdf",
  updated_at: Date.now() / 1000,
  files: [],
  has_docx: false,
  has_report: true,
  demo: true,
};

const tabLabels = [
  ["insight", "控标洞察"],
  ["qualification", "合标项要求"],
  ["reject", "废标项要求"],
  ["score", "评审项要求"],
  ["key", "关键项要求"],
  ["business", "商务条款要求"],
  ["price", "报价要求"],
  ["materials", "材料清单"],
  ["timeline", "时间节点"],
  ["checklist", "标书检查清单"],
];

railItems.forEach((item) => {
  item.addEventListener("click", () => showView(item.dataset.view));
});

document.querySelectorAll("[data-action='go-make']").forEach((button) => {
  button.addEventListener("click", () => showView("make"));
});

document.getElementById("hideAnalysisBtn").addEventListener("click", () => {
  document.querySelector(".reader-shell").classList.toggle("hide-pane");
});

document.getElementById("openLengthModal").addEventListener("click", openLengthModal);
document.getElementById("regenOutlineBtn").addEventListener("click", openLengthModal);
document.getElementById("cancelLength").addEventListener("click", closeLengthModal);
document.getElementById("confirmLength").addEventListener("click", generateBidBody);
document.getElementById("startCheckBtn").addEventListener("click", () => {
  showView("check");
  runUpgradedReview();
});
document.getElementById("saveChapterBtn").addEventListener("click", saveSelectedChapter);
document.getElementById("runReviewBtn").addEventListener("click", runUpgradedReview);
document.getElementById("exportFinalBtn").addEventListener("click", exportFinalDocx);
checkTenderInput.addEventListener("change", handleCheckTenderUpload);
checkBidInput.addEventListener("change", handleCheckBidUpload);
settingsForm.addEventListener("submit", saveSettings);
document.getElementById("rebuildIndexBtn").addEventListener("click", rebuildKnowledgeIndex);
document.getElementById("testModelBtn").addEventListener("click", testModelConnection);
modelChatForm.addEventListener("submit", sendModelChat);

document.querySelectorAll(".length-grid button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".length-grid button").forEach((x) => x.classList.remove("selected"));
    button.classList.add("selected");
    customPages.value = button.dataset.pages;
    updateEstimate();
  });
});

document.querySelectorAll(".numbering button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".numbering button").forEach((x) => x.classList.remove("selected"));
    button.classList.add("selected");
  });
});

customPages.addEventListener("input", updateEstimate);

libraryForm.addEventListener("submit", saveLibraryCompany);
document.getElementById("resetLibraryBtn").addEventListener("click", () => renderLibraryForm());
libraryTabs.querySelectorAll("[data-library-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    activeLibraryTab = button.dataset.libraryTab;
    renderLibraryForm();
  });
});
document.querySelectorAll("[data-upload-category]").forEach((input) => {
  input.addEventListener("change", () => uploadLibraryFiles(input));
});
libraryGeneralUpload.addEventListener("change", () => uploadLibraryFiles(libraryGeneralUpload, activeLibraryTab));

interpretTender.addEventListener("change", () => {
  document.getElementById("interpretFileName").textContent = interpretTender.files[0]?.name || "或拖拽文件到此处";
  if (interpretTender.files[0]) runUpload(interpretForm, "interpret");
});

makeTender.addEventListener("change", () => {
  document.getElementById("makeFileName").textContent = makeTender.files[0]?.name || "或拖拽文件到此处";
  if (makeTender.files[0]) runUpload(makeForm, "make");
});

function showView(id) {
  const aliases = { interpret: "interpret", make: "make", check: "check", library: "library", history: "history", templates: "templates", outputs: "outputs", settings: "settings", "model-chat": "model-chat" };
  const viewId = aliases[id] || id;
  views.forEach((view) => view.classList.toggle("active-view", view.id === viewId));
  railItems.forEach((item) => item.classList.toggle("active", item.dataset.view === id || item.dataset.view === viewId));
}

function showRawView(id) {
  views.forEach((view) => view.classList.toggle("active-view", view.id === id));
}

async function runUpload(form, source) {
  const fileLabel = source === "make" ? document.getElementById("makeFileName") : document.getElementById("interpretFileName");
  fileLabel.textContent = "正在智能解读并生成标书，请稍候...";
  try {
    const response = await fetch("/api/run", { method: "POST", body: new FormData(form) });
    const data = await response.json();
    if (!response.ok || data.status === "error") throw new Error(data.message || "生成失败");
    await loadProjects(data.project);
    if (source === "make") showRawView("outline");
    else showView("interpret");
  } catch (error) {
    fileLabel.textContent = error.message;
  }
}

async function loadProjects(preselect) {
  try {
    const response = await fetch("/api/projects");
    const data = await response.json();
    projects = data.projects && data.projects.length ? data.projects : [demoProject];
  } catch {
    projects = [demoProject];
  }
  currentProject = projects.find((project) => project.name === preselect) || projects[0];
  await loadProjectData(currentProject);
  renderAll();
}

async function loadLibrary() {
  try {
    const response = await fetch("/api/library");
    const data = await response.json();
    libraryData = data.library || {};
    fillLibraryForm(libraryData.company || {});
    renderLibraryForm();
    renderLibraryAssets();
  } catch (error) {
    libraryStatus.textContent = `资料库读取失败：${error.message}`;
  }
}

async function loadSettings() {
  try {
    const response = await fetch("/api/settings");
    const data = await response.json();
    const serverSettings = data.settings || {};
    const browserSettings = serverSettings.storage_mode === "browser"
      ? JSON.parse(localStorage.getItem(settingsStorageKey) || "{}")
      : {};
    const settings = { ...serverSettings, ...browserSettings };
    Object.entries(settings).forEach(([name, value]) => {
      const input = settingsForm.elements[name];
      if (!input) return;
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = name === "api_key" && isMaskedApiKey(value) ? "" : (value ?? "");
    });
    document.getElementById("settingsStatus").textContent = settings.storage_mode === "browser"
      ? (isMaskedApiKey(settings.api_key) ? "API Key 已被遮罩，请重新粘贴完整 Token" : (settings.api_key ? "设置已保存在当前浏览器" : "线上设置保存在当前浏览器"))
      : (settings.has_api_key ? "API Key 已保存" : "当前使用本地规则");
  } catch (error) {
    document.getElementById("settingsStatus").textContent = `读取失败：${error.message}`;
  }
}

async function loadKnowledgeIndex() {
  try {
    const response = await fetch("/api/knowledge-index");
    const data = await response.json();
    renderKnowledgeIndex(data.index || {});
  } catch (error) {
    knowledgeIndexStatus.textContent = `索引读取失败：${error.message}`;
  }
}

async function loadProjectData(project) {
  if (!project || project.demo) {
    currentProjectData = demoData();
    return;
  }
  const response = await fetch(`/api/project?name=${encodeURIComponent(project.name)}`);
  currentProjectData = await response.json();
}

function renderAll() {
  renderStats();
  renderCards();
  renderDetail();
  renderOutline();
  renderReview();
  renderOutputs();
  renderTaskProgress();
}

function renderStats() {
  const count = projects.length || 1;
  setText("readCount", count);
  setText("totalCount", count);
  setText("interpretTotal", `共 ${count} 份`);
  setText("makeReadCount", count);
  setText("todoBidCount", projects.filter((project) => !project.has_docx).length || 1);
  setText("doneBidCount", projects.filter((project) => project.has_docx).length);
  setText("makeTotalCount", count);
  setText("makeTotalText", count);
}

function renderCards() {
  interpretCards.innerHTML = projects.map((project) => fileCard(project, "interpret")).join("");
  makeCards.innerHTML = projects.map((project) => fileCard(project, "make")).join("");
  document.querySelectorAll("[data-open-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = projects.find((item) => item.name === button.dataset.openProject) || currentProject;
      currentProject = project;
      await loadProjectData(project);
      renderDetail();
      showRawView("read-detail");
    });
  });
  document.querySelectorAll("[data-make-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = projects.find((item) => item.name === button.dataset.makeProject) || currentProject;
      currentProject = project;
      pendingMakeProject = project;
      await loadProjectData(project);
      openLengthModal({ mode: "beforeMake" });
    });
  });
}

function fileCard(project, mode) {
  const name = cleanTitle(project.name);
  const time = project.demo ? "2026/6/15 10:22:41" : formatTime(project.updated_at);
  const actions = mode === "make"
    ? `<button class="white-btn" data-open-project="${escapeHtml(project.name)}">查看解读</button><button class="gold-btn" data-make-project="${escapeHtml(project.name)}">制作标书 →</button>`
    : `<button class="gold-btn" data-open-project="${escapeHtml(project.name)}">查看解读</button><button class="white-btn">删除</button>`;
  const task = project.task || {};
  const extra = mode === "make" ? `<span class="status-wait">${escapeHtml(task.message || "待生成目录")}</span><span class="status-wait">${Number(task.progress || 0)}%</span>` : "";
  return `
    <article class="file-card">
      <div class="file-head"><span class="pdf-icon">▧</span><span class="tag">PDF PDF 格式文件</span></div>
      <h3>${escapeHtml(name)}</h3>
      <div class="status-line"><span class="status-ok">✓ 已解读</span>${extra}</div>
      <div class="file-date">${time}</div>
      <div class="card-actions">${actions}</div>
    </article>
  `;
}

function renderDetail() {
  const title = cleanTitle(currentProject?.name || demoProject.name);
  document.getElementById("checkTenderName").textContent = `（定稿）${title}`;
  checkTenderStatus.textContent = currentProject?.demo ? "未解读" : "已解读";
  checkTenderHint.textContent = currentProject?.demo ? "当前为未解读或摘要暂不可用，开始检查时将先进行智能解读。" : "当前招标文件已完成解读，可重新上传替换。";
  if (!checkBidFiles.length) {
    renderCheckBidList([{ name: `（定稿）${title}`, size: 487 * 1024, saved: true }]);
  }
  sourcePreview.innerHTML = renderDocumentPreview(title);
  renderAnalysisSummary();
  renderAnalysisTabs();
}

async function handleCheckTenderUpload() {
  const file = checkTenderInput.files[0];
  if (!file) return;
  if (window.location.protocol === "file:") {
    checkTenderHint.textContent = "当前是静态文件预览，请打开 http://127.0.0.1:8787/ 后再上传。";
    checkTenderInput.value = "";
    return;
  }
  document.getElementById("checkTenderName").textContent = file.name;
  checkTenderStatus.textContent = "解读中";
  checkTenderHint.textContent = "正在上传并解读招标文件...";
  const form = new FormData();
  form.append("tender", file);
  try {
    const response = await fetch("/api/run", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok || data.status === "error") throw new Error(data.message || "上传失败");
    await loadProjects(data.project);
    showView("check");
    checkTenderStatus.textContent = "已解读";
    checkTenderHint.textContent = "新招标文件已完成解读，可开始合规检查。";
  } catch (error) {
    checkTenderStatus.textContent = "失败";
    checkTenderHint.textContent = error.message;
  } finally {
    checkTenderInput.value = "";
  }
}

async function handleCheckBidUpload() {
  const files = Array.from(checkBidInput.files || []);
  if (!files.length) return;
  const existing = new Set(checkBidFiles.map((file) => `${file.name}:${file.size}`));
  files.forEach((file) => {
    const key = `${file.name}:${file.size}`;
    if (!existing.has(key)) {
      existing.add(key);
      checkBidFiles.push(file);
    }
  });
  renderCheckBidList(checkBidFiles);
  if (window.location.protocol !== "file:" && currentProject && !currentProject.demo) {
    const form = new FormData();
    form.append("project", currentProject.name);
    checkBidFiles.forEach((file) => form.append("files", file));
    try {
      const response = await fetch("/api/check-bids", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok || data.status === "error") throw new Error(data.message || "上传失败");
      checkTenderHint.textContent = `已保存 ${data.saved.length} 个标书文件，可运行升级版审查。`;
    } catch (error) {
      checkTenderHint.textContent = error.message;
    }
  } else if (window.location.protocol === "file:") {
    checkTenderHint.textContent = "已选择文件，但静态文件预览无法保存上传；请打开 http://127.0.0.1:8787/。";
  }
  checkBidInput.value = "";
}

function renderCheckBidList(files) {
  checkBidList.innerHTML = files.map((file, index) => `
    <div class="selected-doc removable">
      <span>▤</span>
      <strong>${escapeHtml(file.name)}</strong>
      <small>${formatFileSize(file.size || 0)}</small>
      <button type="button" data-remove-check-bid="${index}">×</button>
    </div>
  `).join("");
  checkBidList.querySelectorAll("[data-remove-check-bid]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeCheckBid);
      checkBidFiles.splice(index, 1);
      renderCheckBidList(checkBidFiles);
    });
  });
}

function renderAnalysisSummary() {
  const analysis = safeFullAnalysis();
  const structured = safeStructured();
  const cards = [
    ["评分项", (analysis.scoring_items || []).length],
    ["废标项", (analysis.sections?.rejection || []).length],
    ["材料项", (analysis.material_items || []).length],
    ["时间节点", (analysis.timeline_items || []).length],
  ];
  analysisSummary.innerHTML = `
    ${cards.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
    <div class="summary-wide"><span>项目</span><strong>${escapeHtml(structured.project_name || currentProject?.name || "未识别")}</strong></div>
  `;
}

function renderDocumentPreview(title) {
  const text = getSourceText();
  const paragraph = text.split(/\n+/).find((line) => line.length > 30) || "因工作需要，为充分了解医院辅助类服务市场及价格等情况，保证采购工作公正、公平、公开顺利开展，拟对相关服务项目进行公开咨询，有意者请携带有关资质证照及方案前来沟通洽谈。";
  return `
    <div class="doc-meta"><span>2026/6/12 14:51</span><span>${escapeHtml(title)}</span></div>
    <div class="doc-logo"><span class="seal">医院</span><span class="seal red">院章</span><br />云 南 省 第 一 人 民 医 院<br />昆 明 理 工 大 学 附 属 医 院<br />The Affiliated Hospital of Kunming University of Science and Technology</div>
    <h1>${escapeHtml(title.replace(/\.pdf|\.docx?|\.txt|\.md/gi, ""))}</h1>
    <div class="doc-info"><span>发布时间：2026-06-05</span><span>浏览量：391 次</span><span>来源：总务处</span></div>
    <h2>${escapeHtml(title.replace(/\.(pdf|docx?|txt|md)$/i, ""))}</h2>
    <p>${escapeHtml(paragraph)}</p>
    <p>一、咨询内容及要求</p>
    <p>（一）项目内容：${escapeHtml(title.replace(/\.(pdf|docx?|txt|md)$/i, ""))}</p>
  `;
}

function renderAnalysisTabs() {
  analysisTabs.innerHTML = tabLabels.map(([key, label]) => `<button class="${key === currentAnalysisTab ? "active" : ""}" data-tab="${key}">${label}</button>`).join("");
  analysisTabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      currentAnalysisTab = button.dataset.tab;
      renderAnalysisTabs();
    });
  });
  analysisContent.innerHTML = renderAnalysisContent(currentAnalysisTab);
}

function renderAnalysisContent(key) {
  if (key === "checklist") return checklistContent();
  const data = safeAnalysis();
  const full = safeFullAnalysis();
  const structured = safeStructured();
  if (key === "insight" && Object.keys(structured).length) {
    return renderStructuredInsight(structured, data);
  }
  if (key === "insight") {
    return `
      <div class="risk-bar"><span class="risk-good">◎ 建议参与</span><span class="risk-badge">控标风险：低 ↻</span></div>
      <div class="bullet-list">
        <div>招标文件仅提供咨询公告信息，未披露具体项目约束条件</div>
        <div>无明确控标信号，竞争范围未被明显限制</div>
        <div>建议补充完整招标文件细节后再评估投标策略</div>
      </div>
    `;
  }
  const contentMap = {
    qualification: data.qualification || ["供应商应具备独立承担民事责任能力。", "需提供营业执照、资质证书及相关证明材料。"],
    reject: data.rejection || ["未按要求签字盖章可能导致响应无效。", "资格证明材料缺失或过期存在废标风险。"],
    score: data.scoring || ["技术方案完整性、服务团队配置、类似业绩与履约能力是主要评审重点。"],
    key: data.key_points || ["逐条响应服务内容、人员配置、质量控制、应急预案和验收要求。"],
    business: data.business || ["服务期限、付款方式、履约保证、合同条款需逐项响应。"],
    price: data.price || ["报价应包含完成本项目所需全部费用，并保持大小写、明细表一致。"],
  };
  if (key === "score") return renderScoreTable(full.scoring_items || data.scoring || []);
  if (key === "reject") return renderRequirementTable("废标项", data.rejection || []);
  if (key === "materials") return renderMaterialTable(full.material_items || []);
  if (key === "timeline") return renderTimelineTable(full.timeline_items || []);
  return contentMap[key].map((item, index) => `<div class="tab-card"><strong>${index + 1}. ${escapeHtml(item)}</strong></div>`).join("");
}

function renderScoreTable(items) {
  if (!items.length) return `<div class="warn-box">暂未识别到评分表，请人工确认招标文件是否另有附件。</div>`;
  const rows = items.map((item, index) => {
    if (typeof item === "string") return `<tr><td>${index + 1}</td><td>${escapeHtml(item)}</td><td></td><td>技术服务方案</td><td>正文方案</td></tr>`;
    return `<tr><td>${index + 1}</td><td>${escapeHtml(item.item || "")}</td><td>${escapeHtml(item.score || "")}</td><td>${escapeHtml(item.response_chapter || "")}</td><td>${escapeHtml(item.evidence || "")}</td></tr>`;
  }).join("");
  return `<table class="data-table"><thead><tr><th>#</th><th>评分项</th><th>分值</th><th>响应章节</th><th>证明材料</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRequirementTable(title, items) {
  if (!items.length) return `<div class="warn-box">暂未识别到${title}。</div>`;
  return `<table class="data-table"><thead><tr><th>#</th><th>${title}原文</th><th>风险</th><th>处理动作</th></tr></thead><tbody>${items.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item)}</td><td><span class="risk-high">高</span></td><td>逐条响应并检查证明材料</td></tr>`).join("")}</tbody></table>`;
}

function renderMaterialTable(items) {
  if (!items.length) return `<div class="warn-box">暂未生成材料清单。</div>`;
  return `<table class="data-table"><thead><tr><th>材料</th><th>类别</th><th>来源</th><th>风险</th><th>建议</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.name || "")}</td><td>${escapeHtml(item.category || "")}</td><td>${escapeHtml(item.source || "")}</td><td>${escapeHtml(item.risk || "")}</td><td>${escapeHtml(item.advice || "")}</td></tr>`).join("")}</tbody></table>`;
}

function renderTimelineTable(items) {
  if (!items.length) return `<div class="warn-box">暂未识别到明确时间节点。</div>`;
  return `<table class="data-table"><thead><tr><th>节点</th><th>时间/原文</th><th>负责人</th><th>风险</th><th>动作</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.node || "")}</td><td>${escapeHtml(item.time || "")}</td><td>${escapeHtml(item.owner || "")}</td><td>${escapeHtml(item.risk || "")}</td><td>${escapeHtml(item.action || "")}</td></tr>`).join("")}</tbody></table>`;
}

function renderStructuredInsight(structured, sections) {
  const rows = [
    ["项目名称", structured.project_name],
    ["项目编号", structured.project_no],
    ["采购人", structured.purchaser],
    ["代理机构", structured.agency],
    ["预算/限价", structured.budget],
    ["服务期限", structured.service_period],
    ["投标截止", structured.bid_deadline],
    ["开标/递交地点", structured.bid_location],
  ].filter(([, value]) => value);
  const risk = (safeFullAnalysis().risks || [])[0];
  return `
    <div class="risk-bar"><span class="risk-good">◎ ${risk ? "需复核重点风险" : "建议参与"}</span><span class="risk-badge">结构化字段：${rows.length} 项</span></div>
    <div class="tab-card">
      ${rows.map(([label, value]) => `<p><strong>${label}：</strong>${escapeHtml(value)}</p>`).join("") || "<p>暂未识别到明确项目字段，请人工补充。</p>"}
    </div>
    <div class="bullet-list">
      <div>资格项 ${sections.qualification?.length || 0} 条，废标风险 ${sections.rejection?.length || 0} 条，评分项 ${sections.scoring?.length || 0} 条</div>
      <div>建议先核对项目名称、编号、采购人、预算、服务期和截止时间，再进入标书制作。</div>
      <div>评分项会进入章节级生成，作为技术方案和专项响应的写作依据。</div>
    </div>
  `;
}

function checklistContent() {
  return `
    <div class="warn-box">ⓘ 本轮解读已完成，但该维度暂无条目；可能是文档中无相关内容或抽取未命中。可尝试重新解读该招标文件。</div>
    <div class="check-actions"><button class="white-btn">↻ 重新生成</button><button class="gold-btn">⬇ 导出Excel</button></div>
    <div class="check-summary"><span>总计：2 | 已检查：0 | 未检查：2 | 完成率：0%</span><span class="progress"><i></i></span></div>
    <div class="filters"><span>类别</span><select><option>全部</option></select><span>优先级</span><select><option>全部</option></select><span>状态</span><select><option>全部</option></select></div>
    <table class="check-table">
      <thead><tr><th><input type="checkbox" /></th><th>类别</th><th>优先级</th><th>检查项描述</th><th>页码</th><th>备注</th><th></th></tr></thead>
      <tbody>
        <tr><td><input type="checkbox" /></td><td><span class="tag">项目基本信息</span></td><td><span class="status-wait">中</span></td><td>确认项目名称：${escapeHtml(cleanTitle(currentProject?.name || demoProject.name).replace(/\.(pdf|docx?)$/i, ""))}</td><td>1</td><td><div class="remark">添加备注...</div></td><td><button class="white-btn">查看原文</button></td></tr>
        <tr><td><input type="checkbox" /></td><td><span class="tag">项目基本信息</span></td><td><span class="status-wait">中</span></td><td>确认招标人：云南省第一人民医院</td><td>1</td><td><div class="remark">添加备注...</div></td><td><button class="white-btn">查看原文</button></td></tr>
      </tbody>
    </table>
  `;
}

function renderOutline() {
  const chapters = getChapters();
  if (chapters.length) {
    selectedChapterId = selectedChapterId || chapters[0].id;
    outlineList.innerHTML = `<ol class="chapter-list">${chapters.map((chapter) => `
      <li>
        <button class="${chapter.id === selectedChapterId ? "active" : ""}" data-chapter-id="${escapeHtml(chapter.id)}">
          <strong>${escapeHtml(chapter.title)}</strong>
          <small>${escapeHtml(chapter.kind || "章节")}</small>
        </button>
      </li>`).join("")}</ol>`;
    outlineList.querySelectorAll("[data-chapter-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedChapterId = button.dataset.chapterId;
        renderOutline();
        renderSelectedChapter();
      });
    });
    renderSelectedChapter();
    return;
  }
  const outline = currentProjectData?.outline || demoData().outline;
  const lines = outline.split("\n").filter((line) => /^#{1,4}\s/.test(line)).slice(0, 24);
  outlineList.innerHTML = lines.length
    ? `<ol>${lines.map((line) => `<li>${escapeHtml(line.replace(/^#+\s*/, ""))}</li>`).join("")}</ol>`
    : "";
}

function openLengthModal(options = {}) {
  if (options.mode === "beforeMake") {
    lengthModal.dataset.mode = "beforeMake";
  } else {
    lengthModal.dataset.mode = "generateBody";
  }
  updateEstimate();
  lengthModal.classList.remove("hidden");
}

function closeLengthModal() {
  lengthModal.classList.add("hidden");
  lengthModal.dataset.mode = "";
  pendingMakeProject = null;
}

function updateEstimate() {
  const pages = Math.max(1, Number(customPages.value || 120));
  wordEstimate.textContent = `${(pages * 700).toLocaleString("zh-CN")}字`;
}

function generateBidBody() {
  lengthModal.classList.add("hidden");
  if (lengthModal.dataset.mode === "beforeMake") {
    if (pendingMakeProject) currentProject = pendingMakeProject;
    selectedChapterId = "";
    renderOutline();
    showRawView("outline");
    pendingMakeProject = null;
  } else {
    renderSelectedChapter();
  }
  lengthModal.dataset.mode = "";
  document.getElementById("downloadBidBtn").classList.remove("disabled");
}

function renderSelectedChapter() {
  const chapters = getChapters();
  const chapter = chapters.find((item) => item.id === selectedChapterId) || chapters[0];
  if (chapter?.content) {
    chapterEditorTitle.textContent = chapter.title || "正文内容编辑";
    chapterEditor.value = chapter.content;
    chapterRefs.innerHTML = renderChapterRefs(chapter);
    document.getElementById("regenChapterBtn")?.addEventListener("click", regenerateSelectedChapter);
    return;
  }
  const draft = currentProjectData?.draft || demoData().draft;
  chapterEditor.value = draft.slice(0, 5000) || "已生成正文内容，可继续人工修改后再导出 Word。";
  chapterRefs.innerHTML = "";
}

function renderChapterRefs(chapter) {
  const refs = [
    ...(chapter.requirements || []).slice(0, 8).map((item) => ({ title: "招标要求", text: item })),
    ...(chapter.knowledge_refs || []).map((item) => ({ title: `${item.category || "知识库"} · ${item.path || ""}`, text: item.excerpt || "" })),
    ...(safeFullAnalysis().material_items || []).slice(0, 5).map((item) => ({ title: item.category || "材料", text: `${item.name}：${item.advice}` })),
  ];
  return `
    <h3>引用与检查</h3>
    <button class="tool-btn" id="regenChapterBtn">重新生成本章</button>
    ${refs.map((item) => `<div class="ref-card"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text || "")}</p></div>`).join("") || "<p>暂无引用要求。</p>"}
  `;
}

async function regenerateSelectedChapter() {
  if (!currentProject || currentProject.demo || !selectedChapterId) return;
  chapterEditor.value = "正在重新生成本章...";
  const response = await fetch("/api/generate-chapter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: currentProject.name, chapter_id: selectedChapterId }),
  });
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    chapterEditor.value = data.message || "章节生成失败";
    return;
  }
  currentProjectData.chapters = data.chapters || [];
  currentProjectData.task = data.task || currentProjectData.task;
  renderOutline();
  renderTaskProgress();
}

async function saveSelectedChapter() {
  if (!currentProject || currentProject.demo || !selectedChapterId) return;
  libraryStatus.textContent = "正在保存章节...";
  const response = await fetch("/api/save-chapter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: currentProject.name, chapter_id: selectedChapterId, content: chapterEditor.value }),
  });
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    libraryStatus.textContent = data.message || "章节保存失败";
    return;
  }
  currentProjectData.chapters = data.chapters || [];
  libraryStatus.textContent = "章节已保存。";
  renderOutline();
}

function renderOutputs() {
  outputList.innerHTML = projects.map((project) => {
    const base = `输出标书/${project.name}/`;
    const links = project.demo ? "" : `
      <a href="/download?path=${encodeURIComponent(base + "完整标书.docx")}">Word</a>
      <a href="/download?path=${encodeURIComponent(base + "04_合规检查报告.md")}">合规报告</a>
      <a href="/download?path=${encodeURIComponent(base + "02_投标目录.md")}">投标目录</a>
    `;
    return `<div class="simple-card"><strong>${escapeHtml(cleanTitle(project.name))}</strong><p>${project.demo ? "示例数据，上传文件后这里会显示真实下载链接。" : links}</p></div>`;
  }).join("");
  historyList.innerHTML = projects.map((project) => `<div class="simple-card"><strong>${escapeHtml(cleanTitle(project.name))}</strong><p>可作为后续类似项目的历史标书素材。</p></div>`).join("");
}

async function runUpgradedReview() {
  if (!currentProject || currentProject.demo) return;
  document.getElementById("reviewIssues").innerHTML = `<div class="warn-box">正在运行升级版审查...</div>`;
  const response = await fetch("/api/run-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: currentProject.name }),
  });
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    document.getElementById("reviewIssues").innerHTML = `<div class="warn-box">${escapeHtml(data.message || "审查失败")}</div>`;
    return;
  }
  currentProjectData.review = data.review;
  currentProjectData.task = data.task || currentProjectData.task;
  renderReview();
  renderTaskProgress();
}

function renderReview() {
  const review = currentProjectData?.review || {};
  const summary = review.summary || {};
  const issues = review.issues || [];
  document.getElementById("reviewSummary").innerHTML = `
    <div><span>问题总数</span><strong>${summary.total || 0}</strong></div>
    <div><span>高风险</span><strong>${summary.high || 0}</strong></div>
    <div><span>中风险</span><strong>${summary.medium || 0}</strong></div>
    <div><span>低风险</span><strong>${summary.low || 0}</strong></div>
  `;
  document.getElementById("reviewIssues").innerHTML = issues.length
    ? issues.map((item) => `<article class="issue-card ${item.level === "高" ? "issue-high" : ""}">
        <header><strong>${escapeHtml(item.rule)}</strong><span>${escapeHtml(item.level)} / ${escapeHtml(item.status)}</span></header>
        <p><b>位置：</b>${escapeHtml(item.location)}</p>
        <p><b>招标要求：</b>${escapeHtml(item.requirement)}</p>
        <p><b>文件现状：</b>${escapeHtml(item.current)}</p>
        <p><b>修改动作：</b>${escapeHtml(item.action)}</p>
        <p><b>复核人：</b>${escapeHtml(item.reviewer)}</p>
      </article>`).join("")
    : `<div class="warn-box">尚未运行升级版审查。</div>`;
  renderFormatCheck(currentProjectData?.format_check || {});
}

async function exportFinalDocx() {
  if (!currentProject || currentProject.demo) return;
  const response = await fetch("/api/export-final", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: currentProject.name }),
  });
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    document.getElementById("reviewIssues").innerHTML = `<div class="warn-box">${escapeHtml(data.message || "导出失败")}</div>`;
    return;
  }
  currentProjectData.format_check = data.format_check || {};
  currentProjectData.task = data.task || currentProjectData.task;
  renderReview();
  renderTaskProgress();
  window.location.href = `/download?path=${encodeURIComponent(data.docx)}`;
}

function renderTaskProgress() {
  const task = currentProjectData?.task || currentProject?.task || {};
  const progress = Math.max(0, Math.min(100, Number(task.progress || 0)));
  const message = task.message || "尚无运行中的任务。上传招标文件后会记录每一步，可在下次打开时继续。";
  taskProgressPanel.innerHTML = `
    <div><strong>任务进度 / 恢复</strong><span>${escapeHtml(task.status === "completed" ? "已完成" : task.status === "running" ? "进行中" : "待开始")}</span></div>
    <p>${escapeHtml(message)}</p>
    <div class="task-track"><i style="width:${progress}%"></i></div>
    <small>${progress}% · ${escapeHtml(task.updated_at || "尚未运行")}</small>
  `;
  outlineTaskStatus.textContent = task.message ? `${progress}% ${task.message}` : "";
}

function renderFormatCheck(report) {
  const panel = document.getElementById("formatCheckPanel");
  const issues = report.issues || [];
  if (!report.generated_at) {
    panel.innerHTML = `<div class="warn-box">导出 Word 后将自动检查文件可打开性、标题样式、目录与模板残留。</div>`;
    return;
  }
  panel.innerHTML = `
    <div class="format-head"><strong>导出格式检查</strong><span class="${report.passed ? "status-ok" : "risk-high"}">${report.passed ? "通过关键检查" : "需要处理"}</span></div>
    ${issues.length ? issues.map((item) => `<p><b>${escapeHtml(item.level)}：</b>${escapeHtml(item.item)}；${escapeHtml(item.action)}</p>`).join("") : "<p>未发现高风险导出格式问题，仍需人工检查目录更新、页眉页脚、分页和签章。</p>"}
  `;
}

async function saveSettings(event) {
  event.preventDefault();
  const status = document.getElementById("settingsStatus");
  status.textContent = "正在保存...";
  const payload = Object.fromEntries(new FormData(settingsForm).entries());
  const stored = JSON.parse(localStorage.getItem(settingsStorageKey) || "{}");
  if (isMaskedApiKey(payload.api_key)) {
    if (!isMaskedApiKey(stored.api_key)) payload.api_key = stored.api_key || "";
    else {
      status.textContent = "请重新粘贴完整 API Key 后再保存。";
      return;
    }
  }
  payload.technical_bid_first = settingsForm.elements.technical_bid_first.checked;
  payload.temperature = Number(payload.temperature);
  payload.max_tokens = Number(payload.max_tokens);
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    status.textContent = data.message || "保存失败";
    return;
  }
  if (data.settings?.storage_mode === "browser") {
    localStorage.setItem(settingsStorageKey, JSON.stringify(payload));
    status.textContent = "模型设置已保存在当前浏览器。";
  } else {
    status.textContent = "模型设置已保存。";
  }
  if (data.settings?.storage_mode !== "browser" && data.settings?.api_key) {
    settingsForm.elements.api_key.value = data.settings.api_key;
  }
}

function isMaskedApiKey(value) {
  return /^\*{4,}/.test(String(value || ""));
}

function currentModelSettings() {
  const stored = JSON.parse(localStorage.getItem(settingsStorageKey) || "{}");
  if (Object.keys(stored).length) return stored;
  return Object.fromEntries(new FormData(settingsForm).entries());
}

async function testModelConnection() {
  await requestModelReply("请只回复：连接成功。然后用一句话说明你是什么模型。", true);
}

async function sendModelChat(event) {
  event.preventDefault();
  const message = modelChatInput.value.trim();
  if (!message) return;
  modelChatInput.value = "";
  await requestModelReply(message, false);
}

async function requestModelReply(message, isTest) {
  const settings = currentModelSettings();
  if (!settings.api_key || !settings.api_base || !settings.model) {
    modelIdentity.textContent = "请先完成模型设置";
    showView("settings");
    return;
  }
  modelChatHistory.push({ role: "user", content: message });
  renderModelChat("user", message);
  modelIdentity.textContent = "正在连接...";
  const response = await fetch("/api/model-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...settings,
      max_tokens: isTest ? 300 : Number(settings.max_tokens || 1024),
      messages: [
        { role: "system", content: "你是标书写作辅助模型。不得编造资质、业绩、金额、人员或招标要求；不确定的信息必须明确标注待确认。" },
        ...modelChatHistory,
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    modelIdentity.textContent = "连接失败";
    renderModelChat("error", data.message || "模型请求失败");
    return;
  }
  modelChatHistory.push({ role: "assistant", content: data.reply });
  modelIdentity.textContent = `实际响应：${data.response_model || data.requested_model}`;
  renderModelChat("assistant", data.reply);
}

function renderModelChat(role, content) {
  const labels = { user: "你", assistant: "模型", error: "错误" };
  modelChatMessages.insertAdjacentHTML("beforeend", `
    <article class="chat-message ${role}">
      <strong>${labels[role] || "消息"}</strong>
      <p>${escapeHtml(content).replace(/\n/g, "<br />")}</p>
    </article>
  `);
  modelChatMessages.scrollTop = modelChatMessages.scrollHeight;
}

async function rebuildKnowledgeIndex() {
  knowledgeIndexStatus.textContent = "正在解析资料并重建索引...";
  const response = await fetch("/api/knowledge-index", { method: "POST" });
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    knowledgeIndexStatus.textContent = data.message || "重建失败";
    return;
  }
  renderKnowledgeIndex(data.index || {});
}

function renderKnowledgeIndex(index) {
  knowledgeIndexStatus.textContent = `已索引 ${index.document_count || 0} 份文档 / ${index.chunk_count || 0} 个分段${index.failures?.length ? `，${index.failures.length} 份读取失败` : ""}`;
}

function safeAnalysis() {
  try {
    const parsed = JSON.parse(currentProjectData?.analysis || "{}");
    return parsed.sections || parsed || {};
  } catch {
    return {};
  }
}

function safeFullAnalysis() {
  try {
    return JSON.parse(currentProjectData?.analysis || "{}");
  } catch {
    return {};
  }
}

function safeStructured() {
  return safeFullAnalysis().structured || {};
}

function getChapters() {
  if (Array.isArray(currentProjectData?.chapters)) return currentProjectData.chapters;
  try {
    const chapters = JSON.parse(currentProjectData?.chapters || "[]");
    return Array.isArray(chapters) ? chapters : [];
  } catch {
    return [];
  }
}

async function saveLibraryCompany(event) {
  event.preventDefault();
  libraryStatus.textContent = "正在保存资料库...";
  const data = collectLibrarySectionData();
  const response = await fetch("/api/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section: activeLibraryTab, data }),
  });
  const result = await response.json();
  if (!response.ok || result.status === "error") {
    libraryStatus.textContent = result.message || "保存失败";
    return;
  }
  libraryData = result.library || {};
  libraryStatus.textContent = "已保存资料库，后续生成标书会自动引用。";
  renderLibraryAssets();
}

function collectLibrarySectionData() {
  const values = {};
  libraryFields.querySelectorAll("[name]").forEach((input) => {
    values[input.name] = input.value;
  });
  if (activeLibraryTab === "company") {
    document.querySelectorAll(".subform [name]").forEach((input) => {
      values[input.name] = input.value;
    });
  }
  return values;
}

function fillLibraryForm(data) {
  const source = Array.isArray(data) ? (data[0] || {}) : data;
  libraryFields.querySelectorAll("[name]").forEach((input) => {
    input.value = source[input.name] || "";
  });
}

function renderLibraryForm() {
  libraryTabs.querySelectorAll("[data-library-tab]").forEach((button) => button.classList.toggle("active", button.dataset.libraryTab === activeLibraryTab));
  const configs = {
    company: { title: "企业信息", fields: [["company_name", "公司名称 *"], ["company_type", "企业类型"], ["business_period", "营业期限"], ["credit_code", "统一社会信用代码"], ["established_at", "成立时间"]] },
    legal: { title: "法人信息", fields: [["legal_name", "法定代表人姓名 *"], ["legal_id", "身份证号"], ["legal_phone", "联系电话"], ["legal_title", "职务"], ["legal_address", "联系地址"]] },
    people: { title: "人员库", fields: [["name", "人员姓名 *"], ["role", "拟任岗位"], ["certificate", "证书/职称"], ["experience", "项目经验"], ["note", "备注"]] },
    certs: { title: "企业资质", fields: [["name", "资质名称 *"], ["number", "证书编号"], ["valid_until", "有效期"], ["issuer", "发证机构"], ["scope", "适用范围"]] },
    cases: { title: "企业业绩", fields: [["project_name", "项目名称 *"], ["client", "客户/采购人"], ["amount", "合同金额"], ["period", "服务期限"], ["content", "服务内容"]] },
    templates: { title: "标书模版", fields: [["name", "模板名称 *"], ["type", "模板类型"], ["scope", "适用项目"], ["version", "版本"], ["note", "备注"]] },
  };
  const config = configs[activeLibraryTab] || configs.company;
  libraryFormTitle.textContent = config.title;
  updateLibraryUploadCopy(config.title);
  const fields = config.fields.map(([name, placeholder]) => {
    return name === "content" || name === "scope" || name === "note" || name === "experience"
      ? `<textarea name="${name}" placeholder="${placeholder}"></textarea>`
      : `<input name="${name}" placeholder="${placeholder}" ${name.includes("until") ? "type='date'" : ""} />`;
  });
  const rows = [];
  for (let i = 0; i < fields.length; i += 2) {
    rows.push(`<div class="two-col">${fields[i]}${fields[i + 1] || ""}</div>`);
  }
  libraryFields.innerHTML = rows.join("");
  document.querySelector(".subform").style.display = activeLibraryTab === "company" ? "grid" : "none";
  fillLibraryForm(libraryData[activeLibraryTab] || {});
  renderLibraryAssets();
}

async function uploadLibraryFiles(input, categoryOverride) {
  if (!input.files.length) return;
  libraryStatus.textContent = "正在上传资料附件...";
  const form = new FormData();
  form.append("category", categoryOverride || input.dataset.uploadCategory || activeLibraryTab);
  Array.from(input.files).forEach((file) => form.append("files", file));
  const response = await fetch("/api/library/upload", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok || result.status === "error") {
    libraryStatus.textContent = result.message || "上传失败";
    return;
  }
  libraryData = result.library || {};
  const names = Array.from(input.files).map((file) => file.name).join("、");
  const target = input.id === "businessLicenseUpload" ? "businessLicenseName" : "accountLicenseName";
  setText(target, `已上传：${names}`);
  libraryStatus.textContent = "资料附件已保存。";
  renderLibraryAssets();
  input.value = "";
}

function renderLibraryAssets() {
  const assets = libraryData.assets || {};
  const licenses = assets.licenses || [];
  if (licenses.length) {
    setText("businessLicenseName", `已保存 ${licenses.length} 个证照附件，点击可继续上传。`);
    setText("accountLicenseName", `已保存 ${licenses.length} 个证照附件，点击可继续上传。`);
  }
  const counts = {
    people: Array.isArray(libraryData.people) ? libraryData.people.length : 0,
    certs: Array.isArray(libraryData.certs) ? libraryData.certs.length : 0,
    cases: Array.isArray(libraryData.cases) ? libraryData.cases.length : 0,
    templates: Array.isArray(libraryData.templates) ? libraryData.templates.length : 0,
  };
  libraryTabs.querySelectorAll("[data-library-tab='certs'] em").forEach((x) => x.textContent = counts.certs);
  libraryTabs.querySelectorAll("[data-library-tab='cases'] em").forEach((x) => x.textContent = counts.cases);
  const activeFiles = assets[activeLibraryTab] || [];
  const group = activeFiles.length ? activeFiles : (activeLibraryTab === "company" ? (assets.licenses || []) : []);
  const entries = normalizeLibraryEntries(libraryData[activeLibraryTab]);
  const entryRows = entries.slice(0, 6).map((entry) => {
    const title = entry.company_name || entry.legal_name || entry.name || entry.project_name || entry.template_name || entry.client || "未命名资料";
    const meta = entry.role || entry.certificate || entry.number || entry.client || entry.type || entry.credit_code || "";
    return `<div class="asset-row"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta || "已保存文字资料")}</small></div>`;
  }).join("");
  const fileRows = group.slice(0, 8).map((file) => `<div class="asset-row"><strong>${escapeHtml(file.name)}</strong><small>${Math.ceil((file.size || 0) / 1024)} KB</small></div>`).join("");
  libraryAssetList.innerHTML = `
    <h3>已保存资料</h3>
    ${entryRows || "<p>暂无文字资料，填写左侧表单后点击保存。</p>"}
    <h3>已保存附件/素材</h3>
    ${fileRows || "<p>暂无附件，可点击下方上传。</p>"}
  `;
}

function updateLibraryUploadCopy(title) {
  const uploadTitle = document.getElementById("libraryUploadTitle");
  const uploadHint = document.getElementById("libraryUploadHint");
  const hints = {
    company: ["上传企业附件", "营业执照、开户许可、公司介绍、制度文件等资料。"],
    legal: ["上传法人附件", "法人身份证明、授权材料、签字样本等资料。"],
    people: ["上传人员附件", "人员简历、证书、社保或岗位证明等资料。"],
    certs: ["上传资质证书", "资质证书、许可证、认证证书、扫描件或 PDF。"],
    cases: ["上传业绩材料", "合同、验收证明、中标通知书、服务评价等材料。"],
    templates: ["上传 Word 模板", "标书封面、目录、正文格式、商务/技术标模板。"],
  };
  const [label, hint] = hints[activeLibraryTab] || [`上传${title}附件`, "将本类资料附件上传到本地资料库。"];
  uploadTitle.textContent = label;
  uploadHint.textContent = hint;
}

function normalizeLibraryEntries(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Object.keys(value).length) return [value];
  return [];
}

function getSourceText() {
  return currentProjectData?.source || demoData().source || "";
}

function demoData() {
  return {
    analysis: JSON.stringify({
      sections: {
        qualification: ["供应商需携带有关资质证照及方案前来沟通洽谈。", "需能提供与医院辅助类岗位服务相关的履约能力证明。"],
        rejection: ["未提交必要资质证照、响应文件内容不完整或格式不符合要求，存在被否决风险。"],
        scoring: ["服务方案、人员配置、管理制度、质量控制、类似项目经验为重点内容。"],
        key_points: ["项目名称、采购人、服务范围、人员配置、服务标准、应急预案、报价口径均需响应。"],
        business: ["需关注服务期限、付款条件、合同履约、验收与违约责任。"],
        price: ["报价需覆盖人工、管理、税费、保险、服装、培训及其他完成服务所需费用。"],
      },
    }),
    outline: "# 投标文件\n## 一、投标函\n## 二、法定代表人身份证明\n## 三、授权委托书\n## 四、资格证明文件\n## 五、类似业绩\n## 六、技术服务方案\n### 6.1 项目理解\n### 6.2 服务目标\n### 6.3 人员配置\n### 6.4 岗位职责\n### 6.5 质量控制\n### 6.6 应急预案\n## 七、商务响应\n## 八、报价文件\n## 九、封标前检查清单",
    draft: "一、项目理解\n\n我公司充分理解本项目对医院辅助类服务连续性、规范性、安全性和响应速度的要求。项目实施过程中，将围绕服务质量、人员稳定、现场管理、培训考核、应急处置等方面建立闭环管理机制。\n\n二、服务方案\n\n项目进场后，我公司将组建专项服务团队，明确项目负责人、现场主管、岗位人员和后勤保障职责，确保各岗位按医院要求稳定运行。\n\n三、质量控制\n\n建立日巡查、周复盘、月考核制度，对服务态度、岗位纪律、工作记录、问题整改进行持续跟踪。",
    report: "合规检查报告\n\n风险等级：中\n\n1. 需核对项目名称、采购人名称与招标文件是否完全一致。\n2. 需检查资质证书有效期。\n3. 暗标项目需删除公司名称、Logo、页眉页脚、人员可识别信息。",
    source: "因工作需要，为充分了解医院辅助类服务市场及价格等情况，保证采购工作公正、公平、公开顺利开展，拟对云南省第一人民医院辅助类岗位服务项目进行公开咨询，有意者请携带有关资质证照及方案前来我院沟通洽谈。",
  };
}

function cleanTitle(name) {
  return String(name || "").replace(/^示例[-_]/, "");
}

function formatTime(ts) {
  const date = new Date((ts || Date.now() / 1000) * 1000);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function formatFileSize(size) {
  if (!size) return "0 KB";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(size / 1024)} KB`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

loadProjects();
loadLibrary();
loadSettings();
loadKnowledgeIndex();
