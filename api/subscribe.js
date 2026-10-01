// api/subscribe.js — member/email capture (your LL.track/account module POSTs here).
// Keeps things flexible so you can migrate the CRM without rewriting the frontend:
//   1) LL_CRM_WEBHOOK  -> forwards the JSON to your existing Apps Script doPost
//                         (deploy code.html's llSubscribe as a Web App = keep the Google Sheet CRM)
//   2) RESEND_API_KEY + RESEND_AUDIENCE_ID -> also add the contact to a Resend audience
//   3) neither set      -> validates + returns ok (no-op sink; nothing breaks)
//
// Body: { email, name, consent, watch:[...], site, tz, ... }

function readBody(req){
  return new Promise((resolve)=>{
    if(req.body){ // Vercel may pre-parse
      try{ return resolve(typeof req.body==='string'?JSON.parse(req.body):req.body); }catch(e){ return resolve({}); }
    }
    let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{ resolve(JSON.parse(d||'{}')); }catch(e){ resolve({}); } });
  });
}
const okEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());

export default async function handler(req,res){
  if(req.method!=='POST'){ res.setHeader('Allow','POST'); return res.status(405).json({ok:false,error:'POST only'}); }
  const data=await readBody(req);
  const email=String(data.email||'').trim().toLowerCase();
  if(!okEmail(email)) return res.status(400).json({ok:false,error:'bad email'});
  // `meta` is an opaque passthrough for whatever a given form needs to record beyond an
  // address -- the /wholesale interest form sends company, state and rough volume through it.
  // Kept to scalars and capped so a form cannot post an arbitrary object into the CRM: the
  // sinks downstream are a Google Sheet and Resend, neither of which wants nested JSON.
  const meta={};
  if(data.meta && typeof data.meta==='object' && !Array.isArray(data.meta)){
    for(const [k,v] of Object.entries(data.meta).slice(0,12)){
      if(v==null || typeof v==='object') continue;
      meta[String(k).slice(0,32)]=String(v).slice(0,200);
    }
  }
  const payload={ email, name:String(data.name||''), consent:data.consent!==false,
    watch:Array.isArray(data.watch)?data.watch:[], site:data.site||'legal-leaf',
    tz:data.tz||'', meta, updated:Date.now() };

  const tasks=[];
  // 1) forward to Apps Script CRM webhook (keep the Google Sheet)
  if(process.env.LL_CRM_WEBHOOK){
    tasks.push(fetch(process.env.LL_CRM_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{}));
  }
  // 2) Resend audience (optional)
  if(process.env.RESEND_API_KEY && process.env.RESEND_AUDIENCE_ID){
    tasks.push(fetch(`https://api.resend.com/audiences/${process.env.RESEND_AUDIENCE_ID}/contacts`,{
      method:'POST', headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email, first_name:payload.name.split(' ')[0]||'', unsubscribed:!payload.consent})
    }).catch(()=>{}));
  }
  try{ await Promise.all(tasks); }catch(e){}
  return res.status(200).json({ok:true, email, sinks:{ webhook:!!process.env.LL_CRM_WEBHOOK, resend:!!(process.env.RESEND_API_KEY&&process.env.RESEND_AUDIENCE_ID) }});
}
