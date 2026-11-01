# Perfis gráficos adaptáveis

## Objetivo

O Office Kit deve oferecer níveis gráficos selecionáveis e um modo automático para equilibrar legibilidade, fluidez, consumo e detalhe. Os perfis são uma política pública do produto; não são uma promessa de FPS em todos os aparelhos.

## Perfis canónicos

| Perfil | Objetivo | Pixel ratio máximo | FPS-alvo | Sombras | Efeitos ambientais | Animação | Escala de textura | Limite inicial de personagens visíveis |
|---|---|---:|---:|---|---|---|---:|---:|
| Económico | telemóveis modestos, bateria e acessibilidade | 1.0 | 30 | Não | Não | Reduzida | 0,50 | 40 |
| Equilibrado | predefinição geral | 1.5 | 45 | Não | Sim | Normal | 0,75 | 100 |
| Detalhado | aparelhos capazes | 2.0 | 60 | Sim | Sim | Completa | 1,00 | 250 |
| Cinemático | ecrãs grandes e hardware forte | 2.5 | 60 | Sim | Sim | Completa | 1,25 | 500 |

Estes valores são limites-alvo para orientar o renderer, não medições nem capacidades já ligadas ao protótipo.

## Regras de seleção

- **Auto** é a predefinição: usa pistas disponíveis, como memória aproximada do dispositivo, número de núcleos, largura do ecrã, modo de poupança de dados e preferência por movimento reduzido.
- Se as pistas estiverem ausentes, escolher **Equilibrado** em vez de assumir hardware forte.
- O utilizador pode substituir a seleção automática por um perfil fixo.
- A preferência de movimento reduzido deve ser respeitada; o perfil Económico reduz efeitos, mas não pode tornar texto, estados ou controlos menos claros.
- A rotação do ecrã altera o enquadramento/layout, não deve aumentar artificialmente a qualidade gráfica.
- O renderer deve degradar-se progressivamente: reduzir efeitos e densidade primeiro, preservar enquadramento, contraste, nomes selecionáveis e informação operacional.
- A qualidade automática futura deve poder reagir a medições de frame time durante uma janela estável, com histerese para evitar alternância constante. Não alterar perfil em cada frame.

## Separação de responsabilidades

O módulo de perfis não importa APIs gráficas nem deteta um backend. O renderer aplica as opções. O adaptador de backend e o modelo de estado operacional permanecem independentes da qualidade visual. Nenhum perfil pode alterar a verdade do estado dos agentes/tarefas.

## Validação exigida antes de declarar pronto

1. Medir CPU, memória, tempo de frame e bateria em aparelhos reais.
2. Capturar a mesma cena em retrato e paisagem para cada perfil.
3. Testar densidade crescente de personagens, salas, mobiliário e efeitos.
4. Verificar ausência de deformação, sobreposição crítica, texto ilegível e saltos de câmara.
5. Testar alternância manual/automática, preferência de movimento reduzido e ausência de pistas do dispositivo.
6. Documentar aparelhos e resultados concretos; não inferir compatibilidade só a partir do browser ou do emulador.

## Estado atual

O contrato de perfis e o seletor lógico estão implementados no pacote scene-engine. A integração com um renderer real, as medições adaptativas em execução, a interface de seleção e as medições em dispositivos físicos ainda não estão implementadas.
