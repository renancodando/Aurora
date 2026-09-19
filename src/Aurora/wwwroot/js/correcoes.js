function bloco(seletor,regras){
  return `${seletor}{${regras.join('')}}`;
}

function numero(v,fallback=0){
  const n=Number(v);
  return Number.isFinite(n)?n:fallback;
}

function limiteNatural(contexto){
  const atual=numero(contexto?.largura,768);
  const fraturas=(contexto?.fraturas||[]).map(x=>numero(x.largura,NaN)).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!fraturas.length)return Math.max(320,Math.min(1800,atual+24));
  return fraturas.reduce((melhor,x)=>Math.abs(x-atual)<Math.abs(melhor-atual)?x:melhor,fraturas[0]);
}

function seletorSeguro(sel){
  return sel&&sel!=='html'&&sel!=='body';
}

function descricaoAntes(p,contexto){
  if(p.tipo==='overflow'){
    const extra=Math.ceil(Math.max(0,numero(p.rect?.right)-numero(contexto?.largura),-numero(p.rect?.x)));
    return [
      `viewport: ${numero(contexto?.largura)}px`,
      `largura do elemento: ${Math.round(numero(p.rect?.width))}px`,
      `excesso aproximado: ${extra}px`
    ];
  }
  if(p.tipo==='largura-fixa'){
    return [
      `width calculado: ${Math.round(numero(p.dados?.widthPx))}px`,
      `viewport: ${numero(contexto?.largura)}px`,
      'largura rígida podia ultrapassar o espaço disponível'
    ];
  }
  if(p.tipo==='texto'){
    return [
      `conteúdo: ${Math.round(numero(p.dados?.scrollWidth))}×${Math.round(numero(p.dados?.scrollHeight))}px`,
      `caixa: ${Math.round(numero(p.dados?.clientWidth))}×${Math.round(numero(p.dados?.clientHeight))}px`,
      'texto estava preso ao tamanho atual da caixa'
    ];
  }
  if(p.tipo==='imagem'){
    return [
      `proporção original: ${numero(p.dados?.natural).toFixed(3)}`,
      `proporção exibida: ${numero(p.dados?.atual).toFixed(3)}`,
      'a imagem podia ser deformada'
    ];
  }
  return [p.detalhe||'comportamento detectado na análise'];
}

function explicacao(p){
  if(p.tipo==='overflow')return 'Limita o elemento ao espaço do contêiner sem esconder conteúdo.';
  if(p.tipo==='largura-fixa')return 'Troca a rigidez por uma largura segura, mantendo o tamanho original como teto.';
  if(p.tipo==='texto')return 'Libera a altura e permite quebra de linha apenas quando o conteúdo precisa.';
  if(p.tipo==='imagem')return 'Preserva a proporção natural da mídia dentro do espaço disponível.';
  return 'Ajuste responsivo calculado pelo AURORA.';
}

