const CACHE='aurora-projetos-v1';

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

function projetoDoReferrer(referrer){
  try{
    const u=new URL(referrer);
    const m=u.pathname.match(/^\/__aurora__\/([^/]+)\//);
    return m?.[1]||null;
  }catch{return null}
}

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(url.pathname.startsWith('/__aurora__/')){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const limpa=new URL(url);limpa.search='';
      return await cache.match(limpa.toString())||new Response('Arquivo não encontrado',{status:404});
    })());
    return;
  }

  const projeto=projetoDoReferrer(event.request.referrer);
  if(!projeto)return;

  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const virtual=new URL('/__aurora__/'+projeto+url.pathname,self.location.origin);
    const resposta=await cache.match(virtual.toString());
    return resposta||fetch(event.request);
  })());
});
