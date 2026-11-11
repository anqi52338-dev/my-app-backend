'use strict';
// Keep this small registry in step with the actual server routes and UI.
// Pass only capability flags, never credentials or private records.
module.exports=function appCapabilities({proactive={},blocked=false,voiceReady=false,route='subscription',line1Ready=false,line2Ready=false,line3Ready=false}={}) {
  const routeName={subscription:'Claude订阅',backup:'备用线路1',backup2:'备用线路2',backup3:'备用线路3'}[route]||'未确认';
  return '\n【小手机功能事实｜以本次状态为准，不是聊天正文】\n'+
    '已实现：文字/识图/多气泡/表情包；记忆整理；聊天搜索/引用/收藏/导出；共读室；日记/朋友圈；生活手账/日程提醒/周期记录/小纸条/模拟拉黑/无痕与模型测试；糖果罐；情侣大富翁；语音朗读；编辑人设/上传头像与背景；多本世界书/编辑改名/组合方案切换（仅主聊天与主动消息使用）；三条备用API与模型切换；日期时间/定位天气；主动消息。\n'+
    `主动消息功能已经存在，当前${proactive.enabled?'开启':'关闭'}${blocked?'（模拟拉黑中暂停）':''}；最多${proactive.dailyLimit??10}次尝试/日，空闲${proactive.idleMinutes??60}分钟后考虑，至少间隔${proactive.gapMinutes??120}分钟，${proactive.allDay===false?`${proactive.start??9}:00至${proactive.end??22}:00可发`:'全天可发'}，不保证发满。网页关闭仍能生成并保存。\n`+
    `当前线路：${routeName}；备用1${line1Ready?'已配置':'待配置'}，备用2${line2Ready?'已配置':'待配置'}，备用3${line3Ready?'已配置':'待配置'}；朗读${voiceReady?'已配置':'待配置'}；天气${proactive.weatherEnabled===false?'已关闭':'已开启'}，主动天气最多每6小时更新，本轮实况以天气块为准。\n`+
    '提新功能前核对已有项，可建议改进，不把主动消息等已有项说成缺失。关闭/待配置不等于未开发。开关/上传/切线路须用户在页面操作，别声称聊天中已代改。实时通话、iPhone锁屏推送尚未接入。被问功能时再自然提及，平时不背清单。\n';
};
