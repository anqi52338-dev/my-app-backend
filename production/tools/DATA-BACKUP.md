# 私密数据备份

`data-backup.py` 使用 SQLite 在线备份接口保存数据库，同时复制 `data` 下的上传文件和配置，排除已有 backups 和数据库 WAL/SHM。文件通过 GPG AES256 加密；恢复密钥独立保存在 `/home/ubuntu/.config/our-home-backup/recovery.key`，权限 600。备份位于应用目录外 `/home/ubuntu/our-home-backups`，目录权限 700。不要把该目录或恢复密钥放入 Git。

每次备份完成前会解密、核对每个文件的 SHA256，并运行 SQLite integrity_check。只有成功验证的备份才保存为正式文件。保留最近 7 个有备份的日期及最近 4 个有备份的周各一份（重合不重复）。旧功能修改前生成的 `data/backups` 不受此清理规则影响。

## 安装和定时

Ubuntu Python 3.12+ 与 GPG 为依赖。将程序放到 `/home/ubuntu/our-home/tools/data-backup.py`，服务和定时器放到 `/etc/systemd/system/`，运行：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now our-home-backup.timer
sudo systemctl start our-home-backup.service
systemctl list-timers our-home-backup.timer
journalctl -u our-home-backup.service --no-pager -n 20
```

北京时间每天 03:30 执行，可能延迟最多两分钟；关机错过后会补执行。失败状态在 systemd 日志中，不会自动发消息。首次成功后，单独将加密备份和恢复密钥下载到电脑并分开保存。服务器副本无法应对整台服务器丢失，电脑上的副本也需要定期更新；当前没有配置自动异地上传。

## 手动备份和验证

```sh
python3 /home/ubuntu/our-home/tools/data-backup.py
python3 /home/ubuntu/our-home/tools/data-backup.py --verify /home/ubuntu/our-home-backups/具体文件.tar.gz.gpg
```

## 恢复

在服务器上使用原密钥和一个不存在的新目录，先解密、核对并提取：

```sh
python3 /home/ubuntu/our-home/tools/data-backup.py --extract /路径/备份.tar.gz.gpg --key /路径/recovery.key --output /home/ubuntu/our-home-recovery
```

提取后不会覆盖线上数据。核对恢复内容，再停止 `our-home.service`，保存当前完整 data 目录作回退，将恢复出的 `data` 目录放入应用目录并确保 ubuntu 所有权，最后启动服务。在服务停止期间处理旧 home.db-wal/home.db-shm，不要把旧 WAL 混到恢复的数据库旁；不要在运行期间直接覆盖数据库。源码从配套前后端 GitHub production 目录恢复。Claude 账号登录凭据不包含在本备份中，需要重新登录。恢复密钥必须保留，否则加密备份无法解密。
