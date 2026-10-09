# 秋招手账 · 在线版

面向设计、品牌与产品方向的中文秋招进度网页，使用 GitHub Pages 免费托管。网页和公开词库在 `static/` 中；没有外部 CDN，也不需要 API Key。

## 功能

- 粘贴岗位正文，提取岗位名称与简洁要求关键词；保存岗位链接用于回看。
- 根据你填写的个人画像，显示关键词覆盖度、材料中已有的对应证据与暂未体现的要求。
- 记录投递日期、进度和备注；搜索、筛选、编辑与删除。
- 下载 Excel：包含投递进度下拉框、筛选、岗位原文、匹配证据与个人画像。
- 下载 / 导入 JSON 备份，在设备之间迁移画像和投递记录。

**GitHub Pages 不运行后端。在线版以粘贴正文解析为主，不会自动跨站抓取岗位链接。** 第一行请填写岗位名称，再粘贴职责和任职要求。

数据仅保存在当前浏览器的 localStorage，不上传至 GitHub，不自动跨设备同步。清除网站数据会丢失记录；隐私浏览模式通常关闭窗口后即丢失数据。请定期导出 JSON 备份。Excel 是快照，修改不会自动同步回网页；JSON 才能恢复网页记录。网页本身公开，但不预置任何个人简历、作品集或投递记录。不要在共用设备的浏览器中保存个人材料。

匹配度为“材料中体现的要求关键词 / 已识别要求关键词”，不代表录取概率；未填写画像或无法识别关键词时不打分。词语等权，无法自动区分否定、必需 / 加分或复杂条件；毕业年份、学历、城市、经验年限和作品质量仍需人工核对。“暂未体现”不表示你不会。

## GitHub Pages 部署

1. 代码推送到 `hongyueshen/qiuzhao` 的 `main` 分支。
2. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**（需要仓库管理权限；私有仓库的 Pages 可用性取决于 GitHub 套餐）。
3. Actions 中运行 **Publish career tracker**。完成后以该工作流实际返回的部署地址为准。后续 `static/` 修改会自动发布。

部署工件仅包含 `static/`，排除 `data/`、PDF、SQLite、私密备份和开发代码。

## 本地预览在线版

```bash
cd /workspace/qiuzhao
python3 -m http.server 8000 --bind 127.0.0.1 --directory static
```

本机浏览器访问 `http://127.0.0.1:8000`，无需安装 Python 依赖或 Node。需要通过 HTTP / HTTPS 访问，不支持直接打开 HTML 文件。

## 原本的本地后端（可选）

`app.py` 与 `requirements.txt` 保留用于本地 API 开发和岗位网页抓取实验；GitHub Pages 不运行此后端，在线网页也不调用它。后端数据存储在忽略的 `data/tracker.db` 中，不会自动同步至浏览器。

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
```

浏览器端测试脚本在 `tests/browser_smoke.py`，需要本机安装 Playwright 与 Chromium。它使用临时浏览器上下文和人工测试材料，不修改真实浏览器数据；测试 Excel 内容、进度下拉框、JSON 备份恢复与移动布局。

## 第三方组件

ExcelJS 4.4.0 浏览器文件已随站点托管，其 MIT 许可证与来源信息在 `static/vendor/`。个人数据不发送给第三方分析或解析服务。
