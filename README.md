# AURORA

Laboratório de responsividade adaptativa sem IA.

O AURORA abre uma cópia do projeto, mede a interface em várias larguras, encontra o ponto onde o layout começa a quebrar e tenta corrigir com a menor mudança possível. O original não é alterado.

## O que já funciona

- importar ZIP
- importar uma pasta pelo navegador
- importar uma URL e analisar a cópia local da página
- importar repositório público do GitHub
- preview com largura e altura livres
- régua de 280 px até 3440 px
- varredura automática e busca de limites naturais
- overflow horizontal
- texto cortado
- imagem deformada
- áreas de toque pequenas
- larguras rígidas maiores que a viewport
- marcação visual do elemento com problema
- correções reversíveis dentro do preview
- rollback se a correção criar mais problemas
- exportar um novo ZIP sem tocar no original
- relatório JSON junto do projeto corrigido
- céu em tempo real com Sol, Lua, estrelas e fase lunar
- clima real pela Open-Meteo, sem chave no modo gratuito
- localização automática ou busca manual de cidade
- tempo do céu em 1x, 60x e 600x

## Responsividade do próprio AURORA

A interface usa layout intrínseco, Grid, Flex, `clamp()`, container queries, altura, orientação, tipo de ponteiro, área segura e `ResizeObserver`. Em telas menores os painéis mudam de forma sem criar uma segunda tela.

## Abrir

Requer .NET 10.

1. Abra `Aurora.sln` no Visual Studio.
2. Pressione F5 ou Ctrl+F5.
3. O projeto abre em `http://localhost:5187`.

Também dá para dar dois cliques em `ABRIR_NO_VISUAL_STUDIO.cmd`.

## Céu

Astronomia: Astronomy Engine 2.1.19.

Clima e geocodificação: Open-Meteo.

Catálogo estelar principal: Yale Bright Star Catalog em JSON. Se ele não estiver disponível, o AURORA usa um campo estelar local de fallback e continua funcionando.

A Open-Meteo não exige chave para protótipo e uso não comercial dentro dos limites deles. Para uso comercial, a configuração pode ser trocada depois sem refazer o céu.

## Importante

URL externa é capturada para uma cópia local. Sites muito dependentes de autenticação, service workers ou APIs bloqueadas por CORS podem não funcionar exatamente como no domínio original. Para análise completa, prefira ZIP, pasta ou GitHub.
