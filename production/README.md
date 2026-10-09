# 小手机线上后端与部署

这是当前腾讯云实际运行的 Node 后端，前端来自 `qianduanku/production/public`。此目录不包含真实数据与密钥。生产系统：Ubuntu、Node 22.23.2、Python 3、tmux、官方 Claude Code、Nginx；Python 图像处理依赖固定在 `requirements.txt`。

## 检查

无需安装 npm 依赖：

```sh
cd production
npm run check
```

## 从两个仓库还原代码

选择两份 `release.json` 完全一致的版本，再组装到单独的应用目录。下面是假定仓库均在 `/home/ubuntu/source/` 的命令：

```sh
python3 /home/ubuntu/source/my-app-backend/production/tools/assemble.py   --frontend /home/ubuntu/source/qianduanku/production   --output /home/ubuntu/our-home
```

工具先验证两个清单一致和每个运行文件的哈希，再复制代码；不会修改现有 `data/`、上传文件、Claude 账号或语音密钥。私密配置不能从 Git 恢复，迁移服务器时须另外迁移自己的私密数据目录。

新环境需要安装 Python 依赖：

```sh
python3 -m pip install --target /home/ubuntu/our-home/vendor   -r /home/ubuntu/our-home/requirements.txt
```

当前服务器已经有依赖，不必反复安装。`sticker-thumbnail.py` 会优先加载同目录的 `vendor/`，保持 GIF/WebP 原件并生成首帧缩略图。

## 更新当前服务器

先检查源代码，再备份现有代码和 SQLite 数据库：

```sh
python3 /home/ubuntu/source/my-app-backend/production/tools/backup.py   --app /home/ubuntu/our-home
```

备份输出一个 `data/backups/before-git-*` 目录。之后执行上面的组装命令，再重启：

```sh
sudo systemctl restart our-home.service
systemctl is-active our-home.service
curl -I http://127.0.0.1:3100/
```

现有服务入口为 `/home/ubuntu/.nvm/versions/node/v22.23.2/bin/node /home/ubuntu/our-home/server.js`，以 `ubuntu` 用户运行，`PATH` 须包含这个 Node/Claude bin 目录；Nginx 将网站请求代理到 `127.0.0.1:3100`。不要把 Node 直接暴露到公网。新机器还需自行配置 HTTPS 和同等的 systemd/Nginx 设置。

Git 推送不会自动部署。每次更新都需要按上述流程组装、备份、重启和验证，以免未经测试的提交影响线上。

## 本地开发

组装到一个新的本地目录后，可用 `node server.js` 启动。仅在本地 HTTP 调试时设置 `HOME_INSECURE_COOKIE=1`；线上保持默认安全 Cookie。可以通过 `HOME_DATA` 指向独立开发数据目录，避免使用生产数据库。

聊天用现有 Claude Code 订阅登录；也可在网站设置中配置备用 OpenAI-compatible API。ElevenLabs 密钥只在网站的“他的声音”里配置，代码仓库不会保存它。无痕/模型测试走独立上下文和无会话持久化模式，不带入主聊天或记忆；真实模型仍依赖有效账号。

## 继续加功能

后端修改此目录的代码，前端修改另一个仓库的 `production/public/`。有意修改后刷新两份清单：

```sh
python3 tools/refresh-release.py --frontend /path/to/qianduanku/production
npm run check
```

随后在前端也执行 `npm run check`，将两个仓库都提交。同一批发布使用相同的快照 ID。新增运行模块时须先把它加入 `release.json` 文件清单，再刷新哈希。

## 回退

代码回退：在两个仓库检出同一旧快照，再组装、重启。日常代码回退不替换数据库。若确需恢复数据库，先停止服务并额外备份当前数据，再使用对应的 SQLite 备份；这会丢失备份之后的新记录，不能盲目覆盖。数据、密钥与 Claude 登录信息单独留在服务器。
