const MODELO_CF='@cf/google/gemma-4-26b-a4b-it';
const MODELO_GROQ='openai/gpt-oss-120b';
const LIMITE_CASOS=10;
const LIMITE_TEXTO=4200;

const schema={
  type:'object',
  additionalProperties:false,
  properties:{
    resultados:{
      type:'array',
      maxItems:LIMITE_CASOS,
      items:{
        type:'object',
        additionalProperties:false,
        properties:{
          id:{type:'string'},
          classificacao:{type:'string',enum:['erro_real','comportamento_intencional','ambiguo']},
          confianca:{type:'number',minimum:0,maximum:1},
          corrigir:{type:'boolean'},
          motivo:{type:'string'},
          evidencias:{type:'array',items:{type:'string'},maxItems:8}
        },
        required:['id','classificacao','confianca','corrigir','motivo','evidencias']
      }
    }
  },
  required:['resultados']
};

function cortar(v,max){
  const limite=max||LIMITE_TEXTO;
  return String(v===undefined||v===null?'':v).slice(0,limite);
}

function limparCaso(c){
  c=c||{};
  const elemento=c.elemento||{};
  const contexto=c.contexto||{};
  const viewport=c.viewport||{};
  return {
    id:cortar(c.id,120),
    tipo:cortar(c.tipo,80),
    seletor:cortar(c.seletor,600),
    titulo:cortar(c.titulo,220),
    viewport:{largura:Number(viewport.largura)||0,altura:Number(viewport.altura)||0},
    elemento:{
      largura:Number(elemento.largura)||0,
      altura:Number(elemento.altura)||0,
      left:Number(elemento.left)||0,
      right:Number(elemento.right)||0,
      transform:cortar(elemento.transform,500),
      animationName:cortar(elemento.animationName,300),
      whiteSpace:cortar(elemento.whiteSpace,100),
      display:cortar(elemento.display,100),
      position:cortar(elemento.position,100),
      overflowX:cortar(elemento.overflowX,100)
    },
    contexto:{
      html:cortar(contexto.html),
      css:cortar(contexto.css),
      ancestrais:Array.isArray(contexto.ancestrais)?contexto.ancestrais.slice(0,5).map(function(a){
        a=a||{};
        return {
          seletor:cortar(a.seletor,500),
          display:cortar(a.display,100),
          overflowX:cortar(a.overflowX,100),
          transform:cortar(a.transform,300),
          animationName:cortar(a.animationName,200),
          whiteSpace:cortar(a.whiteSpace,100)
        };
      }):[],
      irmaos:Number(contexto.irmaos)||0,
      animacoes:Number(contexto.animacoes)||0,
      nomeSugereMovimento:Boolean(contexto.nomeSugereMovimento),
      recorteControlado:Boolean(contexto.recorteControlado)
    },
    evidencias:Array.isArray(c.evidencias)?c.evidencias.slice(0,12).map(function(x){return cortar(x,300);}):[]
  };
}

function prompt(casos){
  return JSON.stringify({
    tarefa:'Classifique problemas ambíguos de layout responsivo. Não gere CSS e não reescreva código.',
    regras:[
      'erro_real = o layout realmente quebra e deve ser corrigido',
      'comportamento_intencional = overflow/posição fora da viewport faz parte do componente e deve ser preservado',
      'ambiguo = evidência insuficiente ou conflitante; não autorize correção automática',
      'Ticker, marquee, carrossel, slider, track animado e conteúdo traduzido por transform podem ultrapassar a viewport de propósito',
      'Um filho pequeno fora da viewport não significa que sua largura está errada; verifique posição, transform, animação e recorte do ancestral',
      'Se houver dúvida, corrigir deve ser false'
    ],
    casos:casos
  });
}

function normalizarResposta(valor){
  if(!valor)return null;
  if(typeof valor==='object'&&Array.isArray(valor.resultados))return valor;
  if(typeof valor==='string'){
    const limpo=valor.replace(/^\s*```(?:json)?/i,'').replace(/```\s*$/,'').trim();
    try{return JSON.parse(limpo);}catch{return null;}
  }
  return null;
}

async function cloudflare(casos){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID;
  const token=process.env.CLOUDFLARE_API_TOKEN;
  if(!account||!token)return null;

  const resposta=await fetch('https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/ai/run/'+MODELO_CF,{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({
      messages:[
        {role:'system',content:'Você é o juiz de intenção de layout do AURORA. Seja conservador: não autorize correção se houver possibilidade razoável de comportamento visual intencional.'},
        {role:'user',content:prompt(casos)}
      ],
      response_format:{type:'json_schema',json_schema:schema},
      temperature:0.05,
      max_tokens:1400,
      options:{rejectIfBusy:true}
    })
  });

  if(!resposta.ok)throw new Error('Cloudflare '+resposta.status);
  const dados=await resposta.json();
  const valor=dados&&dados.result?dados.result.response:null;
  const parsed=normalizarResposta(valor);
  if(!parsed)throw new Error('Cloudflare retornou uma resposta não estruturada');
  return Object.assign({modelo:MODELO_CF},parsed);
}

