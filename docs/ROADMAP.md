# Office Kit — roteiro canónico

O roteiro é faseado por risco e evidência. Uma fase só fica concluída quando os critérios são verificados; percentagens não substituem testes.

## Princípio central: plug-and-play sem backend obrigatório
- Office Kit é uma camada de visualização/runtime genérica. Nenhum produto ou backend é obrigatório.
- Uma integração só fica ativa após seleção explícita de um adaptador compatível pelo utilizador.
- A descoberta futura apresenta candidatos e capacidades; não liga automaticamente nem executa comandos durante a descoberta.
- A integração mínima começa em leitura; comandos são capacidades opcionais, desativadas por omissão, com autenticação, autorização e confirmação do backend anfitrião.

## Fase 0 — contrato, memória e proveniência
- [x] Definir missão, princípios e fronteiras de produto.
- [x] Fixar arquitetura de alto nível e separação backend/frontend.
- [x] Documentar o papel de Diorama como referência visual.
- [x] Documentar perfis gráficos económicos a cinemáticos.
- [ ] Rever módulos e licenças antes de importar código/assets.
- [ ] Manter memória específica AndreOS Memory sincronizada com decisões e estado real.

## Fase 1 — núcleo neutro, sem renderer
- Definir tipos neutros para edifício, piso, departamento, sala, agente, avatar, mobília, estado e ligação.
- Definir schema versionado, validação, carga/guarda/importação/exportação.
- Criar testes para configuração vazia, padrão, grande e inválida.
- [x] Criar simulador genérico de runtime e testes de ciclo de vida/eventos; validar em CI antes de considerar integrado.

## Fase 2 — renderer funcional e responsivo
- [x] Integrar o motor de cena no preview e eliminar cálculos de layout duplicados na escala/enquadramento.
- Criar cena pixel-diorama pequena, configurável e inspirada no Diorama.
- [ ] Validar por capturas reais enquadramento, zoom, resize em retrato/paisagem e seleção legível em ecrãs pequenos; teste físico ainda pendente.
- [ ] Definir e validar a vista inicial do edifício inteiro em perspetiva superior angular com corte frontal; renderer final continua pendente.
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

## Fase 5 — descoberta assistida e instalação de adaptadores
- Descobrir apenas fontes autorizadas/configuradas: endpoints fornecidos, documentação selecionada, catálogo de adaptadores e conectores explicitamente ligados.
- Apresentar candidatos com origem, evidência, compatibilidade, capacidades e requisitos de autenticação.
- Permitir health-check de leitura apenas com consentimento e escopo explícito; nunca enviar comandos de escrita durante descoberta.
- Permitir escolher, instalar, configurar, testar, desativar e remover adaptadores independentemente do Office Kit core.
- Exigir escolha humana antes de criar/ativar adaptador; começar em modo de leitura.
- Não fazer varrimento indiscriminado de rede, contornar autenticação nem guardar segredos.
- Testar falsos positivos, endpoint inválido, autenticação ausente, permissões, timeout e exposição de dados.

**Estado:** requisito futuro documentado, ainda não implementado.

## Fase 6 — runtime e contrato público de adaptador
- [x] Contrato neutro de snapshot e controlador de sessão.
- [x] Simulador genérico para sincronização, eventos, heartbeat, desconexão, dados duplicados/antigos e reconexão; testes CI pendentes para este incremento.
- [ ] Definir interface pública estável de adaptador, versionamento e capacidades.
- [ ] Definir envelope de evento com sequência explícita para rejeitar eventos fora de ordem sem inferir ordem a partir de IDs.
- [ ] Construir primeiro adaptador real apenas como exemplo opcional, sem dependências específicas no core.
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
2. Corrigir escala/legibilidade do preview e validar capturas.
3. Renderer determinístico configurado por JSON.
4. Capturas retrato/paisagem e correção de sobreposições.
5. Integrar perfis gráficos e medir em aparelhos reais.
6. Animação social local com limites de recursos.
7. Contrato de backend e simulador genérico com reconexão.
8. Interface pública de adaptadores e envelope sequenciado de eventos.
9. Descoberta assistida segura, catálogo e instalação/desinstalação de adaptadores.
10. Adaptadores reais opcionais, começando em leitura e sem dependências no core.
11. Editor plug-and-play, diagnóstico e distribuição.

Não iniciar uma grande implementação 3D antes de haver contrato de dados, cena pequena testada e pipeline de capturas. Cada fase deve produzir código executável e evidência. A descoberta de backends não deve tornar a ligação automática.
