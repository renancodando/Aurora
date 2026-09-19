function numero(v,fallback=0){
  const n=Number(v);
  return Number.isFinite(n)?n:fallback;
}

function seletorSeguro(sel){
  return Boolean(sel&&sel!=='html'&&sel!=='body');
}

function viewportDoProblema(p,contexto){
  return Math.round(
    numero(p?.larguraOcorrencia,
      numero(p?.dados?.viewport,
        numero(contexto?.largura,0)))
  );
}

function breakpointDoProblema(p,contexto){
  const ultima=numero(p?.ultimaLargura,0);
  const ocorrencia=viewportDoProblema(p,contexto);
  const base=Math.max(ultima,ocorrencia);
  if(base<=0)return null;
  if(base>=3438)return null;

  const fraturas=(contexto?.fraturas||[])
    .map(x=>numero(x?.largura,NaN))
    .filter(Number.isFinite)
    .filter(x=>x>=base&&x<=base+180)
    .sort((a,b)=>a-b);

  if(fraturas.length)return Math.min(3440,Math.round(fraturas[0]));
  return Math.min(3440,Math.round(base+2));
}

function excessoDoProblema(p,viewport){
  const informado=numero(p?.maiorExcesso,-1);
  if(informado>=0)return Math.ceil(informado);
  return Math.ceil(Math.max(
    0,
    numero(p?.rect?.right)-viewport,
    -numero(p?.rect?.x)
  ));
}

function faixaTexto(p){
  const larguras=(p?.larguras||[]).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!larguras.length)return null;
  if(larguras.length===1)return `${larguras[0]}px`;
  return `${larguras[0]}–${larguras[larguras.length-1]}px`;
}

function descricaoAntes(p,contexto){
  const viewport=viewportDoProblema(p,contexto);
  const largura=Math.round(numero(p?.dados?.widthPx,numero(p?.rect?.width,numero(p?.dados?.largura))));
  const espaco=Math.round(numero(p?.dados?.parentClientWidth,viewport));
  const excesso=excessoDoProblema(p,viewport);
  const faixa=faixaTexto(p);

  if(p.tipo==='overflow'){
    const linhas=[
      `viewport onde ocorreu: ${viewport}px`,
      `largura do elemento: ${largura}px`,
      `espaço disponível no contêiner: ${espaco}px`,
      `excesso aproximado: ${excesso}px`
    ];
    if(faixa)linhas.push(`detectado na faixa: ${faixa}`);
    if(p.afetadosDerivados)linhas.push(`${p.afetadosDerivados} sintoma(s) descendente(s) agrupado(s) nesta causa`);
    return linhas;
  }

  if(p.tipo==='largura-fixa'){
    const linhas=[
      `width calculado: ${largura}px`,
      `espaço disponível: ${espaco}px`,
      `viewport onde ocorreu: ${viewport}px`
    ];
    if(faixa)linhas.push(`detectado na faixa: ${faixa}`);
    return linhas;
  }

  if(p.tipo==='texto'){
    return [
      `conteúdo: ${Math.round(numero(p?.dados?.scrollWidth))}×${Math.round(numero(p?.dados?.scrollHeight))}px`,
      `caixa: ${Math.round(numero(p?.dados?.clientWidth))}×${Math.round(numero(p?.dados?.clientHeight))}px`,
      `viewport onde ocorreu: ${viewport}px`
    ];
  }

  if(p.tipo==='imagem'){
    return [
      `proporção original: ${numero(p?.dados?.natural).toFixed(3)}`,
      `proporção exibida: ${numero(p?.dados?.atual).toFixed(3)}`,
      `viewport onde ocorreu: ${viewport}px`
    ];
  }

  return [p.detalhe||'comportamento detectado na análise'];
}

function explicacao(p){
  if(p.tipo==='overflow'&&p.causaProvavel==='largura-rigida')
    return 'Mantém o tamanho original como teto e reduz somente quando o contêiner não comporta a largura original.';
  if(p.tipo==='overflow')
    return 'O AURORA encontrou overflow real, mas não aplicou alteração estrutural sem evidência suficiente da causa.';
  if(p.tipo==='largura-fixa')
    return 'Mantém a largura original quando houver espaço e torna o elemento fluido apenas abaixo desse limite.';
  if(p.tipo==='texto')
    return 'Libera o conteúdo para quebrar linha e crescer em altura sem truncar texto.';
  if(p.tipo==='imagem')
    return 'Preserva a proporção natural da mídia e impede que ela ultrapasse o contêiner.';
  return 'Ajuste responsivo mínimo calculado pelo AURORA.';
}

