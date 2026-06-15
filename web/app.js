const panels = document.querySelectorAll(".panel");
const navItems = document.querySelectorAll(".nav-item");
const runForm = document.getElementById("runForm");
const runBtn = document.getElementById("runBtn");
const statusText = document.getElementById("statusText");
const refreshBtn = document.getElementById("refreshBtn");
const projectList = document.getElementById("projectList");
const previewTitle = document.getElementById("previewTitle");
const previewText = document.getElementById("previewText");
const downloadLinks = document.getElementById("downloadLinks");
const tabs = document.querySelectorAll(".tab");

let currentProject = null;
let currentDocs = {};
let currentDocKey = "report";

function activatePanel(id) {
  panels.forEach((panel) => panel.classList.toggle("active-panel", panel.id === id));
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.panel === id));
}

navItems.forEach((item) => {
  item.addEventListener("click", () => activatePanel(item.dataset.panel));
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentDocKey = tab.dataset.doc;
    tabs.forEach((x) => x.classList.toggle("active", x === tab));
    renderPreview();
  });
});

refreshBtn.addEventListener("click", loadProjects);

runForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(runForm);
  runBtn.disabled = true;
  statusText.textContent = "正在生成，请稍候...";
  try {
    const response = await fetch("/api/run", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok || data.status === "error") {
      throw new Error(data.message || "生成失败");
    }
    statusText.textContent = `已生成：${data.project}`;
    await loadProjects();
    await selectProject(data.project);
    activatePanel("results");
  } catch (error) {
    statusText.textContent = error.message;
  } finally {
    runBtn.disabled = false;
  }
});

async function loadProjects() {
  const response = await fetch("/api/projects");
  const data = await response.json();
  projectList.innerHTML = "";
  if (!data.projects || data.projects.length === 0) {
    projectList.innerHTML = '<div class="project-item"><strong>暂无项目</strong><span>上传招标文件后会显示在这里</span></div>';
    return;
  }
  data.projects.forEach((project) => {
    const button = document.createElement("button");
    button.className = "project-item";
    button.innerHTML = `<strong>${escapeHtml(project.name)}</strong><span>${project.files.length} 个输出文件</span>`;
    button.addEventListener("click", () => selectProject(project.name));
    projectList.appendChild(button);
  });
}

async function selectProject(name) {
  currentProject = name;
  document.querySelectorAll(".project-item").forEach((item) => {
    item.classList.toggle("active", item.querySelector("strong")?.textContent === name);
  });
  const response = await fetch(`/api/project?name=${encodeURIComponent(name)}`);
  const data = await response.json();
  currentDocs = data;
  previewTitle.textContent = name;
  renderDownloads(name);
  renderPreview();
}

function renderDownloads(name) {
  const base = `输出标书/${name}/`;
  const links = [
    ["Word", `${base}完整标书.docx`],
    ["初稿", `${base}03_标书初稿.md`],
    ["报告", `${base}04_合规检查报告.md`],
    ["解读", `${base}01_招标文件解读.json`],
  ];
  downloadLinks.innerHTML = links
    .map(([label, path]) => `<a href="/download?path=${encodeURIComponent(path)}">${label}</a>`)
    .join("");
}

function renderPreview() {
  if (!currentProject) {
    previewText.textContent = "生成后可在这里预览结果。";
    return;
  }
  const text = currentDocs[currentDocKey] || "暂无内容";
  previewText.textContent = text;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

loadProjects();
