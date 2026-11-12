import os,subprocess,secrets,time,json,signal,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
os.umask(0o077)
r=Path('/home/ubuntu/.local/share/ourhome-douyin');r.mkdir(mode=0o700,exist_ok=True)
children=[]
def stop(*a):raise KeyboardInterrupt
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
def spawn(args,env=None):
 p=subprocess.Popen(args,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);children.append(p);return p
try:
 auth=r/'Xauthority';auth.touch(mode=0o600,exist_ok=True)
 subprocess.run(['xauth','-f',str(auth),'add',':95','.',secrets.token_hex(16)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 env={**os.environ,'DISPLAY':':95','XAUTHORITY':str(auth)}
 spawn(['Xvfb',':95','-screen','0','1280x900x24','-nolisten','tcp','-auth',str(auth)],env);time.sleep(1)
 key=r/'desktop-key'
 if not key.exists():key.write_text(secrets.token_urlsafe(9)[:8])
 passwd=r/'desktop.pass'
 subprocess.run(['x11vnc','-storepasswd',key.read_text(),str(passwd)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 spawn(['x11vnc','-display',':95','-auth',str(auth),'-localhost','-rfbport','5907','-rfbauth',str(passwd),'-forever','-shared','-noxdamage'],env)
 spawn(['websockify','--web=/usr/share/novnc/','127.0.0.1:3198','127.0.0.1:5907'],env)
 with sync_playwright() as p:
  ctx=p.chromium.launch_persistent_context(str(r/'cloud-profile'),executable_path='/usr/bin/google-chrome',headless=False,viewport={'width':1240,'height':820},env=env,args=['--disable-dev-shm-usage','--window-size=1280,900','--window-position=0,0','--remote-debugging-port=3199','--remote-debugging-address=127.0.0.1'])
  marker=r/'cloud-session-imported'
  if not marker.exists():
   state=json.loads((r/'account-state.json').read_text());ctx.add_cookies(state.get('cookies',[]))
   origins=state.get('origins',[])
   ctx.add_init_script('const origins='+json.dumps(origins)+';for(const o of origins){if(location.origin===o.origin)for(const v of o.localStorage||[])localStorage.setItem(v.name,v.value);}')
   marker.write_text(str(time.time()))
  page=ctx.pages[0] if ctx.pages else ctx.new_page()
  try:page.goto('https://www.douyin.com/',wait_until='domcontentloaded',timeout=40000)
  except:pass
  (r/'desktop-ready').write_text(str(time.time()))
  try:
   while True:
    ctx.storage_state(path=str(r/'cloud-state.tmp'));os.replace(r/'cloud-state.tmp',r/'cloud-state.json')
    page.wait_for_timeout(10000)
  finally:ctx.close()
except KeyboardInterrupt:pass
finally:
 for p in reversed(children):
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill()
