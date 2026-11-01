# Office Kit — contrato canónico do produto

**Estado:** contrato fundacional  
**Objetivo:** tornar explícito o produto que estamos a construir e evitar deriva de âmbito.  
**Regra de precedência:** este documento define o produto; `ARCHITECTURE.md` define os limites técnicos; `ROADMAP.md` define a ordem de execução. Uma implementação não pode contradizer este contrato sem uma alteração documentada e revista.

## 1. Missão

Office Kit é um **escritório digital visual, configurável, leve e reutilizável**, que pode representar equipas, agentes e departamentos de diferentes projetos. É uma camada de apresentação e simulação social, não é o cérebro operacional do projeto.

O VST (VazaoSovereignTrader) é o primeiro caso de referência e integração, não o molde rígido nem uma dependência obrigatória. O Office Kit tem de poder servir projetos de trading, investigação, desenvolvimento, DevOps, operações, suporte e outros domínios sem reescrever o núcleo.

## 2. Princípios não negociáveis

1. **Backend independente:** nenhum backend pode depender do Office Kit para iniciar, executar, recuperar, aprender, tomar decisões ou terminar tarefas.
2. **Visualização não autoritativa:** o ecrã nunca inventa nem confirma trabalho real. Só eventos/estados recebidos de um adaptador de backend podem apresentar trabalho como real.
3. **Falha isolada:** erro, bloqueio, encerramento ou atualização do renderer/editor não pode bloquear o backend nem corromper tarefas.
4. **Configuração antes de código:** nomes, número e disposição de pisos/departamentos/salas, agentes, avatares, mobiliário, temas e regras visuais devem ser alteráveis por interface e/ou configuração declarativa.
5. **Intuitivo por omissão:** a experiência normal deve ser simples. Opções avançadas existem, mas não devem sobrecarregar o ecrã principal.
6. **Progressive disclosure:** mostrar primeiro o essencial; revelar propriedades avançadas quando o utilizador seleciona um edifício, departamento, sala ou agente.
7. **Leve e adaptável:** a visualização ajusta detalhe, resolução e animação ao dispositivo; deve funcionar em telemóveis, tablets e computadores.
8. **Sem backend, o escritório continua vivo:** quando não há ligação válida, o elenco mantém animação social local, claramente distinguida de atividade operacional real.
9. **Estados honestos:** indisponível, desconectado, desatualizado e desconhecido são estados diferentes. Ausência de dados nunca significa sucesso.
10. **Extensível por contratos:** novos projetos ligam-se através de adaptadores estáveis, não por dependências específicas dentro do renderer.
11. **Privacidade e controlo:** credenciais, dados sensíveis, comandos de backend e conteúdo privado não são guardados nem expostos pelo Office Kit por conveniência visual.
12. **Verificação visual:** mudanças de layout/animação devem ser verificadas por capturas automatizadas em dimensões e orientações relevantes, sempre que a infraestrutura o permita.

## 3. O que o utilizador constrói

O utilizador deve conseguir montar um escritório como se estivesse a compor peças:

- criar/remover/renomear pisos, departamentos e salas;
- escolher a organização visual (edifício de vários pisos, planta, diorama, sala única ou outras vistas suportadas);
- escolher estilo visual e qualidade, sem alterar a lógica do backend;
- criar, mover, renomear e remover agentes;
- escolher avatar humano estilizado, robô ou outras famílias suportadas;
- atribuir função, departamento, estação de trabalho e regras de visualização a cada agente;
- colocar, mover, redimensionar e remover mesas, cadeiras, ecrãs, máquinas, plantas, portas, janelas, varandas, cafetaria e outros elementos;
- guardar, duplicar, importar e exportar configurações;
- reutilizar uma configuração como modelo para outro projeto;
- configurar nomes, ícones, cores, limites e metadados sem alterar código;
- esconder detalhes visuais quando não são úteis e abrir um painel simples para inspecionar qualquer elemento.

A configuração deve ter validação e valores predefinidos sensatos. Uma configuração inválida deve gerar um erro legível e recuperável, não uma tela vazia.

