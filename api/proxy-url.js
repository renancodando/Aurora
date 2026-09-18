const privados=[
  /^localhost$/i,/^127\./,/^10\./,/^192\.168\./,/^169\.254\./,/^0\./,/^::1$/i,/\.local$/i,
  /^172\.(1[6-9]|2\d|3[01])\./
];

function validar(valor){
  const url=new URL(valor);
  if(!['http:','https:'].includes(url.protocol))throw new Error('protocolo inválido');
  if(privados.some(x=>x.test(url.hostname)))throw new Error('endereço privado bloqueado');
  return url;
}

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({erro:'método não permitido'});
  try{
    let atual=validar(String(req.query.url||''));
    let resposta;

    for(let i=0;i<4;i++){
      const controle=new AbortController();
      const timer=setTimeout(()=>controle.abort(),9000);
      resposta=await fetch(atual,{redirect:'manual',signal:controle.signal,headers:{'User-Agent':'AuroraLayoutLab/1.0'}});
      clearTimeout(timer);

      if([301,302,303,307,308].includes(resposta.status)){
        const local=resposta.headers.get('location');
        if(!local)throw new Error('redirecionamento inválido');
        atual=validar(new URL(local,atual).toString());
        continue;
      }
      break;
    }

    if(!resposta?.ok)throw new Error('não consegui abrir essa página');
    const tipo=resposta.headers.get('content-type')||'';
    if(!tipo.includes('text/html'))throw new Error('a URL não retornou uma página HTML');

    const html=await resposta.text();
    if(html.length>5_000_000)throw new Error('página grande demais para importação por URL');

    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({html,finalUrl:atual.toString()});
  }catch(e){
    return res.status(400).json({erro:e.message||'não consegui importar a URL'});
  }
}
