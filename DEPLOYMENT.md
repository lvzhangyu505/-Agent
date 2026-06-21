# 部署说明

## 本地启动

```bash
python3 web_app.py --host 127.0.0.1 --port 8787
```

浏览器打开：

```text
http://127.0.0.1:8787
```

## 服务器启动

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 web_app.py --host 0.0.0.0 --port 8787
```

建议把以下目录配置为持久化磁盘或备份目录：

- `招标文件/`
- `企业资料/`
- `资质证书/`
- `企业业绩/`
- `历史标书/`
- `模板/`
- `输出标书/`

## 域名部署建议

生产环境建议在前面加 Nginx/Caddy：

- 开启 HTTPS。
- 限制访问来源或加 Basic Auth。
- 配置上传大小限制，建议 80MB 以上。
- 定期备份资料目录。

当前版本是自用工具，不包含账号体系。不要直接公开暴露到公网。

## Vercel 部署

当前项目已包含 Vercel 预览部署配置：

- `vercel.json`：把首页指向 `web/index.html`，把 `/api/*` 指向 Python Function。
- `api/index.py`：Vercel Python Function 入口，复用本地 `web_app.py` 的请求处理器。
- `.vercelignore`：避免把本地招标文件、企业资料、历史标书、输出标书上传到 Vercel。

注意：Vercel 适合预览网页和轻量接口，不适合作为当前版本的长期文件存储。正式处理大文件上传和长期保存资料时，建议接入 Vercel Blob/Supabase，或把后端部署到云服务器。
