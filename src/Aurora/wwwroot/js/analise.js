const IGNORAR=new Set(['HTML','HEAD','META','LINK','SCRIPT','STYLE','TITLE','BASE','NOSCRIPT','SOURCE','BR','TEMPLATE']);

function visivel(el,cs,r){
  return !IGNORAR.has(el.tagName)&&cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity||1)>.01&&r.width>.5&&r.height>.5;
}

function seletor(el){
  if(!el||el.nodeType!==1)return '';
  if(el.id)return '#'+CSS.escape(el.id);
  const partes=[];
  let atual=el;
  while(atual&&atual.tagName&&atual.tagName!=='HTML'&&partes.length<5){
    let p=atual.tagName.toLowerCase();
    const classes=[...atual.classList].filter(c=>!/^aurora-/.test(c)).slice(0,2);
    if(classes.length)p+='.'+classes.map(CSS.escape).join('.');
    else if(atual.parentElement){
      const iguais=[...atual.parentElement.children].filter(x=>x.tagName===atual.tagName);
      if(iguais.length>1)p+=`:nth-of-type(${iguais.indexOf(atual)+1})`;
    }
    partes.unshift(p);
    atual=atual.parentElement;
  }
  return partes.join(' > ');
}

function retangulo(r){
  return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
}

function idsAncestrais(el,ids,max=12){
  const saida=[];
  let atual=el.parentElement;
  while(atual&&saida.length<max){
    const id=ids.get(atual);
    if(id!==undefined)saida.push(id);
    atual=atual.parentElement;
  }
  return saida;
}

export function consolidarCausas(problemas){
  const overflowPorNo=new Map(
    problemas
      .filter(p=>p.tipo==='overflow'&&Number.isFinite(p.nodeId))
      .map(p=>[p.nodeId,p])
  );
  const remover=new Set();

  for(const p of problemas){
    if(p.tipo!=='largura-fixa'||!Number.isFinite(p.nodeId))continue;
    const overflow=overflowPorNo.get(p.nodeId);
    if(!overflow)continue;
    overflow.dados={...overflow.dados,widthPx:p.dados?.widthPx||overflow.dados?.widthPx};
    overflow.causaProvavel='largura-rigida';
    remover.add(p);
  }

  const raizDe=p=>{
    for(const id of p.ancestralIds||[]){
      const pai=overflowPorNo.get(id);
      if(pai)return raizDe(pai);
    }
    return p;
  };

  for(const p of problemas){
    if(!['overflow','largura-fixa'].includes(p.tipo)||!Number.isFinite(p.nodeId))continue;
    const raiz=raizDe(p);
    if(raiz===p)continue;
    remover.add(p);
    raiz.derivados=raiz.derivados||[];
    raiz.derivados.push({
      tipo:p.tipo,
      seletor:p.seletor,
      titulo:p.titulo
    });
  }

  for(const p of overflowPorNo.values()){
    if(p.derivados?.length){
      const unicos=new Map(p.derivados.map(x=>[`${x.tipo}|${x.seletor}`,x]));
      p.derivados=[...unicos.values()];
      p.afetadosDerivados=p.derivados.length;
      p.detalhe=`${p.detalhe} · ${p.afetadosDerivados} efeito(s) descendente(s) agrupado(s)`;
    }
  }

  return problemas.filter(p=>!remover.has(p));
}

function nomeAcessivel(el,doc){
  const aria=(el.getAttribute('aria-label')||'').trim();
  if(aria)return aria;
  const labelled=el.getAttribute('aria-labelledby');
  if(labelled){
    const texto=labelled.split(/\s+/).map(id=>doc.getElementById(id)?.textContent||'').join(' ').trim();
    if(texto)return texto;
  }
  if(el.id){
    try{
      const label=doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if(label?.textContent.trim())return label.textContent.trim();
    }catch{}
  }
  const pai=el.closest('label');
  if(pai?.textContent.trim())return pai.textContent.trim();
  const texto=(el.textContent||'').trim();
  if(texto)return texto;
  return (el.getAttribute('title')||el.getAttribute('alt')||el.getAttribute('placeholder')||'').trim();
}