function regrasMinimas(p){
  if(!seletorSeguro(p.seletor))return [];

  if(p.tipo==='overflow'||p.tipo==='largura-fixa'){
    const largura=numero(p?.dados?.widthPx,numero(p?.rect?.width,numero(p?.dados?.largura)));
    const espaco=numero(p?.dados?.parentClientWidth,numero(p?.dados?.viewport));
    const larguraRigida=
      p.causaProvavel==='largura-rigida' ||
      (largura>0&&espaco>0&&largura>espaco+1);

    if(!larguraRigida){
      if(p.ia?.corrigir&&largura>espaco+1){
        return [
          'min-inline-size:0 !important;',
          'max-inline-size:100% !important;',
          'box-sizing:border-box !important;'
        ];
      }
      return [];
    }

    const teto=Math.max(1,Math.round(largura));
    return [
      'min-inline-size:0 !important;',
      `inline-size:min(100%,${teto}px) !important;`,
      'max-inline-size:100% !important;',
      'box-sizing:border-box !important;'
    ];
  }

  if(p.tipo==='texto'){
    return [
      'min-inline-size:0 !important;',
      'max-block-size:none !important;',
      'block-size:auto !important;',
      'white-space:normal !important;',
      'overflow-wrap:anywhere !important;'
    ];
  }

  if(p.tipo==='imagem'){
    return [
      'max-inline-size:100% !important;',
      'block-size:auto !important;',
      'object-fit:contain;',
      'aspect-ratio:auto;'
    ];
  }

  return [];
}

function prioridade(p){
  if(p.tipo==='overflow'&&p.causaProvavel==='largura-rigida')return 5;
  if(p.tipo==='largura-fixa')return 4;
  if(p.tipo==='texto')return 3;
  if(p.tipo==='imagem')return 2;
  if(p.tipo==='overflow')return 1;
  return 0;
}

function deduplicar(problemas){
  const mapa=new Map();

  for(const p of problemas||[]){
    if(!['responsividade',undefined].includes(p.grupo))continue;
    if(p.resumo||p.derivado||p.ignorarCorrecao)continue;
    if(p.requerIA&&(!p.ia||!p.ia.corrigir))continue;
    if(!seletorSeguro(p.seletor))continue;

    const chave=p.seletor;
    const atual=mapa.get(chave);
    if(!atual||prioridade(p)>prioridade(atual)){
      mapa.set(chave,p);
      continue;
    }

    if(atual&&prioridade(p)===prioridade(atual)){
      const excessoP=numero(p.maiorExcesso);
      const excessoAtual=numero(atual.maiorExcesso);
      if(excessoP>excessoAtual)mapa.set(chave,p);
    }
  }

  return [...mapa.values()];
}

function montarPlano(problemas,contexto={}){
  const selecionados=deduplicar(problemas);
  const grupos=new Map();
  const itens=[];
  const ignorados=[];

  for(const p of selecionados){
    const regras=regrasMinimas(p);
    if(!regras.length){
      ignorados.push({
        tipo:p.tipo,
        seletor:p.seletor,
        titulo:p.titulo,
        motivo:'causa insuficientemente determinada para uma alteração automática segura'
      });
      continue;
    }

    const bp=breakpointDoProblema(p,contexto);
    const chave=bp===null?'global':String(bp);
    if(!grupos.has(chave))grupos.set(chave,new Map());
    const seletores=grupos.get(chave);
    if(!seletores.has(p.seletor))seletores.set(p.seletor,new Set());
    regras.forEach(r=>seletores.get(p.seletor).add(r));

    itens.push({
      tipo:p.tipo,
      titulo:p.titulo,
      seletor:p.seletor,
      causa:p.causaProvavel||null,
      viewport:viewportDoProblema(p,contexto),
      breakpoint:bp,
      antes:descricaoAntes(p,contexto),
      depois:regras,
      explicacao:explicacao(p),
      afetadosDerivados:p.afetadosDerivados||0
    });
  }

  const linhas=[
    '/* AURORA · correções responsivas mínimas e determinísticas */',
    '/* O original foi preservado. Cada regra abaixo corresponde a uma causa raiz validada. */'
  ];

  const globais=grupos.get('global');
  if(globais){
    for(const [sel,regras] of globais){
      linhas.push(`${sel}{${[...regras].join('')}}`);
    }
  }

  const breakpoints=[...grupos.keys()]
    .filter(k=>k!=='global')
    .map(Number)
    .filter(Number.isFinite)
    .sort((a,b)=>a-b);

  for(const bp of breakpoints){
    const seletores=grupos.get(String(bp));
    const regras=[];
    for(const [sel,props] of seletores){
      regras.push(`${sel}{${[...props].join('')}}`);
    }
    linhas.push(`@media (max-width:${bp}px){${regras.join('')}}`);
  }

  return {
    css:itens.length?linhas.join('\n'):'',
    itens,
    ignorados,
    breakpoint:breakpoints.length?Math.max(...breakpoints):null,
    breakpointEstrutural:null,
    estrategia:'minima',
    causasRaiz:itens.length,
    sintomasIgnorados:(problemas||[]).reduce((n,p)=>n+numero(p?.afetadosDerivados),0)
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
