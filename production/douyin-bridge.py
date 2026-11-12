import sys,json,re,time,hashlib,os
from pathlib import Path
from playwright.sync_api import sync_playwright
BODY=json.load(sys.stdin);action=BODY.get('action','read')
def fail(msg):print(json.dumps({'error':msg},ensure_ascii=False));sys.exit(0)
try:
 with sync_playwright() as p:
  b=p.chromium.connect_over_cdp('http://127.0.0.1:3199',timeout=10000);c=b.contexts[0]
  if action in ['read','status']:
   page=next((x for x in c.pages if x.url.startswith('https://www.douyin.com/')),None)
   if not page:fail('请先在服务器浏览器登录并打开抖音推荐页')
   if '验证码' in page.title():fail('抖音需要你手动完成验证，自动浏览已暂停')
   if action=='status':print(json.dumps({'ready':True}));sys.exit(0)
   if BODY.get('refresh'):
    page.reload(wait_until='domcontentloaded',timeout=30000);page.wait_for_timeout(4000)
   if '验证码' in page.title():fail('抖音需要你手动完成验证，自动浏览已暂停')
   items=page.locator('[data-id],[data-item-id],[data-aweme-id]').evaluate_all(r'''(es)=>es.map(e=>({id:e.getAttribute('data-aweme-id')||e.getAttribute('data-item-id')||e.getAttribute('data-id'),text:(e.innerText||'').trim().slice(0,700)})).filter(x=>/^\d{15,25}$/.test(x.id)&&x.text.length>12).slice(0,12)''')
   unique={x['id']:{'id':x['id'],'title':x['text'],'url':'https://www.douyin.com/video/'+x['id'],'observedAt':int(time.time()*1000),'basis':'仅网页标题与简介，未分析完整视频画面或音频'} for x in items}
   if not unique:fail('推荐内容暂未加载，请在服务器浏览器打开推荐或精选列表后重试')
   print(json.dumps({'items':list(unique.values())[:5]},ensure_ascii=False));sys.exit(0)
  if action=='publish':
   title=BODY.get('title','');body=BODY.get('body','');token=BODY.get('id','')
   if not title or len(title)>20 or not body or len(body)>900 or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',token):fail('作品内容无效')
   from PIL import Image,ImageDraw,ImageFont
   import subprocess,textwrap
   root=Path(os.environ.get('HOME_DATA','data'))/'douyin-art';root.mkdir(mode=0o700,parents=True,exist_ok=True)
   image=root/(token+'.jpg');fontpath=subprocess.check_output(['fc-match','sans-serif:lang=zh','--format','%{file}'],text=True)
   im=Image.new('RGB',(720,960),'#fcf1f0');d=ImageDraw.Draw(im);d.rectangle((32,32,688,928),outline='#b3935a',width=2)
   d.text((72,100),'Little Thoughts · AI',fill='#b3935a',font=ImageFont.truetype(fontpath,22))
   y=180
   for line in textwrap.wrap(title,14):d.text((72,y),line,fill='#9e6477',font=ImageFont.truetype(fontpath,38));y+=60
   y+=38
   for line in textwrap.wrap(body[:150].replace('\n',' '),18)[:10]:d.text((72,y),line,fill='#665552',font=ImageFont.truetype(fontpath,28));y+=46
   im.save(image,quality=88)
   q=c.new_page()
   clicked=False;stage="打开图文页"
   try:
    q.goto('https://creator.douyin.com/creator-micro/content/upload?default-tab=3',wait_until='domcontentloaded',timeout=30000)
    stage='上传图片';q.locator('input[type=file]').first.set_input_files(str(image),timeout=15000)
    stage='等待编辑器';q.get_by_placeholder('添加作品标题').wait_for(timeout=20000)
    stage='填写标题';q.get_by_placeholder('添加作品标题').fill(title)
    stage='填写正文';editor=q.locator('[contenteditable=true][data-placeholder="添加作品描述..."]');editor.fill(body+'\n#AI日常 #AI生成')
    # Never submit while the media upload is incomplete or failed.
    stage='等待图片上传完成';q.wait_for_function("!document.body.innerText.includes('取消上传')",timeout=45000)
    if '上传失败' in q.locator('body').inner_text():fail('图片上传失败，本次没有发布')
    stage='设置AI声明';
    for label in ['完成','我知道了','跳过']:
     tip=q.get_by_text(label,exact=True)
     for i in range(tip.count()):
      if tip.nth(i).is_visible():
       try:tip.nth(i).click(timeout=1500)
       except:pass
    q.get_by_text('请选择自主声明',exact=True).click(timeout=5000)
    stage='选择AI类型';radio=q.locator('input[type=radio]').first
    radio.wait_for(state='attached',timeout=5000)
    label=radio.locator('xpath=ancestor::label[1]')
    label_text=re.sub(r'[\s\u200b\ufeff]','',label.inner_text())
    if not re.fullmatch('内容由A[Iil]生成',label_text):fail('平台声明选项已变化，请人工确认，本次没有发布')
    label.click(timeout=5000)
    stage='确认AI声明';q.get_by_role('button',name='确定',exact=True).last.click(timeout=5000)
    if BODY.get('dryRun'):
     print(json.dumps({'status':'prepared','aiLabel':True,'publishButtonCount':q.get_by_role('button',name='发布',exact=True).count()}));sys.exit(0)
    button=q.get_by_role('button',name='发布',exact=True)
    if button.count()!=1 or not button.is_enabled():fail('发布按钮暂不可用，本次没有发布')
    clicked=True;button.click(timeout=5000)
    q.wait_for_timeout(5000)
    text=q.locator('body').inner_text()
    if '发布成功' in text:print(json.dumps({'status':'published','managementUrl':'https://creator.douyin.com/creator-micro/content/manage'}));sys.exit(0)
    fail('发布结果待人工核实，请先检查作品列表；系统不会重试，避免重复发布')
   except Exception:
    fail('发布结果待人工核实，系统不会自动重试' if clicked else stage+'未完成，本次没有点击发布')
   finally:q.close()
  fail('未知操作')
except Exception as e:fail('服务器抖音连接暂不可用，请检查登录或验证状态')
