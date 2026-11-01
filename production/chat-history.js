'use strict';
module.exports=function chatHistory(db,{proactive=false}={}) {
  if(!proactive)return db.prepare('SELECT * FROM messages WHERE archived=0 ORDER BY id DESC LIMIT 30').all().reverse();
  const recent=db.prepare('SELECT * FROM messages WHERE archived=0 ORDER BY id DESC LIMIT 16').all();
  const user=db.prepare("SELECT id FROM messages WHERE archived=0 AND role='me' ORDER BY id DESC LIMIT 1").get();
  const anchor=user?db.prepare('SELECT * FROM messages WHERE archived=0 AND id<=? ORDER BY id DESC LIMIT 12').all(user.id):[];
  // Preserve the last actual conversation even after many proactive messages.
  return [...new Map([...anchor,...recent].map(m=>[m.id,m])).values()].sort((a,b)=>a.id-b.id);
};
