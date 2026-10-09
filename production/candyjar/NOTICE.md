# 因果律软糖罐接入

引擎及糖果文案来自 mamo 的 [causality-candy-jar](https://github.com/mamo0521/causality-candy-jar)，上游提交 `beff3706b20cb2fd6f0871658b1815cfb915fafb`。

引擎原样保留。代码遵循随附 PolyForm Noncommercial 1.0.0；糖果文案及本版糖包改编遵循随附 CC BY-NC-SA 4.0，© 2026 mamo。仅供个人非商业使用。本版糖包删除三项成人向或年龄退行效果，其余文案保留作者原文。没有复制原项目前端素材，站内界面重新实现以适配小手机。

接入增加登录鉴权、串行执行、损坏存档保护、倒计时、效果开关、主动结束、AI 自主吃糖开关及喂糖邀请确认。存档 `data/candyjar_save.json` 自动纳入每日数据备份，开关和邀请在 SQLite kv 中。不会连接第三方托管糖罐，也不会创建新监听端口。北京时间零点切换每天可选罐。AI 自主吃糖效果从下次回复开始生效。
