const IGNORAR = new Set(['HTML','HEAD','META','LINK','SCRIPT','STYLE','TITLE','BASE','NOSCRIPT','SOURCE','BR']);

function visivel(el, cs, r) {
  return !IGNORAR.has(el.tagName) && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > .01 && r.width > .5 && r.height > .5;
}

function seletor(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el.id) return `#${CSS.escape(el.id)}`;
  const partes=[];
  let atual=el;
  while(atual && atual.tagName && atual.tagName !== 'HTML' && partes.length<5){
    let p=atual.tagName.toLowerCase();
    const classes=[...atual.classList].filter(c=>!/^aurora-/.test(c)).slice(0,2);
    if(classes.length) p += '.'+classes.map(CSS.escape).join('.');
    else if(atual.parentElement){
      const iguais=[...atual.parentElement.children].filter(x=>x.tagName===atual.tagName);
      if(iguais.length>1) p += `:nth-of-type(${iguais.indexOf(atual)+1})`;
    }
    partes.unshift(p); atual=atual.parentElement;
  }
  return partes.join(' > ');
}

function retangulo(r){return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};}

export class AuroraAnalise {
  constructor(iframe){ this.iframe=iframe; this.ultimo=null; }

  documento(){
    try { return this.iframe.contentDocument; } catch { return null; }
  }

  analisarAtual({marcar=true}={}){
    const doc=this.documento();
    if(!doc?.documentElement) throw new Error('O conteúdo não está acessível para análise.');
    const win=this.iframe.contentWindow;
    const largura=win.innerWidth || this.iframe.clientWidth;
    const altura=win.innerHeight || this.iframe.clientHeight;
    const problemas=[];
    const elementos=[...doc.querySelectorAll('body *')];
    let visiveis=0, ocultos=0;

    for(const el of elementos){
      const cs=win.getComputedStyle(el); const r=el.getBoundingClientRect();
      if(!visivel(el,cs,r)){ if(cs.display==='none' || cs.visibility==='hidden') ocultos++; continue; }
      visiveis++;
      const sel=seletor(el);
      const texto=(el.childNodes.length===1 && el.firstChild?.nodeType===3 ? el.textContent : '').trim();
      const foraX=r.right>largura+1 || r.left<-1;
      if(foraX && cs.position!=='fixed' && cs.position!=='sticky'){
        const pai=el.parentElement;
        const pcs=pai?win.getComputedStyle(pai):null;
        problemas.push({tipo:'overflow',titulo:'Elemento fora da viewport',detalhe:`${Math.ceil(Math.max(0,r.right-largura, -r.left))} px além do limite`,seletor:sel,severidade:'critico',rect:retangulo(r),dados:{largura:r.width,viewport:largura},contexto:{parentSelector:pai?seletor(pai):'',parentDisplay:pcs?.display||'',fontSize:parseFloat(cs.fontSize)||0,paddingInline:(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0)}});
      }

      const ox=['hidden','clip'].includes(cs.overflowX); const oy=['hidden','clip'].includes(cs.overflowY);
      if(texto.length>3 && ((ox && el.scrollWidth>el.clientWidth+2)||(oy && el.scrollHeight>el.clientHeight+2))){
        problemas.push({tipo:'texto',titulo:'Texto pode estar cortado',detalhe:sel,seletor:sel,severidade:'critico',rect:retangulo(r),dados:{scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}});
      }

      if(el instanceof win.HTMLImageElement && el.naturalWidth && el.naturalHeight){
        const natural=el.naturalWidth/el.naturalHeight, atual=r.width/r.height;
        if(Math.abs(natural-atual)/natural>.18 && cs.objectFit==='fill'){
          problemas.push({tipo:'imagem',titulo:'Imagem deformada',detalhe:sel,seletor:sel,severidade:'aviso',rect:retangulo(r),dados:{natural,atual}});
        }
      }

      const clicavel=el.matches('button,a,input,select,textarea,[role="button"],[tabindex]');
      if(clicavel && (r.width<40 || r.height<40) && r.width>5 && r.height>5){
        problemas.push({tipo:'toque',titulo:'Área de toque pequena',detalhe:`${Math.round(r.width)} × ${Math.round(r.height)} px`,seletor:sel,severidade:'aviso',rect:retangulo(r),dados:{largura:r.width,altura:r.height}});
      }

      const widthPx=parseFloat(cs.width);
      if(foraX && Number.isFinite(widthPx) && widthPx>largura && !['auto','none'].includes(cs.maxWidth)){
        problemas.push({tipo:'largura-fixa',titulo:'Largura rígida demais',detalhe:`${Math.round(widthPx)} px em viewport de ${largura} px`,seletor:sel,severidade:'aviso',rect:retangulo(r),dados:{widthPx}});
      }
    }

    const globalOverflow=doc.documentElement.scrollWidth>largura+2;
    if(globalOverflow){
      problemas.unshift({tipo:'overflow-global',titulo:'Overflow horizontal',detalhe:`documento ${doc.documentElement.scrollWidth}px / viewport ${largura}px`,seletor:'html',severidade:'critico',rect:null,dados:{scrollWidth:doc.documentElement.scrollWidth,viewport:largura}});
    }

    const unicos=[]; const vistos=new Set();
    for(const p of problemas){
      const k=`${p.tipo}|${p.seletor}`; if(vistos.has(k)) continue; vistos.add(k); unicos.push(p); if(unicos.length>=80)break;
    }

    const criticos=unicos.filter(p=>p.severidade==='critico').length;
    const avisos=unicos.length-criticos;
    const penalidade=Math.min(100,criticos*14+avisos*4+(globalOverflow?12:0));
    const resultado={largura,altura,elementos:visiveis,ocultos,problemas:unicos,criticos,avisos,integridade:Math.max(0,100-penalidade),scrollWidth:doc.documentElement.scrollWidth,quando:new Date().toISOString()};
    this.ultimo=resultado;
    return resultado;
  }

  async varrer({definirViewport,larguraAtual,alturaAtual,progresso}){
    const bases=[280,320,360,375,390,412,430,480,540,600,640,720,768,820,960,1024,1200,1280,1366,1440,1600,1920,2560,3440];
    const estados=[];
    for(let i=0;i<bases.length;i++){
      const w=bases[i]; await definirViewport(w,alturaAtual,true); await espera(54);
      const r=this.analisarAtual({marcar:false});
      estados.push({largura:w,problemas:r.problemas.length,criticos:r.criticos,integridade:r.integridade});
      progresso?.((i+1)/bases.length,w);
    }

    const candidatas=[];
    for(let i=1;i<estados.length;i++) if(estados[i-1].problemas!==estados[i].problemas) candidatas.push([estados[i-1],estados[i]]);
    const fraturas=[];
    for(const [a,b] of candidatas.slice(0,10)){
      let lo=Math.min(a.largura,b.largura), hi=Math.max(a.largura,b.largura), base=a.problemas;
      while(hi-lo>2){
        const mid=Math.round((lo+hi)/2); await definirViewport(mid,alturaAtual,true); await espera(36);
        const qtd=this.analisarAtual({marcar:false}).problemas.length;
        if(qtd===base) lo=mid; else hi=mid;
      }
      fraturas.push({largura:hi,antes:base,depois:b.problemas});
    }

    await definirViewport(larguraAtual,alturaAtual,true); await espera(60);
    const atual=this.analisarAtual({marcar:false});
    return {estados,fraturas,atual};
  }
}

function espera(ms){return new Promise(r=>setTimeout(r,ms));}