async function groq(casos){
  const token=process.env.GROQ_API_KEY;
  if(!token)return null;

  const resposta=await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({
      model:MODELO_GROQ,
      messages:[
        {role:'system',content:'Você é a segunda opinião do AURORA para casos ambíguos de CSS/layout. Classifique intenção, não escreva correções. Na dúvida, não autorize alteração automática.'},
        {role:'user',content:prompt(casos)}
      ],
      response_format:{type:'json_schema',json_schema:{name:'aurora_layout',strict:true,schema:schema}},
      reasoning_effort:'medium',
      max_completion_tokens:1400
    })
  });

  if(!resposta.ok)throw new Error('Groq '+resposta.status);
  const dados=await resposta.json();
  const valor=dados&&dados.choices&&dados.choices[0]&&dados.choices[0].message?dados.choices[0].message.content:null;
  const parsed=normalizarResposta(valor);
  if(!parsed)throw new Error('Groq retornou uma resposta não estruturada');
  return Object.assign({modelo:MODELO_GROQ},parsed);
}

function mapear(resultados){
  return new Map((resultados||[]).map(function(x){return [String(x.id),x];}));
}

function combinar(casos,principal,segunda){
  const a=mapear(principal&&principal.resultados);
  const b=mapear(segunda&&segunda.resultados);
  return casos.map(function(c){
    const p=a.get(c.id);
    const s=b.get(c.id);

    if(!p&&s)return Object.assign({},s,{modelo:segunda.modelo,segundaOpiniao:false});
    if(!p)return {id:c.id,classificacao:'ambiguo',confianca:0,corrigir:false,motivo:'IA indisponível para este caso.',evidencias:[],modelo:null,segundaOpiniao:false};
    if(!s)return Object.assign({},p,{modelo:principal.modelo,segundaOpiniao:false});

    if(p.classificacao!==s.classificacao||p.corrigir!==s.corrigir){
      return {
        id:c.id,
        classificacao:'ambiguo',
        confianca:Math.max(0.5,Math.min(Number(p.confianca)||0,Number(s.confianca)||0)),
        corrigir:false,
        motivo:'Os modelos discordaram. '+principal.modelo+': '+p.motivo+' | '+segunda.modelo+': '+s.motivo,
        evidencias:Array.from(new Set([].concat(p.evidencias||[],s.evidencias||[]))).slice(0,8),
        modelo:principal.modelo+' + '+segunda.modelo,
        segundaOpiniao:true
      };
    }

    const escolhido=(Number(s.confianca)||0)>=(Number(p.confianca)||0)?s:p;
    return Object.assign({},escolhido,{
      confianca:Math.max(Number(p.confianca)||0,Number(s.confianca)||0),
      evidencias:Array.from(new Set([].concat(p.evidencias||[],s.evidencias||[]))).slice(0,8),
      modelo:principal.modelo+' + '+segunda.modelo,
      segundaOpiniao:true
    });
  });
}

module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({erro:'método não permitido'});

  try{
    const recebidos=req.body&&Array.isArray(req.body.casos)?req.body.casos:[];
    if(!recebidos.length)return res.status(400).json({erro:'nenhum caso enviado'});
    const casos=recebidos.slice(0,LIMITE_CASOS).map(limparCaso).filter(function(c){return c.id;});

    let principal=null;
    let erroPrincipal=null;
    try{principal=await cloudflare(casos);}catch(e){erroPrincipal=e.message;}

    if(!principal){
      let unica=null;
      try{unica=await groq(casos);}catch{}
      if(!unica)return res.status(503).json({
        erro:'IA não configurada ou temporariamente indisponível',
        configurar:['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','GROQ_API_KEY'],
        detalhe:erroPrincipal
      });
      return res.status(200).json({provedor:'groq',resultados:combinar(casos,unica,null)});
    }

    const mapa=mapear(principal.resultados);
    const duvidosos=casos.filter(function(c){
      const r=mapa.get(c.id);
      return !r||r.classificacao==='ambiguo'||Number(r.confianca)<0.88;
    });

    let segunda=null;
    if(duvidosos.length){
      try{segunda=await groq(duvidosos);}catch{}
    }

    const combinados=combinar(casos,principal,segunda);
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({
      provedor:segunda?'cloudflare+groq':'cloudflare',
      modeloPrincipal:principal.modelo,
      modeloFallback:segunda?segunda.modelo:null,
      resultados:combinados
    });
  }catch(e){
    return res.status(500).json({erro:e.message||'falha na análise inteligente'});
  }
};
