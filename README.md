# AURORA

Laboratório de responsividade adaptativa determinística. O AURORA procura onde uma interface quebra, mede a causa, tenta a menor correção possível, valida de novo e exporta uma nova cópia sem alterar o projeto original.

## O que já funciona

- ZIP, pasta, URL e repositório público do GitHub
- cópia `original` separada da cópia `trabalho`
- preview do projeto em uma única área de trabalho
- viewport contínua de 280px até 3440px
- resize manual pelas bordas do preview
- análise de overflow, texto cortado, imagens deformadas, área de toque e larguras rígidas
- busca automática dos limites naturais onde o comportamento muda
- correções sem IA por causa raiz, usando a menor alteração possível e media query apenas quando a ruptura exige
- preservação da ordem do DOM e do conteúdo
- rollback quando um ajuste cria mais problemas no estado atual
- validação da linha responsiva completa antes de exportar
- `aurora-correcoes.css` separado do CSS original
- relatório JSON junto da versão gerada
- exportação para um novo ZIP
- original preservado

## Céu AURORA

O fundo não é uma foto. Ele é renderizado em tempo real.

- WebGL2 para atmosfera e nuvens procedurais
- Astronomy Engine para Sol, Lua e fase lunar, com fallback local
- Open-Meteo para nuvens, vento, precipitação, visibilidade e busca de cidades
- catálogo Yale Bright Star Catalog quando disponível, com fallback procedural local
- estrelas mudam de posição pelo tempo sideral e pela latitude/longitude
- Lua só aparece quando está acima do horizonte
- transição contínua entre dia, crepúsculo e noite
- tempo real, 60× e 600×
- localização do navegador ou cidade escolhida manualmente

## Tecnologia

- .NET 10 / ASP.NET Core
- HTML, CSS e JavaScript puro
- WebGL2 + Canvas 2D
- CSS Grid e Flexbox
- `min()`, `max()`, `clamp()`, propriedades lógicas e Container Queries
- ResizeObserver e medições reais do DOM
- Open-Meteo
- Astronomy Engine

## Abrir no Visual Studio

Abra `Aurora.sln` ou execute `ABRIR_NO_VISUAL_STUDIO.cmd`.

O perfil padrão abre:

```text
http://localhost:5187
```

## Como o motor trabalha

```text
medir
→ encontrar a ruptura
→ identificar a causa raiz
→ agrupar sintomas descendentes
→ tentar a menor correção
→ usar o limite natural do próprio layout
→ não alterar estrutura sem evidência suficiente
→ retestar
→ rejeitar se não houver melhora real
→ validar a linha responsiva inteira
→ exportar uma cópia
```

O AURORA não remove conteúdo para fazer a interface caber.


## Inteligência opcional

O motor principal continua determinístico. A IA só entra quando o AURORA encontra um caso ambíguo, como ticker, marquee, carousel, slider, track animado, transformações ou overflow aparentemente intencional.

Fluxo:

```text
medição local
→ caso claro: AURORA decide sozinho
→ caso ambíguo: Gemma 4 26B A4B no Cloudflare
→ confiança abaixo de 88%: GPT-OSS 120B no Groq como segunda opinião
→ se os modelos discordarem: não corrige automaticamente
```

As chaves nunca ficam no frontend. Na Vercel, configure estas Environment Variables:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
GROQ_API_KEY
```

No Visual Studio, o mesmo endpoint funciona pelo ASP.NET Core. Configure os secrets locais sem gravar nenhuma chave no GitHub:

```powershell
dotnet user-secrets set "CLOUDFLARE_ACCOUNT_ID" "SEU_ACCOUNT_ID" --project src/Aurora/Aurora.csproj
dotnet user-secrets set "CLOUDFLARE_API_TOKEN" "SEU_TOKEN" --project src/Aurora/Aurora.csproj
dotnet user-secrets set "GROQ_API_KEY" "SUA_CHAVE" --project src/Aurora/Aurora.csproj
```

O Cloudflare é o provedor principal. O Groq é opcional, mas recomendado como segunda opinião.

Sem essas variáveis, o AURORA continua funcionando com o motor determinístico e preserva casos ambíguos em vez de corrigi-los no escuro.

No GitHub Pages a IA segura fica desativada porque não existe backend para esconder as chaves. Use a versão da Vercel para a análise inteligente.

## Produção

A versão de produção deve ser publicada na Vercel. O GitHub Pages serve como demonstração estática e não expõe as chaves da análise inteligente.

Antes do deploy:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
GROQ_API_KEY
```

O `GROQ_API_KEY` é opcional. Sem qualquer chave de IA, o motor determinístico continua funcional e casos ambíguos são preservados.

Proteções aplicadas:

- SSRF bloqueado na importação por URL, inclusive após redirecionamentos e resolução DNS
- limite de tamanho e quantidade de arquivos em ZIP/pasta
- proteção contra ZIP bomb
- limpeza periódica do workspace temporário
- limite de requisições nas rotas de importação e IA
- limite de payload e timeout nas chamadas de IA
- cache local de projetos limpo quando um novo projeto é aberto
- nenhum segredo enviado ao GitHub ou ao frontend
- a IA recebe estrutura, estilos calculados e medições; não recebe o conteúdo textual bruto do projeto
- headers HTTP de produção para reduzir framing externo, sniffing e vazamento de referência

O pipeline valida .NET 10, sintaxe JavaScript, causa raiz, correção mínima e um smoke test de importação antes de aceitar a versão.

## Open-Meteo

Durante o desenvolvimento o endpoint público funciona sem chave. O clima é atualizado a cada 15 minutos. Sol, Lua, fase lunar e movimento das estrelas continuam com cálculo local quando a meteorologia estiver indisponível.

## Importante

Use o laboratório com projetos que você confia e pode executar. O preview precisa executar o código do projeto para medir o DOM real; portanto, não trate o AURORA como sandbox para código hostil ou desconhecido.
