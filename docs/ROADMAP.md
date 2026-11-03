# Office Kit — roteiro canónico

O roteiro é faseado por risco e evidência. Uma fase só fica concluída quando os seus critérios são verificados; percentagens não substituem testes.

## Fase 0 — contrato, memória e proveniência
- [x] Definir missão, princípios e fronteiras de produto.
- [x] Fixar arquitetura de alto nível e separação backend/frontend.
- [x] Definir o papel de Diorama como referência visual.
- [x] Documentar perfis gráficos económicos a cinemáticos.
- [ ] Rever módulos e licenças antes de importar código/assets.
- [ ] Manter memória específica AndreOS Memory sincronizada com decisões e estado real.

## Fase 1 — núcleo neutro, sem renderer
- Definir tipos neutros para edifício, piso, departamento, sala, agente, avatar, mobília, estado e ligação.
- Definir schema versionado, validação, carga/guarda/importação/exportação.
- Criar testes para configuração vazia, padrão, grande e inválida.
- Criar backend fictício e modo sem backend.

## Fase 2 — renderer funcional e responsivo
- [x] Integrar o motor de cena com o preview e eliminar cálculos de layout duplicados na escala/enquadramento.
- Criar cena pixel-diorama pequena, configurável e inspirada no Diorama.
- [ ] Validar por capturas reais enquadramento, zoom, resize em retrato/paisagem e seleção legível em ecrãs pequenos. Playwright passou nos três viewports e confirmou zoom de departamento + regresso à vista geral; falta inspecionar novamente a captura após a implementação do foco e testar em aparelho físico.
- [ ] Definir e validar a vista inicial do edifício inteiro em perspetiva superior angular com corte frontal. O preview CSS já tem foco/zoom provisório por departamento e botão para regressar à vista geral; renderer final continua pendente.
- Preparar capturas automáticas e auditoria de consola/geometria.
- Validar Android de baixa/média capacidade e desktop.

## Fase 3 — perfis gráficos e adaptação por desempenho
- [x] Definir Económico, Equilibrado, Detalhado e Cinemático.
- [x] Definir seleção automática conservadora a partir de pistas do dispositivo.
- [ ] Integrar perfis no renderer: pixel ratio, efeitos, densidade, texturas e animações.
- [x] Adicionar seletor manual e modo Auto no preview inicial (efeitos CSS apenas; integração com renderer continua pendente).
- [ ] Medir frame time em janelas estáveis e ajustar com histerese.
- [ ] Respeitar movimento reduzido e preservar informação essencial.
- [ ] Medir CPU, memória, fluidez e bateria em aparelhos reais.

## Fase 4 — animação e vida social local
- Animações idle, caminhar, sentar/levantar, conversar e pausa.
- Rotinas de cafetaria, conversas, relógio, varanda e regresso.
- Caminhos e prevenção de sobreposição, seed determinística para QA.
- Reduzir/desligar animações em hardware fraco e provar que não envia comandos.

## Fase 5 — descoberta assistida de possíveis backends
- Descobrir apenas fontes autorizadas/configuradas: endpoints fornecidos, documentação selecionada, catálogo de adaptadores e conectores explicitamente ligados.
- Apresentar candidatos com origem, evidência, compatibilidade estimada, capacidades e requisitos de autenticação.
- Permitir health-check de leitura apenas com consentimento e escopo explícito; nunca enviar comandos de escrita durante descoberta.
- Exigir escolha humana antes de criar/ativar adaptador; começar em modo de leitura.
- Não fazer varrimento indiscriminado de rede, contornar autenticação nem guardar segredos.
- Testar falsos positivos, endpoint inválido, autenticação ausente, permissões, timeout e exposição de dados.

**Estado:** requisito futuro documentado, ainda não implementado.

## Fase 6 — runtime e adaptador de referência
- Definir interface pública de adaptador.
- Ligar backend fictício com snapshots, heartbeat, eventos e reconexão.
- Distinguir estado confirmado, desatualizado e desconhecido.
- Construir adaptador VST como exemplo sem dependências VST no core.
- Provar que fechar/reiniciar Office Kit não altera o ciclo de vida do backend.

## Fase 7 — editor plug-and-play
- Criar pisos, departamentos, salas, agentes, avatares, mobília, posições e temas sem editar código.
- Pré-visualizar, validar, guardar, duplicar, importar e exportar.
- Presets genéricos e editáveis, nunca estruturas obrigatórias.

## Fase 8 — diagnóstico/enfermaria
- Políticas configuráveis de heartbeat, estado stale e triagem.
- Mostrar motivo, duração e última comunicação conhecida.
- Separar triagem visual de isolamento real pelo backend.
- Diagnósticos/comandos apenas via capacidades autorizadas e confirmação.

## Fase 9 — robustez e distribuição
- CI, schema, testes, auditoria de assets, capturas em orientações e perfis gráficos.
- Compatibilidade/migração de configuração, segurança, acessibilidade e desempenho.
- Escolher embalagem desktop/mobile com base em evidência.