function timingNavegacao(win){
  try{
    const nav=win.performance.getEntriesByType('navigation')[0];
    if(!nav)return null;
    return {
      dom:Math.round(nav.domContentLoadedEventEnd||0),
      carga:Math.round(nav.loadEventEnd||0),
      resposta:Math.round((nav.responseEnd||0)-(nav.requestStart||0))
    };
  }catch{return null;}
}

function resumoEstrutural(el){
  const nome=no=>{
    if(!no?.tagName)return '';
    const id=no.id?`#${no.id}`:'';
    const classes=[...no.classList].slice(0,4).map(x=>'.'+x).join('');
    const role=no.getAttribute('role');
    return `${no.tagName.toLowerCase()}${id}${classes}${role?`[role="${role}"]`:''}`;
  };

  const filhos=[...el.children].slice(0,12).map(nome).filter(Boolean);
  const pai=el.parentElement?nome(el.parentElement):'';
  return [
    `elemento: ${nome(el)}`,
    pai?`pai: ${pai}`:'',
    filhos.length?`filhos: ${filhos.join(', ')}`:'sem filhos diretos'
  ].filter(Boolean).join('\n');
}

function contextoDeOverflow(el,cs,r,win,largura){
  const ancestrais=[];
  const evidencias=[];
  let atual=el.parentElement;
  let recorteControlado=false;
  let nomeSugereMovimento=false;
  let score=0;
  const padrao=/(ticker|marquee|carousel|slider|track|swiper|crawl|loop|strip|belt|roller|scroll)/i;

  const nomeEl=((el.id||'')+' '+(typeof el.className==='string'?el.className:'')).trim();
  if(padrao.test(nomeEl)){
    nomeSugereMovimento=true;
    score+=3;
    evidencias.push('nome do componente sugere movimento contínuo');
  }

  const animacoesEl=typeof el.getAnimations==='function'?el.getAnimations().length:0;
  if(animacoesEl>0){
    score+=3;
    evidencias.push('elemento possui animação ativa');
  }
  if(cs.animationName&&cs.animationName!=='none'){
    score+=2;
    evidencias.push('animation-name ativo: '+cs.animationName);
  }
  if(cs.transform&&cs.transform!=='none'){
    score+=2;
    evidencias.push('transform altera a posição do elemento');
  }
  if(cs.whiteSpace==='nowrap'){
    score+=1;
    evidencias.push('conteúdo usa white-space: nowrap');
  }

  for(let i=0;atual&&i<5;i++,atual=atual.parentElement){
    const acs=win.getComputedStyle(atual);
    const nome=((atual.id||'')+' '+(typeof atual.className==='string'?atual.className:'')).trim();
    const info={
      seletor:seletor(atual),
      display:acs.display,
      overflowX:acs.overflowX,
      transform:acs.transform,
      animationName:acs.animationName,
      whiteSpace:acs.whiteSpace
    };
    ancestrais.push(info);

    if(['hidden','clip'].includes(acs.overflowX)){
      recorteControlado=true;
      score+=2;
      evidencias.push('ancestral recorta overflow horizontal');
    }
    if(acs.animationName&&acs.animationName!=='none'){
      score+=1;
      evidencias.push('ancestral possui animação');
    }
    if(acs.transform&&acs.transform!=='none'){
      score+=1;
      evidencias.push('ancestral possui transform');
    }
    if(padrao.test(nome)){
      nomeSugereMovimento=true;
      score+=2;
      evidencias.push('ancestral sugere ticker/carrossel/track');
    }
  }

  const irmaos=el.parentElement?el.parentElement.children.length:0;
  if(irmaos>=4){
    score+=1;
    evidencias.push('sequência com '+irmaos+' elementos irmãos');
  }

  if(r.width<largura*.3&&(r.right>largura+1||r.left<-1)){
    score+=2;
    evidencias.push('elemento pequeno está fora da viewport por posição, não por tamanho');
  }

  const html=resumoEstrutural(el);
  const css=[
    'display:'+cs.display,
    'position:'+cs.position,
    'width:'+cs.width,
    'max-width:'+cs.maxWidth,
    'overflow-x:'+cs.overflowX,
    'white-space:'+cs.whiteSpace,
    'transform:'+cs.transform,
    'animation-name:'+cs.animationName
  ].join(';');

  return {
    score,
    requerIA:score>=3,
    contextoIA:{
      elemento:{
        largura:r.width,
        altura:r.height,
        left:r.left,
        right:r.right,
        transform:cs.transform,
        animationName:cs.animationName,
        whiteSpace:cs.whiteSpace,
        display:cs.display,
        position:cs.position,
        overflowX:cs.overflowX
      },
      contexto:{
        html,
        css,
        ancestrais,
        irmaos,
        animacoes:animacoesEl,
        nomeSugereMovimento,
        recorteControlado
      },
      evidencias:[...new Set(evidencias)].slice(0,12)
    }
  };
}

