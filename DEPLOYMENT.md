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
