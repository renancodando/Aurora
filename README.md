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
- correções sem IA com propriedades intrínsecas, medidas fluidas, media queries no limite natural e container queries quando a estrutura permite
- preservação da ordem do DOM e do conteúdo
- rollback quando um ajuste cria mais problemas no estado atual
- validação da linha responsiva completa antes de exportar
- `aurora-responsive.css` separado do CSS original
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
→ tentar a menor correção
→ usar o limite natural do próprio layout
→ usar container query quando o componente precisa reagir ao espaço dele
→ reorganizar só quando não dá para manter a composição
→ retestar
→ rejeitar se piorar
→ validar a linha responsiva inteira
→ exportar uma cópia
```

O AURORA não remove conteúdo para fazer a interface caber.

## Open-Meteo

Durante o desenvolvimento o endpoint público funciona sem chave. O clima é atualizado a cada 15 minutos. Sol, Lua, fase lunar e movimento das estrelas continuam com cálculo local quando a meteorologia estiver indisponível.

## Importante

Use o laboratório com projetos que você pode executar e analisar. O conteúdo importado roda localmente dentro do preview para que o AURORA consiga medir o DOM.
