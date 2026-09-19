const dns=require('node:dns').promises;
const net=require('node:net');

const LIMITE_BYTES=5_000_000;
const REDIRECIONAMENTOS=4;
const TIMEOUT_MS=9000;
const janela=new Map();

function ipPrivado(ip){
  if(!ip)return true;

  if(ip.startsWith('::ffff:')){
    const mapeado=ip.slice(7);
    if(net.isIP(mapeado)===4)return ipPrivado(mapeado);
  }

  const tipo=net.isIP(ip);
  if(tipo===4){
    const p=ip.split('.').map(Number);
    if(p[0]===0||p[0]===10||p[0]===127)return true;
    if(p[0]===100&&p[1]>=64&&p[1]<=127)return true;
    if(p[0]===169&&p[1]===254)return true;
    if(p[0]===172&&p[1]>=16&&p[1]<=31)return true;
    if(p[0]===192&&p[1]===168)return true;
    if(p[0]>=224)return true;
    return false;
  }

  if(tipo===6){
    const v=ip.toLowerCase();
    if(v==='::'||v==='::1')return true;
    if(v.startsWith('fc')||v.startsWith('fd'))return true;
    if(/^fe[89ab]/i.test(v))return true;
    if(v.startsWith('ff'))return true;
    return false;
  }

  return true;
}

async function validar(valor){
  let url;
  try{url=new URL(valor);}catch{throw new Error('URL inválida');}

  if(!['http:','https:'].includes(url.protocol))throw new Error('protocolo inválido');
  if(url.username||url.password)throw new Error('credenciais na URL não são permitidas');

  const host=url.hostname.toLowerCase();
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal'))
    throw new Error('endereço privado bloqueado');

  if(net.isIP(host)){
    if(ipPrivado(host))throw new Error('endereço privado bloqueado');
    return url;
  }

  let enderecos;
  try{
    enderecos=await dns.lookup(host,{all:true,verbatim:true});
  }catch{
    throw new Error('não consegui resolver o endereço');
  }

  if(!enderecos.length||enderecos.some(x=>ipPrivado(x.address)))
    throw new Error('endereço privado ou reservado bloqueado');

  return url;
}

function mesmaOrigem(req){
  const origem=req.headers.origin;
  if(!origem)return true;
  try{
    const host=String(req.headers['x-forwarded-host']||req.headers.host||'').toLowerCase();
    return new URL(origem).host.toLowerCase()===host;
  }catch{return false;}
}

function permitido(req){
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'desconhecido').split(',')[0].trim();
  const agora=Date.now();
  const atual=janela.get(ip);
  if(!atual||agora-atual.inicio>10*60*1000){
    janela.set(ip,{inicio:agora,total:1});
    return true;
  }
  atual.total++;
  return atual.total<=30;
}

async function textoLimitado(resposta){
  const tamanho=Number(resposta.headers.get('content-length')||0);
  if(tamanho>LIMITE_BYTES)throw new Error('página grande demais para importação por URL');

  const leitor=resposta.body?.getReader();
  if(!leitor){
    const texto=await resposta.text();
    if(Buffer.byteLength(texto,'utf8')>LIMITE_BYTES)throw new Error('página grande demais para importação por URL');
    return texto;
  }

  const partes=[];
  let total=0;
  while(true){
    const {done,value}=await leitor.read();
    if(done)break;
    total+=value.byteLength;
    if(total>LIMITE_BYTES){
      try{await leitor.cancel();}catch{}
      throw new Error('página grande demais para importação por URL');
    }
    partes.push(Buffer.from(value));
  }
  return Buffer.concat(partes,total).toString('utf8');
}

module.exports=async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({erro:'método não permitido'});
  if(!mesmaOrigem(req))return res.status(403).json({erro:'origem não permitida'});
  if(!permitido(req))return res.status(429).json({erro:'muitas importações em pouco tempo'});

  try{
    let atual=await validar(String(req.query.url||''));
    let resposta=null;

    for(let i=0;i<=REDIRECIONAMENTOS;i++){
      const controle=new AbortController();
      const timer=setTimeout(()=>controle.abort(),TIMEOUT_MS);

      try{
        resposta=await fetch(atual,{
          redirect:'manual',
          signal:controle.signal,
          headers:{
            'User-Agent':'AuroraLayoutLab/1.0',
            'Accept':'text/html,application/xhtml+xml;q=0.9'
          }
        });
      }finally{
        clearTimeout(timer);
      }

      if([301,302,303,307,308].includes(resposta.status)){
        const local=resposta.headers.get('location');
        if(!local)throw new Error('redirecionamento inválido');
        if(i===REDIRECIONAMENTOS)throw new Error('redirecionamentos demais');
        atual=await validar(new URL(local,atual).toString());
        continue;
      }
      break;
    }

    if(!resposta?.ok)throw new Error('não consegui abrir essa página');

    const tipo=(resposta.headers.get('content-type')||'').toLowerCase();
    if(!tipo.includes('text/html')&&!tipo.includes('application/xhtml+xml'))
      throw new Error('a URL não retornou uma página HTML');

    const html=await textoLimitado(resposta);

    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    return res.status(200).json({html,finalUrl:atual.toString()});
  }catch(e){
    const mensagem=e?.name==='AbortError'?'a página demorou demais para responder':e?.message;
    return res.status(400).json({erro:mensagem||'não consegui importar a URL'});
  }
};
