import { calcularCeu, equatorialParaHorizontal, parseRa, parseDec } from './astronomia.js';

const CATALOGO = 'https://brettonw.github.io/YaleBrightStarCatalog/bsc5-short.json';
const rad = Math.PI / 180;

function corTemperatura(k = 6500) {
  const t = Math.max(2500, Math.min(30000, Number(k) || 6500));
  if (t < 4200) return [1, .74, .55];
  if (t < 5500) return [1, .9, .76];
  if (t < 7500) return [.91, .94, 1];
  return [.72, .82, 1];
}

function estrelasFallback(qtd = 1400) {
  let seed = 918273;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: qtd }, (_, i) => ({
    ra: rand() * 360,
    dec: Math.asin(rand() * 2 - 1) / rad,
    mag: 1.4 + Math.pow(rand(), .55) * 5.2,
    cor: corTemperatura(3000 + rand() * 12000),
    nome: i < 20 ? `estrela-${i}` : ''
  }));
}

async function carregarEstrelas() {
  try {
    const cache = sessionStorage.getItem('aurora-estrelas');
    if (cache) return JSON.parse(cache);
    const resposta = await fetch(CATALOGO, { cache: 'force-cache' });
    if (!resposta.ok) throw new Error();
    const bruto = await resposta.json();
    const estrelas = bruto
      .map(s => ({
        ra: parseRa(s.RA),
        dec: parseDec(s.Dec),
        mag: Number(s.V),
        cor: corTemperatura(Number(s.K)),
        nome: s.N || ''
      }))
      .filter(s => Number.isFinite(s.ra) && Number.isFinite(s.dec) && Number.isFinite(s.mag) && s.mag <= 6.7);
    try { sessionStorage.setItem('aurora-estrelas', JSON.stringify(estrelas)); } catch {}
    return estrelas;
  } catch {
    return estrelasFallback();
  }
}

