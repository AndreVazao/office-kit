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
