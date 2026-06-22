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
const outlineList = document.getElementById("outlineList");
const bodyPreviewText = document.getElementById("bodyPreviewText");
const lengthModal = document.getElementById("lengthModal");
const customPages = document.getElementById("customPages");
const wordEstimate = document.getElementById("wordEstimate");
const libraryForm = document.getElementById("libraryForm");
const libraryStatus = document.getElementById("libraryStatus");

let projects = [];
let currentProject = null;
let currentProjectData = null;
let currentAnalysisTab = "insight";
let libraryData = {};
let selectedChapterId = "";
let pendingMakeProject = null;

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
document.getElementById("centerGenerateBtn").addEventListener("click", openLengthModal);
document.getElementById("regenOutlineBtn").addEventListener("click", openLengthModal);
document.getElementById("cancelLength").addEventListener("click", closeLengthModal);
document.getElementById("confirmLength").addEventListener("click", generateBidBody);
document.getElementById("startCheckBtn").addEventListener("click", () => {
  showView("read-detail");
  currentAnalysisTab = "checklist";
  renderAnalysisTabs();
});

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
document.getElementById("resetLibraryBtn").addEventListener("click", () => fillLibraryForm(libraryData.company || {}));
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
  renderAnalysisTabs();
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
  return contentMap[key].map((item, index) => `<div class="tab-card"><strong>${index + 1}. ${escapeHtml(item)}</strong></div>`).join("");
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
    bodyPreviewText.innerHTML = `
      <article class="chapter-preview">
        <button class="tool-btn" id="regenChapterBtn">↻ 重新生成本章</button>
        <pre>${escapeHtml(chapter.content)}</pre>
      </article>`;
    document.getElementById("regenChapterBtn").addEventListener("click", regenerateSelectedChapter);
    return;
  }
  const draft = currentProjectData?.draft || demoData().draft;
  bodyPreviewText.textContent = draft.slice(0, 5000) || "已生成正文内容，可继续人工修改后再导出 Word。";
}

async function regenerateSelectedChapter() {
  if (!currentProject || currentProject.demo || !selectedChapterId) return;
  bodyPreviewText.textContent = "正在重新生成本章...";
  const response = await fetch("/api/generate-chapter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: currentProject.name, chapter_id: selectedChapterId }),
  });
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    bodyPreviewText.textContent = data.message || "章节生成失败";
    return;
  }
  currentProjectData.chapters = data.chapters || [];
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
  const data = Object.fromEntries(new FormData(libraryForm).entries());
  const response = await fetch("/api/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section: "company", data }),
  });
  const result = await response.json();
  if (!response.ok || result.status === "error") {
    libraryStatus.textContent = result.message || "保存失败";
    return;
  }
  libraryData = result.library || {};
  libraryStatus.textContent = "已保存企业信息，后续生成标书会自动引用。";
  renderLibraryAssets();
}

function fillLibraryForm(data) {
  libraryForm.querySelectorAll("[name]").forEach((input) => {
    input.value = data[input.name] || "";
  });
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
