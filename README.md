# 自用版标书写作 Agent

这是一个本地优先的标书写作 Agent。它不包含积分、充值、团队、手机号、密码、后台管理等商业化功能，只服务个人标书写作流程。

## 目录

```text
招标文件/        放招标文件，支持 .docx/.doc/.pdf/.txt/.md
企业资料/        放企业基础信息、法人信息等
资质证书/        放资质材料
企业业绩/        放业绩材料
历史标书/        放可复用的历史标书
模板/            放 Word 模板
输出标书/        Agent 生成的解读、目录、初稿、检查报告、Word 文件
```

## 快速开始

```bash
/Users/lvzhangyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 biaoshu_agent.py init
```

把招标文件放进 `招标文件/`，企业资料放进对应资料目录后运行：

```bash
/Users/lvzhangyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 biaoshu_agent.py run-all "招标文件/你的招标文件.docx"
```

生成结果会写入 `输出标书/<项目名称>/`：

- `01_招标文件解读.json`
- `02_投标目录.md`
- `03_标书初稿.md`
- `04_合规检查报告.md`
- `完整标书.docx`

## 网页版启动

```bash
/Users/lvzhangyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 web_app.py --host 127.0.0.1 --port 8787
```

然后在 Chrome 打开：

```text
http://127.0.0.1:8787
```

网页版包含：

- 工作台：上传招标文件和资料，生成完整标书。
- 资料库说明：展示本地资料目录用途。
- 输出结果：预览解读、目录、初稿、合规报告，并下载 Word。
- 部署说明：服务器启动和域名部署建议。

## 当前网页版能力

- 资料库企业信息可在网页中保存，数据写入 `企业资料/资料库.json`，并同步生成 `企业资料/企业基础信息.md` 供生成标书时检索引用。
- 招标文件解读会输出更细的结构化字段，包括项目名称、项目编号、采购人、代理机构、预算/限价、服务期限、投标截止时间等。
- 解读结果会生成要求项清单、评分项清单、风险清单和检查清单。
- 标书制作会额外生成 `05_章节正文.json`，网页中可按章节查看正文，并可重新生成单个章节。

## 常用命令

```bash
# 只解读招标文件
python3 biaoshu_agent.py analyze "招标文件/文件.docx"

# 只生成目录
python3 biaoshu_agent.py outline "输出标书/项目/01_招标文件解读.json"

# 只生成初稿
python3 biaoshu_agent.py draft "输出标书/项目/01_招标文件解读.json"

# 只做合规检查
python3 biaoshu_agent.py compliance "输出标书/项目/01_招标文件解读.json" "输出标书/项目/03_标书初稿.md"

# 导出 Word
python3 biaoshu_agent.py export "输出标书/项目/03_标书初稿.md"
```

## Word 模板

第一版支持两种导出方式：

1. 没有模板时，直接生成可编辑的 `完整标书.docx`。
2. 有模板时，可使用包含正文插入书签名 `ZL_INSERT_FULL_BID_BODY` 的 `.docx`。当前版本会读取模板作为版式基础并追加正文；复杂书签精确插入可作为第二版增强。

## 设计边界

当前版本是本地 CLI Agent，重点是跑通流程，不做网站界面。它使用规则、关键词和资料检索生成初稿，不会联网，也不会把你的资料上传到第三方服务。
