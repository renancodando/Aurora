const cache=new Map();
let indisponivelAte=0;

function chave(problema,resultado){
  const c=problema.contextoIA||{};
  const e=c.elemento||{};
  return [
    problema.tipo,
    problema.seletor,
    Math.round(resultado.largura/40)*40,
    Math.round(e.largura||problema.rect?.width||0),
    e.animationName||'',
    e.transform&&e.transform!=='none'?'transform':'',
    c.contexto?.recorteControlado?'clip':''
  ].join('|');
}

function caso(problema,resultado,id){
  const c=problema.contextoIA||{};
  return {
    id,
    tipo:problema.tipo,
    seletor:problema.seletor,
    titulo:problema.titulo,
    viewport:{largura:resultado.largura,altura:resultado.altura},
    elemento:c.elemento||{
      largura:problema.rect?.width||0,
      altura:problema.rect?.height||0,
      left:problema.rect?.x||0,
      right:problema.rect?.right||0
    },
    contexto:c.contexto||{},
    evidencias:c.evidencias||[]
  };
}

function recalcular(resultado){
  const problemas=resultado.problemas;
  const criticos=problemas.filter(p=>p.severidade==='critico'&&!p.ignorarCorrecao).length;
  const avisos=problemas.filter(p=>p.severidade==='aviso').length;
  const infos=problemas.filter(p=>p.severidade==='info').length;
  const penalidade=Math.min(100,criticos*14+avisos*3);
  return {...resultado,criticos,avisos,infos,integridade:Math.max(0,100-penalidade)};
}

function aplicarDecisao(problema,decisao){
  const base={...problema,ia:decisao};

  if(decisao.classificacao==='comportamento_intencional'){
    return {
      ...base,
      titulo:'Comportamento intencional preservado',
      detalhe:decisao.motivo,
      severidade:'info',
      ignorarCorrecao:true
    };
  }

  if(decisao.classificacao==='ambiguo'){
    return {
      ...base,
      titulo:'Revisão inteligente inconclusiva',
      detalhe:decisao.motivo,
      severidade:'aviso',
      ignorarCorrecao:true
    };
  }

  return {
    ...base,
    detalhe:(problema.detalhe?problema.detalhe+' · ':'')+decisao.motivo,
    severidade:problema.severidadeOriginal||problema.severidade||'critico',
    ignorarCorrecao:!decisao.corrigir
  };
}

export async function resolverAmbiguidades(resultado){
  const ambiguos=resultado.problemas.filter(p=>p.requerIA);
  if(!ambiguos.length)return {resultado,alterado:false,estado:'sem-casos'};

  const agora=Date.now();
  if(agora<indisponivelAte)return {resultado,alterado:false,estado:'indisponivel'};

  const decisoes=new Map();
  const pendentes=[];

  for(const p of ambiguos){
    const k=chave(p,resultado);
    if(cache.has(k))decisoes.set(p,cache.get(k));
    else pendentes.push({problema:p,chave:k});
  }

  if(pendentes.length){
    if(location.hostname.endsWith('github.io')){
      return {resultado,alterado:false,estado:'github-pages'};
    }

    try{
      const payload=pendentes.slice(0,10).map((x,i)=>caso(x.problema,resultado,'c'+i));
      const resposta=await fetch('/api/inteligencia-layout',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({casos:payload})
      });

      const dados=await resposta.json().catch(()=>({}));
      if(!resposta.ok)throw new Error(dados.erro||'análise inteligente indisponível');

      const porId=new Map((dados.resultados||[]).map(x=>[x.id,x]));
      pendentes.slice(0,10).forEach((x,i)=>{
        const decisao=porId.get('c'+i);
        if(decisao){
          cache.set(x.chave,decisao);
          decisoes.set(x.problema,decisao);
        }
      });
    }catch(e){
      indisponivelAte=Date.now()+60000;
      return {resultado,alterado:false,estado:'indisponivel',erro:e.message};
    }
  }

  if(!decisoes.size)return {resultado,alterado:false,estado:'sem-resposta'};

  const problemas=resultado.problemas.map(p=>decisoes.has(p)?aplicarDecisao(p,decisoes.get(p)):p);
  return {resultado:recalcular({...resultado,problemas}),alterado:true,estado:'ok'};
}

export function limparCacheInteligencia(){
  cache.clear();
  indisponivelAte=0;
}