## 4. Modos de visualização

Os modos são representações alternativas dos mesmos dados; não são produtos separados nem fontes independentes de verdade.

- **Chat/painel:** vista funcional mínima, para dispositivos fracos ou quem prefere simplicidade.
- **2D leve:** planta/diagrama com agentes e estados.
- **Pixel diorama:** cenário em miniatura, com câmara controlada, paleta e figuras animadas; inspirado na gramática visual do projeto Diorama.
- **2.5D/isométrico:** edifício/salas com profundidade aparente e pisos visíveis.
- **3D:** cena espacial com câmara e níveis de detalhe adequados ao dispositivo.

A disponibilidade real de cada modo será faseada. Não prometer VR, fotorrealismo ou animação avançada antes de haver implementação e testes. A configuração deve permitir selecionar um modo ou usar seleção automática baseada nas capacidades medidas do dispositivo.

## 5. Comportamento dos agentes: dois planos separados

### 5.1 Plano social local (ambiente)

Enquanto não existir um estado operacional confirmado para um agente, este pode participar em animações sociais locais. Exemplos desejados:

- levantar-se, sentar-se, caminhar e mudar de posto;
- ir buscar café ou estar na cafetaria;
- conversar informalmente com outro personagem;
- consultar o relógio, alongar-se, descansar ou observar o ambiente;
- ir até à varanda ou zona de pausa, se existir na configuração;
- regressar à secretária e alternar entre ciclos de repouso;
- apresentar diversidade de ritmos e pequenas interrupções para não parecerem bonecos congelados ou sincronizados.

O cigarro foi referido como exemplo de comportamento ambiental. Deve ser opcional, desligado por omissão e configurável por tema/contexto; nunca pode ser confundido com uma ação operacional nem obrigar todos os ambientes a representar tabaco.

Estas rotinas são simulação visual determinística/reproduzível quando possível, executada no cliente e sem acesso privilegiado ao backend. Podem ser suspensas ou simplificadas em dispositivos com poucos recursos.

### 5.2 Plano operacional real

Quando um adaptador fornece um estado operacional válido, o agente passa a representar esse estado: por exemplo, a trabalhar, à espera, bloqueado, a transferir tarefa ou a concluir trabalho. A UI deve mostrar a origem/idade do estado quando necessário e distinguir:

- estado confirmado pelo backend;
- último estado conhecido, agora desatualizado;
- estado desconhecido por falta de ligação;
- animação social local.

As animações sociais não podem substituir, falsificar ou sobrescrever eventos reais. Uma animação de “trabalhar” não significa que exista uma tarefa real.

## 6. Perda de comunicação e enfermaria

A enfermaria é uma **convenção visual e operacional configurável**, não um mecanismo mágico de recuperação.

- Um adaptador pode comunicar que um agente/departamento está desconectado, sem heartbeat, degradado ou sem responder.
- A política de cada projeto define os limiares temporais e a gravidade; o núcleo não assume que todos os projetos usam os mesmos tempos.
- Após ultrapassar um limiar configurado, a visualização pode mostrar o agente/departamento na enfermaria ou numa área de diagnóstico, com o motivo e a duração conhecidos.
- A transferência para a enfermaria deve ser explicitamente classificada como **visualização de diagnóstico**, salvo se o backend tiver emitido um evento real de quarentena/isolamento.
- Diagnóstico, reinício, isolamento, alteração de permissões ou recuperação são operações reais e só podem ser executadas através de uma capacidade explícita do adaptador, com autorização e confirmação quando apropriado.
- Se o backend estiver completamente inacessível, o Office Kit pode marcar o estado como “sem comunicação / diagnóstico visual pendente”; não pode afirmar que investigou, corrigiu ou reiniciou o agente.
- Ao regressar a comunicação válida, o adaptador fornece o estado atual; a visualização sincroniza sem inventar o histórico em falta.

A enfermaria deve poder ser renomeada, escondida ou substituída por uma área equivalente noutro domínio (por exemplo, triagem, manutenção, quarentena ou incidentes).

## 7. Comunicação social entre personagens