function montarPlano(problemas,contexto={}){
  const mapa=new Map();
  const containers=new Map();
  const itens=new Map();

  const garantirItem=p=>{
    const chave=`${p.tipo}|${p.seletor}`;
    if(!itens.has(chave)){
      itens.set(chave,{
        tipo:p.tipo,
        titulo:p.titulo,
        seletor:p.seletor,
        antes:descricaoAntes(p,contexto),
        depois:[],
        explicacao:explicacao(p)
      });
    }
    return itens.get(chave);
  };

  const adicionar=(p,regra)=>{
    if(!seletorSeguro(p.seletor))return;
    if(!mapa.has(p.seletor))mapa.set(p.seletor,new Set());
    mapa.get(p.seletor).add(regra);
    garantirItem(p).depois.push(regra);
  };

  for(const p of problemas){
    if(!['responsividade',undefined].includes(p.grupo))continue;

    if(p.tipo==='overflow'||p.tipo==='largura-fixa'){
      adicionar(p,'min-inline-size:0 !important;');
      adicionar(p,'max-inline-size:100% !important;');
      adicionar(p,'box-sizing:border-box !important;');
      if(numero(p.dados?.widthPx)>0)adicionar(p,`inline-size:min(100%,${Math.round(p.dados.widthPx)}px) !important;`);
    }

    if(p.tipo==='texto'){
      adicionar(p,'min-inline-size:0 !important;');
      adicionar(p,'max-block-size:none !important;');
      adicionar(p,'block-size:auto !important;');
      adicionar(p,'white-space:normal !important;');
      adicionar(p,'overflow-wrap:anywhere !important;');
      adicionar(p,'text-wrap:pretty;');
    }

    if(p.tipo==='imagem'){
      adicionar(p,'max-inline-size:100% !important;');
      adicionar(p,'block-size:auto !important;');
      adicionar(p,'object-fit:contain;');
      adicionar(p,'aspect-ratio:auto;');
    }

    const pai=p.contexto?.parentSelector;
    const display=p.contexto?.parentDisplay;
    if(pai&&['flex','grid','inline-flex','inline-grid'].includes(display)){
      if(!containers.has(pai))containers.set(pai,{tipo:display.includes('flex')?'flex':'grid',filhos:new Set(),fontSize:0,paddingInline:0,origens:new Set()});
      const c=containers.get(pai);
      if(seletorSeguro(p.seletor))c.filhos.add(p.seletor);
      c.fontSize=Math.max(c.fontSize,numero(p.contexto?.fontSize));
      c.paddingInline=Math.max(c.paddingInline,numero(p.contexto?.paddingInline));
      c.origens.add(`${p.tipo}|${p.seletor}`);
    }
  }

  const bp=Math.round(limiteNatural(contexto));
  const estrutural=Math.max(300,bp-96);
  const linhas=[
    '/* AURORA · responsividade adaptativa determinística */',
    '@layer aurora-base,aurora-fluid,aurora-container,aurora-estrutura;',
    '@layer aurora-base{',
    ':where(img,video,canvas,svg){max-inline-size:100%;block-size:auto;}',
    ':where(*,::before,::after){box-sizing:border-box;}',
    '}'
  ];

  const diretas=[];
  for(const [sel,regras] of mapa)diretas.push(bloco(sel,[...regras]));
  if(diretas.length){
    linhas.push('@layer aurora-fluid{');
    linhas.push(`@media (max-width:${bp}px){${diretas.join('')}}`);
    linhas.push('}');
  }

  let indice=0;
  const estruturas=[];

  for(const [pai,dados] of containers){
    indice++;
    const nome=`aurora-c${indice}`;
    const filhos=[...dados.filhos];
    const paddingMax=dados.paddingInline>0?Math.max(8,Math.round(dados.paddingInline/2)):24;
    const fonteMax=dados.fontSize>0?Math.round(dados.fontSize*100)/100:16;
    const regraContainer=`${pai}{container-type:inline-size;container-name:${nome};min-inline-size:0;}`;
    const regraEspaco=`@container ${nome} (max-width:${bp}px){${pai}{gap:clamp(8px,2.2cqi,24px) !important;padding-inline:clamp(8px,3cqi,${paddingMax}px) !important;}}`;

    linhas.push('@layer aurora-container{');
    linhas.push(regraContainer);
    linhas.push(regraEspaco);

    if(filhos.length){
      linhas.push(`@container ${nome} (max-width:${bp}px){${filhos.map(sel=>bloco(sel,['min-inline-size:0 !important;','max-inline-size:100% !important;',`font-size:clamp(${Math.max(11,Math.round(fonteMax*.82))}px,3.4cqi,${fonteMax}px);`])).join('')}}`);
    }
    linhas.push('}');

    for(const origem of dados.origens){
      const item=itens.get(origem);
      if(item){
        item.depois.push(`container: ${pai} → ${nome}`);
        item.depois.push(`gap/padding passam a responder ao espaço do componente até ${bp}px`);
      }
    }

    if(dados.tipo==='flex'){
      estruturas.push(`@container ${nome} (max-width:${estrutural}px){${pai}{flex-wrap:wrap !important;}${filhos.map(sel=>bloco(sel,['flex:1 1 min(100%,260px);','min-inline-size:min(100%,220px) !important;'])).join('')}}`);
      for(const origem of dados.origens){
        const item=itens.get(origem);
        if(item)item.depois.push(`flex-wrap apenas abaixo de ${estrutural}px, como último recurso`);
      }
    }

    if(dados.tipo==='grid'){
      estruturas.push(`@container ${nome} (max-width:${estrutural}px){${pai}{grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)) !important;}}`);
      for(const origem of dados.origens){
        const item=itens.get(origem);
        if(item)item.depois.push(`grid auto-fit apenas abaixo de ${estrutural}px, como último recurso`);
      }
    }
  }

  if(estruturas.length){
    linhas.push('@layer aurora-estrutura{');
    linhas.push(...estruturas);
    linhas.push('}');
  }

  linhas.push(`@media (max-width:${bp}px) and (orientation:portrait){:where(dialog,[role="dialog"]){max-inline-size:calc(100vi - 24px);max-block-size:calc(100vb - 24px);}}`);
  linhas.push('@media (prefers-reduced-motion:reduce){:where(*,::before,::after){scroll-behavior:auto !important;}}');

  return {
    css:linhas.join('\n'),
    itens:[...itens.values()].map(item=>({...item,depois:[...new Set(item.depois)]})),
    breakpoint:bp,
    breakpointEstrutural:estrutural
  };
}

export function gerarCorrecoes(problemas,contexto={}){
  return montarPlano(problemas,contexto).css;
}

export function descreverCorrecoes(problemas,contexto={}){
  return montarPlano(problemas,contexto);
}

export function aplicarNoPreview(iframe,css){
  const doc=iframe.contentDocument;
  if(!doc)return;
  let style=doc.querySelector('#aurora-ajustes-preview');
  if(!style){
    style=doc.createElement('style');
    style.id='aurora-ajustes-preview';
    doc.head?.appendChild(style);
  }
  style.textContent=css;
}

export function limparPreview(iframe){
  iframe.contentDocument?.querySelector('#aurora-ajustes-preview')?.remove();
}
