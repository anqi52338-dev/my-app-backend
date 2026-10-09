# 当前线上版本（production）

网站：<https://homehomeanan.icu/>。当前生产代码位于 `production/`，不是仓库根目录的旧原型。

- 前端仓库：<https://github.com/anqi52338-dev/qianduanku/tree/main/production>
- 后端仓库：<https://github.com/anqi52338-dev/my-app-backend/tree/main/production>
- 快照：`20261009T132420Z`，前后端各有同一份 `release.json`，里面是线上运行文件的 SHA-256。
- 腾讯云目前运行目录：`/home/ubuntu/our-home`，服务：`our-home.service`，Node 端口：`127.0.0.1:3100`。

两个仓库组合后还原当前网站；不能用旧 React 根目录的 `npm run build` 替代当前前端。根目录旧项目保留供参考，继续开发请修改 `production/`。

功能包括聊天、服务器记忆、朋友圈、日记、TXT/EPUB 共读室、GIF/WebP 表情包、ElevenLabs 语音、历史搜索与引用、对话收藏、信箱、书影、日程提醒、周期记录、模拟拉黑/小纸条、独立无痕/模型测试窗口，以及导出与恢复。

数据库、上传文件、聊天记录、Claude 登录信息、真实 API Key 和 `voice-config.json` 均不提交 Git。

完整部署与恢复说明见 [production/README.md](production/README.md)。