export class AuroraAnalise{
  constructor(iframe){this.iframe=iframe;this.ultimo=null;}

  documento(){
    try{return this.iframe.contentDocument;}catch{return null;}
  }

  analisarAtual({marcar=true}={}){
    const doc=this.documento();
    if(!doc?.documentElement)throw new Error('O conteúdo não está acessível para análise.');
    const win=this.iframe.contentWindow;
    const largura=win.innerWidth||this.iframe.clientWidth;
    const altura=win.innerHeight||this.iframe.clientHeight;
    const problemas=[];
    const elementos=[...doc.querySelectorAll('body *')];
    const ids=new WeakMap();
    ids.set(doc.body,0);
    elementos.forEach((el,i)=>ids.set(el,i+1));

    let visiveis=0;
    let ocultos=0;
    let imagens=0;
    let animacoes=0;
    let efeitosPesados=0;
    let fixos=0;
    const headings=[];

    for(const el of elementos){
      const cs=win.getComputedStyle(el);
      const r=el.getBoundingClientRect();

      if(/^H[1-6]$/.test(el.tagName)&&visivel(el,cs,r))headings.push(Number(el.tagName[1]));

      if(!visivel(el,cs,r)){
        if(cs.display==='none'||cs.visibility==='hidden')ocultos++;
        continue;
      }

      visiveis++;
      const sel=seletor(el);
      const texto=(el.childNodes.length===1&&el.firstChild?.nodeType===3?el.textContent:'').trim();
      const foraX=r.right>largura+1||r.left<-1;

      if(cs.position==='fixed'||cs.position==='sticky')fixos++;
      if(cs.animationName&&cs.animationName!=='none')animacoes++;
      if((cs.filter&&cs.filter!=='none')||(cs.backdropFilter&&cs.backdropFilter!=='none')||(cs.boxShadow&&cs.boxShadow!=='none'))efeitosPesados++;

      if(foraX&&cs.position!=='fixed'&&cs.position!=='sticky'){
        const pai=el.parentElement;
        const pcs=pai?win.getComputedStyle(pai):null;
        const ambiguidade=contextoDeOverflow(el,cs,r,win,largura);
        const widthPx=parseFloat(cs.width);
        const espacoPai=pai?pai.clientWidth:largura;
        const larguraRigida=Number.isFinite(widthPx)&&widthPx>espacoPai+1;
        problemas.push({
          tipo:'overflow',
          grupo:'responsividade',
          titulo:ambiguidade.requerIA?'Overflow possivelmente intencional':'Elemento fora da viewport',
          detalhe:`${Math.ceil(Math.max(0,r.right-largura,-r.left))} px além do limite`,
          seletor:sel,
          severidade:ambiguidade.requerIA?'aviso':'critico',
          severidadeOriginal:'critico',
          requerIA:ambiguidade.requerIA,
          ignorarCorrecao:ambiguidade.requerIA,
          contextoIA:ambiguidade.contextoIA,
          nodeId:ids.get(el),
          ancestralIds:idsAncestrais(el,ids),
          causaProvavel:larguraRigida?'largura-rigida':'posicao-ou-estrutura',
          rect:retangulo(r),
          dados:{
            largura:r.width,
            viewport:largura,
            widthPx:Number.isFinite(widthPx)?widthPx:null,
            parentClientWidth:espacoPai
          },
          contexto:{
            parentSelector:pai?seletor(pai):'',
            parentDisplay:pcs?.display||'',
            fontSize:parseFloat(cs.fontSize)||0,
            paddingInline:(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0)
          }
        });
      }

      const ox=['hidden','clip'].includes(cs.overflowX);
      const oy=['hidden','clip'].includes(cs.overflowY);
      if(texto.length>3&&((ox&&el.scrollWidth>el.clientWidth+2)||(oy&&el.scrollHeight>el.clientHeight+2))){
        problemas.push({
          tipo:'texto',
          grupo:'responsividade',
          titulo:'Texto pode estar cortado',
          detalhe:sel,
          seletor:sel,
          severidade:'critico',
          rect:retangulo(r),
          dados:{scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}
        });
      }

      if(el instanceof win.HTMLImageElement){
        imagens++;
        if(!el.hasAttribute('alt')){
          problemas.push({
            tipo:'alt',
            grupo:'acessibilidade',
            titulo:'Imagem sem texto alternativo',
            detalhe:sel,
            seletor:sel,
            severidade:'aviso',
            rect:retangulo(r),
            dados:{}
          });
        }

        if(el.naturalWidth&&el.naturalHeight&&r.width>0&&r.height>0){
          const natural=el.naturalWidth/el.naturalHeight;
          const atual=r.width/r.height;
          if(Math.abs(natural-atual)/natural>.18&&cs.objectFit==='fill'){
            problemas.push({
              tipo:'imagem',
              grupo:'responsividade',
              titulo:'Imagem deformada',
              detalhe:sel,
              seletor:sel,
              severidade:'aviso',
              rect:retangulo(r),
              dados:{natural,atual}
            });
          }

          const fatorPixels=(el.naturalWidth*el.naturalHeight)/Math.max(1,r.width*r.height);
          if(fatorPixels>4&&el.naturalWidth>1000&&r.width>80){
            problemas.push({
              tipo:'performance-imagem',
              grupo:'desempenho',
              titulo:'Imagem maior que o necessário',
              detalhe:`${el.naturalWidth}×${el.naturalHeight} para ~${Math.round(r.width)}×${Math.round(r.height)}`,
              seletor:sel,
              severidade:'aviso',
              rect:retangulo(r),
              dados:{fatorPixels,naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight}
            });
          }
        }
      }

      const clicavel=el.matches('button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[tabindex]');
      if(clicavel&&(r.width<40||r.height<40)&&r.width>5&&r.height>5){
        problemas.push({
          tipo:'toque',
          grupo:'acessibilidade',
          titulo:'Área de toque pequena',
          detalhe:`${Math.round(r.width)} × ${Math.round(r.height)} px`,
          seletor:sel,
          severidade:'aviso',
          rect:retangulo(r),
          dados:{largura:r.width,altura:r.height}
        });
      }

      if(clicavel&&!nomeAcessivel(el,doc)){
        problemas.push({
          tipo:'rotulo',
          grupo:'acessibilidade',
          titulo:'Controle sem nome acessível',
          detalhe:sel,
          seletor:sel,
          severidade:'aviso',
          rect:retangulo(r),
          dados:{}
        });
      }

      const widthPx=parseFloat(cs.width);
      const espacoDisponivel=el.parentElement?el.parentElement.clientWidth:largura;
      if(foraX&&Number.isFinite(widthPx)&&widthPx>espacoDisponivel+1&&!['auto','none'].includes(cs.maxWidth)){
        problemas.push({
          tipo:'largura-fixa',
          grupo:'responsividade',
          titulo:'Largura rígida demais',
          detalhe:`${Math.round(widthPx)} px em espaço disponível de ${Math.round(espacoDisponivel)} px`,
          seletor:sel,
          severidade:'aviso',
          nodeId:ids.get(el),
          ancestralIds:idsAncestrais(el,ids),
          rect:retangulo(r),
          dados:{widthPx,viewport:largura,parentClientWidth:espacoDisponivel}
        });
      }
    }

    const globalOverflow=doc.documentElement.scrollWidth>largura+2;
    if(globalOverflow){
      problemas.unshift({
        tipo:'overflow-global',
        grupo:'responsividade',
        titulo:'Overflow horizontal',
        detalhe:`documento ${doc.documentElement.scrollWidth}px / viewport ${largura}px`,
        seletor:'html',
        severidade:'info',
        resumo:true,
        ignorarCorrecao:true,
        rect:null,
        dados:{scrollWidth:doc.documentElement.scrollWidth,viewport:largura}
      });
    }

    for(let i=1;i<headings.length;i++){
      if(headings[i]-headings[i-1]>1){
        problemas.push({
          tipo:'hierarquia',
          grupo:'acessibilidade',
          titulo:'Hierarquia de títulos salta um nível',
          detalhe:`H${headings[i-1]} → H${headings[i]}`,
          seletor:'body',
          severidade:'aviso',
          rect:null,
          dados:{}
        });
        break;
      }
    }

    if(visiveis>1500){
      problemas.push({
        tipo:'performance-dom',
        grupo:'desempenho',
        titulo:'DOM muito grande',
        detalhe:`${visiveis} elementos visíveis`,
        seletor:'body',
        severidade:'aviso',
        rect:null,
        dados:{elementos:visiveis}
      });
    }

    if(animacoes>30){
      problemas.push({
        tipo:'performance-animacoes',
        grupo:'desempenho',
        titulo:'Muitas animações simultâneas',
        detalhe:`${animacoes} elementos animados`,
        seletor:'body',
        severidade:'aviso',
        rect:null,
        dados:{animacoes}
      });
    }

    if(efeitosPesados>80){
      problemas.push({
        tipo:'performance-efeitos',
        grupo:'desempenho',
        titulo:'Muitos efeitos de composição',
        detalhe:`${efeitosPesados} elementos com filtro, sombra ou blur`,
        seletor:'body',
        severidade:'aviso',
        rect:null,
        dados:{efeitosPesados}
      });
    }

    const consolidados=consolidarCausas(problemas);
    const unicos=[];
    const vistos=new Set();
    for(const p of consolidados){
      const k=`${p.tipo}|${p.seletor}`;
      if(vistos.has(k))continue;
      vistos.add(k);
      unicos.push(p);
      if(unicos.length>=120)break;
    }

    const criticos=unicos.filter(p=>p.severidade==='critico'&&!p.ignorarCorrecao).length;
    const avisos=unicos.filter(p=>p.severidade==='aviso').length;
    const infos=unicos.filter(p=>p.severidade==='info').length;
    const temCausaOverflow=unicos.some(p=>p.tipo==='overflow'&&!p.ignorarCorrecao);
    const penalidade=Math.min(100,criticos*14+avisos*3+(globalOverflow&&!temCausaOverflow?8:0));
    const metricas={
      imagens,
      animacoes,
      efeitosPesados,
      fixos,
      recursos:win.performance?.getEntriesByType?.('resource')?.length||0,
      navegacao:timingNavegacao(win)
    };

    const resultado={
      largura,
      altura,
      elementos:visiveis,
      ocultos,
      problemas:unicos,
      criticos,
      avisos,
      infos,
      integridade:Math.max(0,100-penalidade),
      scrollWidth:doc.documentElement.scrollWidth,
      metricas,
      quando:new Date().toISOString()
    };

    this.ultimo=resultado;
    return resultado;
  }