“Social” aqui significa encenação local: conversas, gestos, pausas, deslocações e interações ambientais. Não implica comunicação entre agentes de IA, troca de mensagens reais nem execução de trabalho.

As rotinas sociais:
- não enviam comandos ao backend;
- não alteram memória, estado de tarefa ou permissões;
- não consomem recursos de forma desproporcionada;
- podem ser pausadas, reduzidas ou desativadas;
- respeitam colisões simples, acessibilidade visual e limites físicos da cena;
- devem ter uma explicação visual clara quando um agente está realmente ocupado, indisponível ou em diagnóstico.

## 8. Facilidade de utilização

A experiência principal deve apresentar, no máximo, os controlos necessários para navegar, selecionar, pesquisar, ampliar/reduzir e consultar estado. A edição de edifícios e departamentos deve seguir uma sequência guiada:

1. escolher um modelo ou começar vazio;
2. adicionar/renomear pisos e departamentos;
3. adicionar salas;
4. adicionar agentes e escolher avatares;
5. colocar mobília e definir postos;
6. escolher estilo/qualidade;
7. pré-visualizar, validar e guardar.

Deve existir desfazer/refazer para alterações de composição quando tecnicamente viável, validação antes de guardar, e mensagens claras em vez de falhas silenciosas. O utilizador não deve precisar de conhecer Three.js, coordenadas 3D ou conceitos de renderização para configurar um escritório comum.

## 9. Responsividade e desempenho

- Suporte de layout a retrato e paisagem; rotação do dispositivo deve ser respeitada.
- A cena não deve deformar-se para caber no ecrã. Deve ajustar câmara, enquadramento, escala e densidade visual.
- Controlos de zoom e reposicionamento de câmara devem ser acessíveis.
- Nomes e etiquetas nunca devem sobrepor-se de forma ilegível; no ecrã pequeno, usar seleção/painel de detalhes em vez de mostrar todos os rótulos.
- Usar nível de detalhe adaptativo, limites de personagens animadas e redução de efeitos para hardware fraco.
- O Office Kit não deve exigir GPU de alto desempenho para abrir a configuração e consultar estados.
- A telemetria de desempenho deve ser local e opcional, sem recolha externa por omissão.

## 10. Fora do âmbito do núcleo

- Estratégia de trading, execução de ordens, gestão de risco ou credenciais de exchange;
- decisões de negócio ou raciocínio dos agentes;
- scheduler, memória de aprendizagem ou sistema de permissões do projeto anfitrião;
- afirmar saúde operacional sem evidência do backend;
- exigir VST, DGM-MAT, Vercel, uma conta externa ou um serviço cloud para iniciar a cena local;
- tornar a visualização requisito para iniciar, manter ou recuperar o backend.

## 11. Critérios de aceitação do produto

Uma versão não pode ser considerada pronta para uso geral enquanto não demonstrar:

- configuração de vários pisos, departamentos, salas e agentes sem alterar código;
- nomes e avatares configuráveis;
- mobiliário e posições configuráveis;
- importar/exportar e reutilizar configuração;
- modo offline com animação social local claramente identificada como simulada;
- adaptador de exemplo com estados reais e reconexão;
- perda/retoma de ligação sem crash e sem inventar estados;
- política configurável para diagnóstico/enfermaria;
- renderer/editor isolados do ciclo de vida do backend;
- layout utilizável em telemóvel e computador, retrato e paisagem;
- capturas de teste que revelem sobreposições, cortes, texto ilegível e deformações;
- documentação, licenças e proveniência dos materiais de terceiros;
- testes de configuração inválida, estado desatualizado, desconexão e recuperação.

## 12. Regra para decisões futuras

Qualquer decisão nova deve indicar:
1. que problema resolve;
2. que princípio deste contrato respeita;
3. se muda comportamento, formato de configuração ou compatibilidade;
4. como será testada;
5. se requer uma alteração explícita deste contrato.

Não acrescentar funcionalidades por entusiasmo se aumentarem a complexidade da experiência principal ou introduzirem dependência do backend. A prioridade é uma base sólida, simples, extensível e verificável.