function criarAtmosfera(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const vs = `#version 300 es
    in vec2 p; out vec2 uv;
    void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
  const fs = `#version 300 es
    precision highp float;
    in vec2 uv; out vec4 outColor;
    uniform vec2 r; uniform float t; uniform float sunAlt; uniform float clouds; uniform float windDir; uniform float windSpeed; uniform float active;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.52;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.04+17.7;a*=.5;}return v;}
    vec3 mix3(vec3 a,vec3 b,float x){return a+(b-a)*clamp(x,0.,1.);}
    void main(){
      float y=uv.y;
      float day=smoothstep(-8.,5.,sunAlt);
      float night=1.-smoothstep(-14.,-2.,sunAlt);
      float dusk=(1.-smoothstep(0.,12.,abs(sunAlt)))*smoothstep(-18.,3.,sunAlt);
      vec3 zenNight=vec3(.008,.018,.035), horNight=vec3(.025,.055,.085);
      vec3 zenDay=vec3(.12,.38,.68), horDay=vec3(.56,.72,.84);
      vec3 zen=mix3(zenNight,zenDay,day), hor=mix3(horNight,horDay,day);
      vec3 col=mix3(hor,zen,pow(y,.58));
      vec3 warm=vec3(.92,.35,.12)*pow(1.-y,3.2)*dusk*.74;
      col+=warm;
      float angle=radians(windDir);
      vec2 flow=vec2(cos(angle),sin(angle))*t*(.002+.00012*windSpeed);
      vec2 p=vec2(uv.x*r.x/r.y,uv.y)*3.2+flow;
      float n=fbm(p)+.5*fbm(p*2.2+8.);
      float threshold=mix(1.34,.60,clouds);
      float c=smoothstep(threshold,threshold+.23,n);
      c*=smoothstep(.08,.42,y)*smoothstep(1.08,.72,y);
      vec3 cloudDay=vec3(.78,.84,.9), cloudNight=vec3(.09,.13,.19);
      vec3 cloud=mix3(cloudNight,cloudDay,day);
      col=mix3(col,cloud,c*(.46+.3*clouds));
      float haze=pow(1.-y,5.)*(.08+.14*clouds);
      col+=vec3(.13,.18,.24)*haze;
      col*=mix(.38,1.,active);
      outColor=vec4(col,1.);
    }`;
  const compilar = (tipo, fonte) => {
    const s = gl.createShader(tipo); gl.shaderSource(s, fonte); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  try {
    const programa = gl.createProgram();
    gl.attachShader(programa, compilar(gl.VERTEX_SHADER, vs));
    gl.attachShader(programa, compilar(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(programa);
    if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(programa));
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(programa, 'p');
    gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
    const u = nome => gl.getUniformLocation(programa, nome);
    return {
      render(tempo, ceu, clima, ativo) {
        gl.viewport(0,0,canvas.width,canvas.height); gl.useProgram(programa);
        gl.uniform2f(u('r'), canvas.width, canvas.height);
        gl.uniform1f(u('t'), tempo);
        gl.uniform1f(u('sunAlt'), ceu.sol.altitude);
        gl.uniform1f(u('clouds'), Math.max(0, Math.min(1, (clima.nuvens || 0)/100)));
        gl.uniform1f(u('windDir'), clima.direcao || 90);
        gl.uniform1f(u('windSpeed'), clima.vento || 5);
        gl.uniform1f(u('active'), ativo ? 1 : .7);
        gl.drawArrays(gl.TRIANGLES,0,6);
      }
    };
  } catch { return null; }
}

function desenharLua(ctx, x, y, raio, lua, alpha = 1) {
  if (lua.altitude <= -3 || raio < 5) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(215,230,245,.28)';
  ctx.shadowBlur = raio * .75;
  const grad = ctx.createRadialGradient(x-raio*.28,y-raio*.32,raio*.08,x,y,raio);
  grad.addColorStop(0,'#f1efe8'); grad.addColorStop(.62,'#c9c8c2'); grad.addColorStop(1,'#8d9297');
  ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(x,y,raio,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  ctx.save(); ctx.beginPath(); ctx.arc(x,y,raio,0,Math.PI*2); ctx.clip();
  const fase=((lua.fase%360)+360)%360;
  const crescente=fase<180;
  const deslocamento=Math.cos(fase*rad)*raio;
  ctx.fillStyle='rgba(3,7,13,.92)';
  ctx.beginPath();
  ctx.ellipse(x + (crescente ? -deslocamento : deslocamento), y, Math.abs(deslocamento), raio*1.02, 0, 0, Math.PI*2);
  if (lua.iluminacao < .985) ctx.fill();
  for(let i=0;i<16;i++){
    const a=(i*2.399), rr=raio*(.15+((i*37)%70)/100*.7);
    const cx=x+Math.cos(a)*rr*.72, cy=y+Math.sin(a)*rr*.72;
    const cr=raio*(.015+((i*17)%10)/500);
    ctx.fillStyle=`rgba(70,72,72,${.05+(i%4)*.018})`; ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.fill();
  }
  ctx.restore(); ctx.restore();
}

function projetar(azimute, altitude, w, h, centroAz=180, fov=190) {
  let delta=((azimute-centroAz+540)%360)-180;
  if (Math.abs(delta)>fov/2 || altitude<-4) return null;
  const x=w/2 + delta/(fov/2)*(w/2);
  const y=h*(.88 - Math.max(-4,altitude)/105);
  return {x,y};
}

export async function iniciarCeu({ obterLocal, obterClima, aoAtualizar }) {
  const canvasA=document.querySelector('#ceu-atmosfera');
  const canvasS=document.querySelector('#ceu-astros');
  const miniLua=document.querySelector('#mini-lua');
  const ctx=canvasS.getContext('2d');
  const mini=miniLua.getContext('2d');
  const atmosfera=criarAtmosfera(canvasA);
  const estrelas=await carregarEstrelas();
  let velocidade=1, baseReal=Date.now(), baseVirtual=Date.now(), ativo=true, ultimo=performance.now();
  let meteoro=null, proximoMeteoro=performance.now()+45000+Math.random()*90000;

  const tamanho=()=>{
    const dpr=Math.min(devicePixelRatio||1, matchMedia('(max-width:700px)').matches?1.35:1.7);
    for(const c of [canvasA,canvasS]){
      const w=Math.max(1,Math.floor(innerWidth*dpr)), h=Math.max(1,Math.floor(innerHeight*dpr));
      if(c.width!==w||c.height!==h){c.width=w;c.height=h;c.style.width='100%';c.style.height='100%';}
    }
  };
  tamanho(); addEventListener('resize',tamanho,{passive:true});

  const dataVirtual=()=>new Date(baseVirtual+(Date.now()-baseReal)*velocidade);
  const definirVelocidade=v=>{const agora=dataVirtual().getTime();baseVirtual=agora;baseReal=Date.now();velocidade=Number(v)||1;};
  const alternar=()=>ativo=!ativo;

  function desenharMeteoro(now,w,h,alpha){
    if(!meteoro && now>proximoMeteoro && alpha>.45 && !matchMedia('(prefers-reduced-motion: reduce)').matches){
      meteoro={inicio:now,x:w*(.18+Math.random()*.64),y:h*(.07+Math.random()*.18),vx:w*.00017,vy:h*.0002};
      proximoMeteoro=now+50000+Math.random()*120000;
    }
    if(!meteoro)return;
    const dt=now-meteoro.inicio;
    if(dt>1200){meteoro=null;return;}
    const p=dt/1200,x=meteoro.x+meteoro.vx*dt,y=meteoro.y+meteoro.vy*dt;
    ctx.save();ctx.globalAlpha=Math.sin(Math.PI*p)*.7*alpha;
    const g=ctx.createLinearGradient(x-95,y-70,x,y);g.addColorStop(0,'rgba(210,226,245,0)');g.addColorStop(1,'rgba(235,244,255,.9)');
    ctx.strokeStyle=g;ctx.lineWidth=Math.max(1,canvasS.width/1900);ctx.beginPath();ctx.moveTo(x-95,y-70);ctx.lineTo(x,y);ctx.stroke();ctx.restore();
  }

  function quadro(now){
    const dt=Math.min(80,now-ultimo);ultimo=now;
    const local=obterLocal(); const clima=obterClima(); const data=dataVirtual(); const ceu=calcularCeu(data,local);
    atmosfera?.render(now/1000,ceu,clima,ativo);
    ctx.clearRect(0,0,canvasS.width,canvasS.height);
    const w=canvasS.width,h=canvasS.height;
    const visEstrelas=Math.max(0,Math.min(1,(-ceu.sol.altitude-3)/12))*(ativo?1:.65);
    if(visEstrelas>.02){
      ctx.save();
      for(const s of estrelas){
        const hz=equatorialParaHorizontal(s.ra,s.dec,data,local.latitude,local.longitude);
        const p=projetar(hz.azimute,hz.altitude,w,h);
        if(!p)continue;
        const brilho=Math.max(.06,Math.min(1,(6.8-s.mag)/6.8));
        const tamanho=Math.max(.55,Math.pow(brilho,1.8)*2.4)*(w/1600);
        ctx.globalAlpha=visEstrelas*(.34+brilho*.66);
        const [r,g,b]=s.cor;ctx.fillStyle=`rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
        ctx.beginPath();ctx.arc(p.x,p.y,tamanho,0,Math.PI*2);ctx.fill();
        if(brilho>.72){ctx.globalAlpha*=.16;ctx.beginPath();ctx.arc(p.x,p.y,tamanho*4.4,0,Math.PI*2);ctx.fill();}
      }
      ctx.restore();
    }
    const pLua=projetar(ceu.lua.azimute,ceu.lua.altitude,w,h);
    if(pLua) desenharLua(ctx,pLua.x,pLua.y,Math.max(16,w*.022),ceu.lua,Math.max(.25,visEstrelas+.25));
    desenharMeteoro(now,w,h,visEstrelas);
    mini.clearRect(0,0,miniLua.width,miniLua.height);desenharLua(mini,21,21,16,{...ceu.lua,altitude:30},1);
    aoAtualizar?.({data,ceu,clima,velocidade,dt});
    requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);
  return { definirVelocidade, alternar, dataVirtual };
}