  async varrer({definirViewport,larguraAtual,alturaAtual,progresso,largurasExtras=[]}){
    const padrao=[280,320,360,375,390,412,430,480,540,600,640,720,768,820,900,960,1024,1120,1200,1280,1366,1440,1600,1920,2560,3440];
    const bases=[...new Set([...padrao,...largurasExtras])]
      .map(Number)
      .filter(x=>Number.isFinite(x)&&x>=280&&x<=3440)
      .sort((a,b)=>a-b);
    const estados=[];
    const problemasEncontrados=new Map();

    for(let i=0;i<bases.length;i++){
      const w=bases[i];
      await definirViewport(w,alturaAtual,true);
      await espera(54);
      const r=this.analisarAtual({marcar:false});
      const responsive=r.problemas.filter(p=>p.grupo==='responsividade'&&!p.requerIA&&!p.resumo&&!p.derivado);
      for(const p of responsive){
        const chave=`${p.tipo}|${p.seletor}`;
        const existente=problemasEncontrados.get(chave);
        const larguraExtra=Math.max(0,(p.rect?.right||0)-w,-(p.rect?.x||0));
        if(!existente){
          problemasEncontrados.set(chave,{...p,larguras:[w],larguraOcorrencia:w,maiorExcesso:larguraExtra});
        }else{
          existente.larguras.push(w);
          if(larguraExtra>Number(existente.maiorExcesso||0)){
            const larguras=existente.larguras;
            problemasEncontrados.set(chave,{...p,larguras,larguraOcorrencia:w,maiorExcesso:larguraExtra});
          }
        }
      }
      estados.push({
        largura:w,
        problemas:r.problemas.length,
        responsivos:responsive.length,
        criticos:responsive.filter(p=>p.severidade==='critico').length,
        integridade:r.integridade,
        chavesResponsivas:responsive.map(p=>`${p.tipo}|${p.seletor}`)
      });
      progresso?.((i+1)/bases.length,w);
    }

    const candidatas=[];
    for(let i=1;i<estados.length;i++){
      if(estados[i-1].responsivos!==estados[i].responsivos)candidatas.push([estados[i-1],estados[i]]);
    }

    const fraturas=[];
    for(const [a,b] of candidatas.slice(0,12)){
      let lo=Math.min(a.largura,b.largura);
      let hi=Math.max(a.largura,b.largura);
      const base=a.responsivos;
      while(hi-lo>2){
        const mid=Math.round((lo+hi)/2);
        await definirViewport(mid,alturaAtual,true);
        await espera(36);
        const qtd=this.analisarAtual({marcar:false}).problemas.filter(p=>p.grupo==='responsividade'&&!p.requerIA&&!p.resumo&&!p.derivado).length;
        if(qtd===base)lo=mid;
        else hi=mid;
      }
      fraturas.push({largura:hi,antes:base,depois:b.responsivos});
    }

    await definirViewport(larguraAtual,alturaAtual,true);
    await espera(60);
    const atual=this.analisarAtual({marcar:false});
    const problemasResponsivos=[...problemasEncontrados.entries()].map(([chave,p])=>{
      const larguras=[...new Set(p.larguras)].sort((a,b)=>a-b);
      const ultimaLargura=Math.max(...larguras);
      const proximaSegura=estados.find(x=>x.largura>ultimaLargura&&!x.chavesResponsivas.includes(chave))?.largura||null;
      const limiteNatural=fraturas
        .map(x=>x.largura)
        .filter(x=>x>=ultimaLargura&&(proximaSegura===null||x<=proximaSegura))
        .sort((a,b)=>a-b)[0]||null;

      return {
        ...p,
        larguras,
        primeiraLargura:Math.min(...larguras),
        ultimaLargura,
        proximaLarguraSegura:proximaSegura,
        limiteNatural
      };
    });
    return {estados,fraturas,atual,problemasResponsivos};
  }
}

function espera(ms){return new Promise(r=>setTimeout(r,ms));}