## Ordem de prioridade executável
1. Contrato e core neutro.
2. Integrar motor de cena no preview e corrigir escala/legibilidade.
3. Renderer determinístico pequeno carregado por configuração.
4. Capturas retrato/paisagem e correção de sobreposições.
5. Integrar perfis gráficos e medir em aparelhos reais.
6. Animação social local com limites de recursos.
7. Contrato de backend e backend fictício com reconexão.
8. Interação de conversa/comandos por CEO, chefias e todos os avatares, primeiro com backend fictício e estados honestos de entrega.
9. Descoberta assistida e segura de pontos de ligação a backends.
10. Adaptador VST de referência sem dependência no core.
11. Editor plug-and-play, enfermaria e distribuição.

Não iniciar uma grande implementação 3D antes de haver contrato de dados, cena pequena testada e pipeline de capturas. Cada fase deve produzir código executável e evidência. A descoberta de backends não deve tornar a ligação automática.


### Gate de validação do contrato runtime
O primeiro incremento de código valida snapshots neutros e evita mostrar estados operacionais como confirmados quando os dados estão desatualizados, por sincronizar ou sem ligação. O gate só fica concluído após CI e regressão visual verdes no mesmo HEAD e confirmação pós-merge. Autenticação da origem, transporte, heartbeat real e adaptador VST continuam fora deste incremento.


### Atualização — ciclo de vida runtime
- [x] Contrato neutro de snapshot v1 com estados não confirmados em dados stale/desconectados.
- [x] Controlador puro de ciclo de vida para ligação, sincronização, heartbeat/TTL, desconexão, erro e reconexão.
- [ ] Backend fictício integrado a uma demonstração executável e testes de eventos fora de ordem/duplicados.
- [ ] Interface pública de adaptador e contrato de autenticação/capacidades.
- [ ] Adaptador VST de leitura, apenas após validar o contrato neutro.
- Nota: o heartbeat neste incremento é um evento fornecido pelo anfitrião/controlador; não existe ligação de rede real.


### Atualização — simulador genérico e plug-and-play
- [x] Implementar simulador de runtime independente de qualquer backend e testes de ciclo de vida/eventos; validar em CI antes de considerar integrado.
- Office Kit não exige nem escolhe automaticamente um backend. A descoberta futura apresenta candidatos e capacidades, e a ativação requer seleção explícita do utilizador.
- [ ] Definir interface pública estável de adaptador, versionamento, capacidades e envelope de eventos com sequência explícita.
- [ ] Criar catálogo/instalação/desativação/remoção de adaptadores, com início em leitura e autenticação/autorização no anfitrião.
- [ ] Implementar descoberta assistida sem varrimento indiscriminado de rede, sem contornar autenticação e sem guardar segredos no core.


### Atualização — interface pública de adaptadores
- [x] Definir versão inicial do contrato público neutro de adaptador e validação do envelope de eventos.
- [x] Definir capacidade padrão de leitura e rejeitar capacidades desconhecidas ou combinações incoerentes.
- [ ] Ligar o normalizador à sessão runtime com armazenamento de sequência por origem/sessão e política explícita para lacunas de sequência.
- [ ] Definir autenticação/identidade e permissões no anfitrião antes de aceitar dados de um adaptador.
- [ ] Adicionar catálogo/descoberta assistida e fluxo de seleção humana; sem ligação automática.


### Atualização — gateway de adaptadores
- [x] Ligar adaptador selecionado explicitamente ao controlador de sessão, com snapshot inicial e limpeza de subscrição.
- [x] Testar rejeição de eventos duplicados, fora de ordem e expirados no gateway.
- [ ] Vincular a identidade do envelope à identidade autenticada pelo anfitrião e definir comportamento de lacunas de sequência.
- [ ] Construir catálogo e descoberta assistida sem seleção ou ligação automática.
- [ ] Testar integração em browser/desktop/mobile com adaptadores de demonstração separados do core.


### Atualização — catálogo de adaptadores
- [x] Criar catálogo em memória para adaptadores fornecidos explicitamente pelo anfitrião.
- [x] Listar e filtrar por capacidades declaradas; rejeitar IDs duplicados e capacidades em falta.
- [x] Seleção por ID sem ligação automática, importação dinâmica ou descoberta de rede.
- [ ] Integrar o catálogo com uma interface de seleção no host e exigir autenticação/autorização antes de passar o adaptador ao gateway.
- [ ] Implementar descoberta assistida apenas de fontes autorizadas/configuradas.

### Atualização — adaptador genérico de demonstração

- [x] Implementar adaptador de referência em memória compatível com o contrato público v1.
- [x] Integrar por seleção explícita no catálogo e ligação pelo AdapterGateway/RuntimeSession.
- [x] Cobrir snapshot inicial, estado live, alterações de agentes/tarefas, heartbeat/timeout, falha, desconexão e reconexão.
- [x] Cobrir rejeição de eventos duplicados, fora de ordem e com origem divergente.
- [ ] Validar CI e regressão visual no SHA final do PR e verificar os workflows pós-merge na main.
- [ ] Evoluir o fluxo de autorização do host para um contrato explícito de identidade autenticada e permissões concedidas; a validação atual de sourceId não é autenticação criptográfica.
- Nota: o adaptador é determinístico e em memória; não utiliza rede, credenciais ou execução de comandos.

