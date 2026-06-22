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

let projects = [];
let currentProject = null;
let currentProjectData = null;
let currentAnalysisTab = "insight";
let libraryData = {};
let selectedChapterId = "";
let pendingMakeProject = null;
let activeLibraryTab = "company";

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

interpretTender.addEventListener("change", () => {
  document.getElementById("interpretFileName").textContent = interpretTender.files[0]?.name || "或拖拽文件到此处";
  if (interpretTender.files[0]) runUpload(interpretForm, "interpret");
});

makeTender.addEventListener("change", () => {
  document.getElementById("makeFileName").textContent = makeTender.files[0]?.name || "或拖拽文件到此处";
  if (makeTender.files[0]) runUpload(makeForm, "make");
});

function showView(id) {
  const aliases = { interpret: "interpret", make: "make", check: "check", library: "library", history: "history", templates: "templates", outputs: "outputs" };
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
  const extra = mode === "make" ? '<span class="status-wait">待生成目录</span><span class="status-wait">无标书</span>' : "";
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
  document.getElementById("checkBidName").textContent = `（定稿）${title}`;
  sourcePreview.innerHTML = renderDocumentPreview(title);
  renderAnalysisSummary();
  renderAnalysisTabs();
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
  renderOutline();
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
  renderReview();
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
  window.location.href = `/download?path=${encodeURIComponent(data.docx)}`;
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
  if (["people", "cases", "certs", "templates"].includes(activeLibraryTab)) {
    return [values];
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

async function uploadLibraryFiles(input) {
  if (!input.files.length) return;
  libraryStatus.textContent = "正在上传资料附件...";
  const form = new FormData();
  form.append("category", input.dataset.uploadCategory);
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
    certs: Array.isArray(libraryData.certs) ? libraryData.certs.length : 0,
    cases: Array.isArray(libraryData.cases) ? libraryData.cases.length : 0,
    templates: Array.isArray(libraryData.templates) ? libraryData.templates.length : 0,
  };
  libraryTabs.querySelectorAll("[data-library-tab='certs'] em").forEach((x) => x.textContent = counts.certs);
  libraryTabs.querySelectorAll("[data-library-tab='cases'] em").forEach((x) => x.textContent = counts.cases);
  const group = assets[activeLibraryTab] || assets.licenses || [];
  libraryAssetList.innerHTML = `<h3>已保存附件/素材</h3>${group.length ? group.slice(0, 8).map((file) => `<div class="asset-row"><strong>${escapeHtml(file.name)}</strong><small>${Math.ceil((file.size || 0) / 1024)} KB</small></div>`).join("") : "<p>暂无附件，可点击右侧区域上传。</p>"}`;
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

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

loadProjects();
loadLibrary();
