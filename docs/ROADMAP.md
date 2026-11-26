# Office Kit — roteiro canónico

O roteiro é faseado por risco e evidência. Uma fase só fica concluída quando os seus critérios são verificados; percentagens não substituem testes.

## Global checkpoint — 2026-11-26

- Main `027851c04ff1b23d239b90a06bfc4ef84aecf425`: CI [#45221372710](https://github.com/AndreVazao/office-kit/actions/runs/45221372710) and visual [#45221372578](https://github.com/AndreVazao/office-kit/actions/runs/45221372578) passed on the exact SHA.
- PR #139 head `ed38174ffd182d305ddecc587fb2f813ecab19bb`: CI [#45815953920](https://github.com/AndreVazao/office-kit/actions/runs/45815953920) passed all four Linux/Windows Node 22/26.13.1 jobs; visual [#45815953932](https://github.com/AndreVazao/office-kit/actions/runs/45815953932) passed on the same SHA. The new .NET bootstrapper is a diagnostic probe only; production host/launcher handoff, package activation/PICE, anti-replay anchor, installer lifecycle and physical-PC validation remain open.
- PR #108 head `fc20d1dce8d3d6182906e7a0386255686a72b406`: CI [#45792318835](https://github.com/AndreVazao/office-kit/actions/runs/45792318835) and visual [#45792318876](https://github.com/AndreVazao/office-kit/actions/runs/45792318876) passed on the same SHA. Its branch is 225 commits ahead and 24 behind main; browser/GLB acceptance and mainline reconciliation remain pending.
- Open production/governance gates: #104, #109, #110, #140, #141, #142, #58, #57, #121 and #124. Issues #129 and #130 are closed after PRs #132 and #133.
- GitHub reports main as unprotected and required status checks disabled. #142 tracks the required ruleset; no repository settings were changed.
- No MSI/MSIX, live backend E2E, physical-device acceptance or commercial distribution is claimed for any edition.

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
- Preservar as mesmas atividades sociais em todos os níveis; reduzir apenas fidelidade/custo de renderização em hardware fraco e provar que a simulação nunca envia comandos.

## Fase 5 — descoberta assistida de possíveis backends
- Descobrir apenas fontes autorizadas/configuradas: endpoints fornecidos, documentação selecionada, catálogo de adaptadores e conectores explicitamente ligados.
- Apresentar candidatos com origem, evidência, compatibilidade estimada, capacidades e requisitos de autenticação.
- Permitir health-check de leitura apenas com consentimento e escopo explícito; nunca enviar comandos de escrita durante descoberta.
- Exigir escolha humana antes de criar/ativar adaptador; começar em modo de leitura.
- Não fazer varrimento indiscriminado de rede, contornar autenticação nem guardar segredos.
- Testar falsos positivos, endpoint inválido, autenticação ausente, permissões, timeout e exposição de dados.

**Estado em 2026-11-23:** contrato neutro v1 integrado pela PR #127. HEAD final da PR `21d91276fc7d8e0c1bf39294ea5adb5712e7d929`; CI #45191831553 e regressão visual #45191831480 passaram nesse SHA exato. A main está em `68bb09ea21ff03d40c74bee49666ea34aa79fa6e`. O contrato puro não executa I/O nem rede; conectores, probes consentidos e UX de seleção/ativação continuam pendentes.

- [x] Contrato neutro de candidato, fontes, evidência, capacidades e estados de validação.
- [x] Inclusão do módulo genérico nas três allowlists de edição.
- [x] Regras de endpoint: HTTPS remoto, HTTP loopback, sem credenciais/query/fragment.
- [x] Evidência enumerada e capacidades declaradas sem concessão de permissões.
- [ ] Conectores reais de fontes e catálogo versionado.
- [ ] Health-check de leitura com consentimento, timeout e escopo explícito.
- [ ] Assistente de escolha/ativação humana.
- [ ] Testes de segurança e integração em ambientes reais.

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



## Requisitos acrescentados — Avatar Studio

- [ ] Criar catálogo de tipos: homem, mulher, robot masculino, robot feminino e robot/neutro personalizável.
- [ ] Criar perfil visual por avatar, separado da identidade/função do agente de backend.
- [ ] Implementar controlos para cabelo, olhos, rosto, tom de pele, corpo, roupa, calçado, acessórios, cores e animações, limitados às capacidades do modelo escolhido.
- [ ] Permitir criar, duplicar, renomear, remover e atribuir avatares a agentes/departamentos, sem tornar a associação permanente.
- [ ] Definir pipeline de assets/modelos com níveis de detalhe e fallback para hardware modesto.
- [ ] Adicionar fluxo opcional de fotografia de referência: upload com consentimento, geração automática de estilo/representação sem escolha de estilo pelo utilizador, gravação direta do avatar e ajustes manuais posteriores.
- [ ] Implementar consentimento e controlos de privacidade: fornecedor claramente identificado, fotografia original não retida por omissão, apagar original/derivados e não enviar imagens para backends de agentes.
- [ ] Suportar guardar/exportar/importar perfis e assets, com validação e compatibilidade de versões.
- [ ] Testar acessibilidade, portabilidade, configuração sem fotografia, falha de geração, ausência de assets e desempenho em baixa capacidade.

**Estado:** requisitos definidos; Avatar Studio, pipeline gráfico e geração por fotografia ainda não implementados.

## Requisito de produto — instalações privadas e independentes

- [ ] Distribuir o Office Kit como produto instalável/licenciável para cópias independentes por utilizador/cliente.
- [ ] Garantir isolamento local por instalação de configuração, escritório, avatares, assets, preferências e dados.
- [ ] Garantir funcionamento sem conta central, backend ou ligação à Internet para as funcionalidades locais.
- [ ] Manter todas as integrações externas opcionais, selecionadas e ligadas manualmente pelo proprietário, com autenticação/autorização próprias.
- [ ] Não implementar partilha entre instalações, telemetria, sincronização ou descoberta automática por omissão.
- [ ] Definir exportação, backup, migração e eventual sincronização como operações explícitas, documentadas e controladas pelo proprietário.

**Modelo de distribuição pretendido:** cada cliente tem uma instalação autónoma e privada; o fornecedor não opera um escritório central nem recebe os dados dos clientes por defeito.


## Distribuição adaptativa de renderers e instalação por capacidades

- [ ] Definir catálogo de modos visuais e níveis de qualidade, do chat/2D leve até 3D avançado e realista/cinemático.
- [ ] Definir manifesto de compatibilidade e pacotes instaláveis por plataforma, arquitetura, API gráfica, memória, armazenamento e requisitos medidos.
- [ ] Implementar avaliador de capacidades na instalação/primeira execução e instalar todos os níveis que o dispositivo suporta, não apenas o nível máximo.
- [ ] Selecionar automaticamente o modo mais alto validado, com fallback manual imediato para qualquer modo inferior instalado e opção para regressar ao automático.
- [ ] Garantir arranque no modo mais simples mesmo quando faltam assets ou runtimes avançados; fallback sem perda de configuração/sessão.
- [ ] Manter catálogo universal de avatares e perfis independentes do renderer, com variantes de assets/LOD e placeholders por nível gráfico.
- [ ] Testar instalação, atualização, remoção, mudança de renderer, memória e estabilidade em Android, Windows, Linux e hardware de diferentes capacidades.

## Federação privada e cidade multi-computador

- [x] Definir e implementar o contrato inicial de identidade criptográfica por instalação/nó: Ed25519, fingerprint, prova de posse, rotação e revogação.
- [ ] Implementar keystore persistente protegido pelo sistema operativo/browser; onboarding por convite/aprovação, confiança mútua e autorização granular continuam pendentes.
- [ ] Implementar modo isolado como padrão, sem conta central, relay/cloud obrigatório, telemetria ou comunicação externa por omissão.
- [ ] Permitir ligar explicitamente nós Office Kit dentro de uma LAN/rede privada controlada pelo proprietário.
- [ ] Permitir que cada computador mantenha o seu escritório/departamento local e que uma instalação agregadora apresente a organização/cidade com vários edifícios.
- [ ] Definir protocolo de snapshots/eventos entre nós com sequência, timestamp, heartbeat, frescura, capacidades e estados desconectado/atrasado.
- [ ] Distinguir projeção visual agregada de autoridade operacional: comandos reais continuam sujeitos ao backend anfitrião e autorização explícita.
- [ ] Permitir visualização de deslocações e encontros entre edifícios sem transformar animações em transferências operacionais reais.
- [ ] Garantir isolamento entre organizações e entre instalações não associadas; exportação, backup, migração e sincronização sempre explícitos.
- [ ] Testar rede LAN, segmentação, perda de conectividade, revogação, nó offline, conflito de versões e recuperação sem perda de dados locais.

**Modelo alvo:** instalações independentes por computador, com federação opcional apenas entre nós autorizados da mesma organização privada. Uma vista central pode compor a cidade inteira; cada nó mantém autonomia local. Os contratos e a identidade criptográfica inicial existem; persistência segura, onboarding, descoberta, transporte e agregação continuam por implementar.

## Próximo incremento — onboarding e descoberta privada automática

- [x] Definir contratos neutros versionados iniciais para `DiscoveryProvider`, `PrivateTransportProvider` e `OrganizationDirectoryProvider`, com validadores de identidade pública, hints, leases e envelopes v1 (sem I/O nem autenticação).
- [ ] Implementar descoberta LAN com anúncios mínimos; descoberta nunca equivale a confiança ou autorização.
- [x] Implementar identidade criptográfica inicial por instalação/nó, prova Ed25519 de posse, expiração de desafios e revogação.
- [ ] Implementar keystore persistente, convite de organização, aprovação explícita e autorização granular.
- [ ] Criar provider opcional para detetar/usar uma instalação Tailscale existente e nomes MagicDNS; sem segredos Tailscale embutidos nem alterações silenciosas ao tailnet.
- [ ] Criar API de rendezvous HTTPS opcional com slug da organização, leases/heartbeats e metadados mínimos; permitir deploy na infraestrutura do cliente ou serviço hospedado opt-in.
- [ ] Separar rendezvous de transporte de dados. Usar overlay privado/P2P quando possível; relay dedicado apenas como opção documentada e autorizada.
- [ ] Fazer onboarding guiado sem IPs, portas, tokens ou comandos de terminal no caminho normal; explicar os passos de consentimento/login que não podem ser automatizados com segurança.
- [ ] Garantir que Vercel é apenas um provider de hosting para diretório/API, não uma dependência de rede ou um túnel presumido.
- [ ] Adicionar testes de isolamento entre organizações, autenticação, autorização granular, replay, sequência, expiração, revogação, nó stale/offline, perda de Internet e reconnect.
- [ ] Medir custos/limites e definir política de privacidade/retensão antes de ativar qualquer rendezvous/relay hospedado.

**Critério de aceitação:** duas instalações autorizadas encontram-se sem configuração manual de IP; nenhuma instalação não autorizada é aceite; sem rede ou Internet, cada escritório continua local e apresenta estado remoto não confirmado.


## Identidade criptográfica por nó — manager e metadata SQLite implementados; keystore nativo pendente
- [x] Criar manager neutro com chaves Ed25519, fingerprint SHA-256 e desafio nonce assinado com audiência/expiração.
- [x] Definir fronteira injetável de keystore e armazenamento de metadados; manter provider efémero apenas para testes.
- [x] Cobrir criação, escopo, prova de posse, alteração de challenge, expiração, rotação e revogação por testes.
- [x] Endurecer o ciclo de vida com metadata compare-and-set revisionado, tombstones, limpeza pendente e reconciliação.
- [x] Marcar identidades com chave ausente como `identity_unavailable`; nunca regenerar silenciosamente uma identidade.
- [x] Documentar requisitos de armazenamento seguro em `docs/SECURE_STORAGE.md` (PR #17).
- [x] Implementar `SqliteNodeIdentityMetadataStore` para metadados públicos, isolamento por instalação e CAS revisionado (PR #33).
- [ ] Implementar keystore persistente protegido pelo sistema operativo/browser; ligar o provider ao host nativo.
- [ ] Validar ciclo completo com keystore persistente real após reinício do processo e em cada plataforma.


## Edições Universal e pessoais DGM-MAT/VST
- [x] Definir três perfis de produto sobre um único core: Universal, DGM-MAT pessoal e VST pessoal.
- [x] Definir allowlist de adaptadores por edição e rejeitar injeção cruzada de adaptadores.
- [x] Definir namespace único por instalação, sem auto-connect, telemetria ou partilha por omissão.
- [ ] Implementar armazenamento real separado por namespace, incluindo segredos no keystore do sistema.
- [ ] Implementar adaptador DGM-MAT de leitura e validar protocolo real com o respetivo backend.
- [ ] Implementar adaptador VST de leitura e validar protocolo real com o respetivo backend.
- [ ] Adicionar instalador/launcher que permita selecionar Universal, DGM-MAT ou VST e criar duas instalações pessoais independentes.
- [ ] Testar coexistência das duas instalações pessoais na mesma máquina e comprovar ausência de fuga de dados.

**Nota:** o perfil declara compatibilidade pretendida e fronteiras de isolamento; não é prova de integração operacional com DGM-MAT ou VST.


## Builds controlados por edição (2026-11-04)
- [x] Criar três workflows independentes: Universal, DGM-MAT e VST.
- [x] Configurar os três exclusivamente com `workflow_dispatch`; sem execução por push, PR, schedule ou release.
- [x] Validar o core e a suite completa antes de gerar o pacote de código-fonte de cada perfil.
- [x] Gerar manifesto de edição e artifact com retenção de 14 dias.
- [ ] Executar manualmente cada workflow num ponto estratégico e verificar os artifacts resultantes.
- [ ] Evoluir o pacote de código-fonte para instaladores reais desktop/mobile quando o launcher e packaging estiverem implementados.


## Integração DGM-MAT — primeiro adaptador GET-only (2026-11-04)
- [x] Criar adaptador DGM-MAT isolado do core Universal, compatível com Adapter Contract v1.
- [x] Restringir endpoint HTTP a loopback e caminhos GET explicitamente allowlisted (`/runtime/status`).
- [x] Exigir provider de sessão local injetado; nunca ler bootstrap token, criar sessão ou armazenar credenciais no adaptador.
- [x] Expor apenas capacidade `read_state`; timeout limitado, `no-store`, redirects bloqueados e polling serializado.
- [x] Falhas 401/403 e erros de transporte falham fechados.
- [x] Ligar o host Windows à sessão local DGM-MAT através de keystore CNG dedicado e bootstrap protegido (PR #72); live E2E e validação física continuam pendentes.
- [ ] Obter do DGM-MAT uma marca temporal/freshness watermark autoritativa para validar estado sincronizado.
- [ ] Executar testes E2E contra o DGM-MAT ativo no PC e confirmar leitura sem efeitos laterais.
- [ ] Integrar o resumo verificado no Office UI sem confundir telemetria com agentes ativos.
- [ ] Implementar depois o adaptador VST em branch separado.

**Estado:** adaptador inicial e testes unitários em revisão; ligação operacional real ainda bloqueada pelo provider seguro de sessão e pela ausência de watermark de frescura no endpoint consultado.


### DGM-MAT adapter hardening (2026-11-04)
- [x] Merge initial GET-only adapter (PR #20).
- [ ] Restrict the adapter to the exact loopback service origin and remove unused route allowance (PR #21).
- [ ] Implement secure host session provider and persistent OS-keystore integration.
- [ ] Add authoritative freshness metadata and run live DGM-MAT PC E2E.


## DGM-MAT local session provider — 2026-11-04
- New branch `feat/dgmat-local-session-provider` implements `DgmMatLocalSessionProvider` for the documented `POST /auth/session` contract.
- Bootstrap credential is supplied by an injected host keystore provider, used only for loopback exchange, and never cached by Office Kit; access token remains memory-only and is refreshed before expiry.
- 401/403 from the read-only adapter invalidates the injected session cache. Added unit tests for endpoint restrictions, request contract, concurrent exchange, expiry, invalidation and fail-closed responses.
- Historical note superseded by PR #72: Windows CNG bootstrap vault and DGM-MAT-only host composition are integrated and CI-validated. Live DGM-MAT and physical-PC validation remain pending.


## Licenciamento comercial e distribuição assinada
- [x] Definir modelo inicial de licenças perpétuas por número de instalações e opção de serviços empresariais recorrentes separados.
- [x] Implementar schema de entitlement, canonicalização, verificação Ed25519 injetável, validade, edição/plano/features e avaliação de limite de instalações.
- [ ] Implementar keystore/registry durável e atómico de ativações no host nativo, com desativação e migração controladas.
- [ ] Implementar serviço de emissão e assinatura de licenças fora do cliente, gestão/rotação de chaves e registo imutável de encomendas/faturas.
- [ ] Definir integração de pagamentos, fiscalidade/VAT, EULA, privacidade, reembolsos, suporte e política de atualizações.
- [ ] Criar aplicação Android e desktop real, package IDs finais e pipeline protegido de assinatura (Play App Signing/AAB e Authenticode).
- [ ] Validar instalação, atualização, recuperação de licença, revogação online opcional e funcionamento offline em dispositivos reais.


## Próximo incremento — registo e ativação comercial
- [x] Implementar contrato de ativação com idempotência, limites de lugares dentro de transação atómica, desativação e listagem minimizada.
- [x] Endurecer validação de datas de licenças para rejeitar datas de calendário impossíveis.
- [ ] Implementar store durável partilhado e providers de identidade/keystore no host nativo (Windows DPAPI/CNG e Android Keystore).
- [ ] Implementar serviço privado de emissão/assinatura de licenças, registo de encomendas e ligação a faturação/pagamentos.
- [ ] Construir aplicação nativa/launcher antes de declarar qualquer pacote pronto a instalar.


## Persistência SQLite e host nativo — atualização 2026-11-07
- [x] PR #27: fronteira SQLite host-injected com transação imediata.
- [x] PR #28: evitar escrita em operações no-op.
- [x] PR #29: detetar mutações in-place.
- [x] PR #30: integração com motor SQLite real, ficheiro, reabertura e rollback.
- [x] PR #31: bloqueio de escritores entre conexões independentes.
- [x] PR #32: exclusão de escritores em processos separados com `BEGIN IMMEDIATE`.
- [x] PR #33: metadata SQLite pública de identidade, isolamento por instalação e CAS revisionado.
- [x] Teste de recuperação após terminação abrupta do processo durante transação SQLite WAL, com verificação do estado confirmado e `PRAGMA integrity_check` (branch `test/sqlite-node-identity-crash-recovery`; CI pendente).
- [ ] Validar perda física de energia/falha de armazenamento, ACLs, cifragem, backup e restore no host nativo.
- [ ] Implementar host Windows: diretório de dados por instalação, ACLs restritivas, DPAPI/CNG/credential vault e migração/backup.
- [ ] Implementar hosts equivalentes para Linux e Android sem misturar credenciais ou namespaces das três edições.
- [x] Executar suite completa Node.js 22 em runners Linux e Windows, incluindo SQLite real, locking e crash recovery em processos separados (primeiro HEAD corrigido do PR #41: `f8e84462e4c7533b22a528bbeb4a50f7ebf1f40b`; CI run `42383194963` e visual run `42383194951` verdes). O HEAD final do PR continua sujeito a revalidação após alterações documentais.
- [ ] Ligar providers nativos persistentes ao manager e ao registry de licenças.
- [ ] Criar launcher/desktop e app Android instaláveis; os artifacts atuais são pacotes de código-fonte, não instaladores.


### Atualização — integração do manager com metadata SQLite
- [x] Store SQLite para metadados públicos, isolado por `installationId` e com CAS revisionado (PR #33).
- [x] PR #36 integrada: validar `NodeIdentityManager` com a store após reabertura da base e ciclo create/prove/rotate/reconcile/revoke (CI e visual verdes no HEAD `4a95875df759c7df37701568a5910bd7abb62125`; usa keystore efémero no mesmo processo, não provider nativo).
- [x] Implementar provider persistente Windows CNG P-256, com chave privada não exportável no Microsoft Software KSP (PR #44); DPAPI/Windows Credential Manager não são usados por este provider.
- [x] Validar recuperação após terminação abrupta de processo durante transação SQLite WAL, com verificação do último estado confirmado e `PRAGMA integrity_check` (PR #37; CI/visual verdes no HEAD `6b99b093a0912d705cea551f8bcf3e020ef584ab`).
- [ ] Validar perda física de energia/falha de armazenamento, ACLs, cifragem, backup/restore e recuperação no host Windows.


### Validação do ciclo de vida SQLite — PR #36 integrada
- [x] Testar create, leitura da identidade pública, prova de posse, rotate, reconcile e revoke com SQLite real em ficheiro temporário e reabertura da DB.
- [x] Validar a factory com CNG persistente e SQLite reaberta, recriando o `NodeIdentityManager` e verificando replay/revoke no runner Windows (PR #46); o restart do processo host completo continua pendente.
- [x] Implementar/testar provider nativo Windows CNG e manter chaves privadas fora da SQLite (PR #44); DPAPI é alternativa não implementada, não requisito do provider CNG.


### Identidade e federação — replay protection
- [x] Impedir reutilização local de challenges antes de assinar.
- [x] Persistir consumo de nonce em SQLite com unicidade e transação imediata.
- [x] Exigir replay store persistente quando o keystore é persistente.
- [ ] Implementar e testar consumo one-time também no verificador remoto/federação.
- [ ] Testar falhas de processo/power-loss e permissões reais do ficheiro SQLite no host.


### Identidade criptográfica multiplataforma
- [x] Validar a seleção explícita entre Ed25519 e ECDSA P-256/SHA-256 no mesmo HEAD em Linux e Windows (PR #42, HEAD `650e63a417dfca36483d20bdbde2d945542ee1b2`, CI 150/150 por runner e regressão visual verde; squash merge `5212c3044bf890cc924180c6030012d55647d5f9`).
- [x] Implementar provider Windows CNG persistente com chave privada não exportável no Microsoft Software KSP; integração validada em runner Windows (PR #44).
- [x] Testar persistência entre processos, sign/verify, export refusal, delete e isolamento de installation IDs no runner Windows.
- [x] Testar create/prove/recriação do manager/replay/revoke com CNG + SQLite no runner Windows (PR #46).
- [ ] Testar rotação, falhas de cleanup, restart do processo host/sistema e capacidades no desktop/PC físico.
- [ ] Definir migração explícita de algoritmo para identidades já emitidas; nunca trocar algoritmo silenciosamente.


### Windows CNG e identidade persistente
- [x] Validar o helper CNG real em runner Windows no HEAD final: persistência entre processos, private export refusal, sign/verify, delete e isolamento entre installation IDs (PR #44, HEAD `e04c9a4a9e00a5d39b9c1aa982186403dfed1877`, CI `42420915287`; pós-merge main `42421035235`).
- [ ] Integrar o helper no host/instalador Windows e validar atualização, desinstalação e limpeza explícita de chaves.
- [ ] Executar teste de instalação e recuperação numa máquina física Windows; CI runner não substitui esse teste.
- [ ] Avaliar provider TPM separado, sem declarar hardware backing no Microsoft Software KSP.


### Providers nativos e isolamento de runtime
- [x] Separar o entrypoint Windows CNG do entrypoint genérico/browser para impedir que dependências Node nativas contaminem Universal e a pré-visualização web.
- [x] Validar CI Windows/Linux e regressão visual no mesmo HEAD `77669de98b42bdc6bcf1d866797cc6ef1a066707` (PR #46; CI `42483528564`, visual `42483528517`).
- [ ] Integrar provider CNG com o host desktop e instalador Windows, incluindo ACLs, atualização e limpeza de chaves.


### Adapter Runtime Bridge — recuperação e hardening
- [x] Reaproveitar invariantes de sequência/session do trabalho antigo sem introduzir uma implementação paralela ao AdapterGateway.
- [x] Buffer limitado de eventos antes do snapshot inicial e subscrição antes do snapshot para evitar janela de perda.
- [x] Vincular origem ao adaptador selecionado e sessão até reconnect; falhar fechado em lacunas, troca de sessão e overflow.
- [x] Rejeitar eventos agent/task incrementais enquanto não existir contrato de patch/estado autoritativo.
- [ ] Definir schema de patches versionado e aplicar atualizações incrementais com testes de snapshot reconciliation.
- [ ] Integrar autenticação/credenciais/transport no host desktop sem permitir comandos no modo inicial read-only.


## Windows native identity runtime
- [x] Compor `NodeIdentityManager` com Windows CNG P-256, metadata SQLite e replay store SQLite numa factory específica da plataforma.
- [x] Validar create/prove, fecho/reabertura SQLite, recriação do manager, persistência da identidade, replay rejection e revoke no runner Windows (PR #46, HEAD `77669de98b42bdc6bcf1d866797cc6ef1a066707`; CI `42483528564`, visual `42483528517`).
- [x] Testar rotação, remoção da chave anterior, persistência após reabrir SQLite, replay rejection, prova pós-restart do manager, revoke e reconciliação no runner Windows (PR #48, HEAD `1b856195ada69de5fbb0ab64b7c82d736aafdacb`; CI `42484745984`, visual `42484745951`).
- [x] Injetar falhas de remoção na rotação e no revoke, reabrir SQLite e validar recuperação/reconciliação com novo manager e helper CNG real (PR #50, HEAD `2d62835a4e2e58187205b523b4b4bb27feb21155`; CI `42485145796`, visual `42485145823`).
- [ ] Testar falhas reais de ACL/armazenamento, restart do processo host/sistema e recuperação no PC físico.
- [ ] Ligar a factory ao host desktop/launcher e instalador; o host mantém responsabilidade por ACLs, gestão do ficheiro SQLite, instalação do helper e ciclo de vida do processo.


## Windows host integration contract
- [x] Document the future host composition API, startup reconciliation, health states, lifecycle, ACL boundary and uninstall retention behavior.
- [x] Extend native integration coverage to rotation, old-key deletion and reopened-database persistence.
- [ ] Implement the actual desktop host/launcher and signed helper installation.
- [ ] Validate ACLs, upgrade/rollback, health and uninstall on Windows runner and physical PC.

## Windows local host runtime
- [x] Implementar composition root local Windows com diretório de dados privado, ACL por SID, installation ID estável e lock de instância única.
- [x] Abrir SQLite local com WAL/FULL e compor CNG + stores persistentes; reconcile e health antes de expor estado.
- [x] Exigir helper com Authenticode válido; CLI com health/create/rotate/revoke explícitos, sem enrollment automático ou rede.
- [ ] Validar ACLs e assinatura/trust chain em runner Windows com certificado de teste e num PC físico.
- [ ] Criar assinatura de release e instalador MSI/MSIX, atualização/rollback, uninstall com retenção explícita e backup/restore.
- [ ] Testar recuperação após crash/forçar terminação do host e reinício do Windows.

## Windows host security validation
- [x] Add Windows-runner integration coverage for effective ACLs (current user + SYSTEM) on install/data directories and SQLite metadata.
- [x] Add a real Authenticode negative test that rejects an unsigned helper.
- [ ] Pass the native Windows runner on the final PR HEAD and inspect the effective ACL test output.
- [ ] Validate on a physical PC with the actual signed distribution helper and installer.

## Windows host startup safety
- [x] Reconcile persisted identity at host startup before create/rotate/revoke.
- [x] Fail closed on startup recovery errors and release DB/process lock during shutdown.
- [ ] Pass CI Linux/Windows and visual regression on the exact PR HEAD.

## Windows portable distribution
- [x] Bundle Node.js runtime, Windows host modules and CNG helper into a portable directory.
- [ ] Pass CI end-to-end test using an ephemeral trusted signing certificate on Windows.
- [ ] Add release signing using a protected publisher certificate and verify signer thumbprint.
- [ ] Build MSI/MSIX installer with start/health/uninstall and explicit data retention.
- [ ] Validate upgrade/rollback, backup/restore and physical-PC installation.
## New product increment — Office Health & Recovery (2026-11-09)
- [ ] Add layered diagnostics for Office Kit runtime, adapter, transport/network and backend, with confirmed/probable/indeterminate cause and evidence.
- [ ] Add persistent, exportable, secret-redacted incident records and local support bundle.
- [ ] Add bounded self-recovery and reconnection; require a fresh consistent snapshot before restoring healthy/live status.
- [ ] Keep offline/no backend distinct from configured backend failure; use social mode for the former and infirmary/incident state for the latter.
- [ ] Add fault-injection tests for runtime bugs, adapter exceptions, DNS/port/timeout, authentication, backend unavailable, stale snapshots and successful recovery.

## New product increment — social simulation with behavior-preserving adaptive rendering (2026-11-09)
- [ ] Implement a local pseudo-random social behavior engine with variable activities, durations, routes and interactions; no fixed repetitive daily loop.
- [ ] Preserve the same activity semantics across advanced 3D, low-poly, pixel and minimal renderers. Lower hardware capability changes visual fidelity and rendering cost only; it must not remove social activities or avatar interactions.
- [ ] Decouple simulation time from frame rate and keep local social behavior active without a backend.
- [ ] Keep simulated activity explicitly labelled and separate from backend-confirmed work; real progress bars require fresh authoritative progress data.
- [ ] Add independent CPU/memory budgets for renderer and backend; detect hardware at install and runtime, apply hysteresis, allow manual override and recover quality as resources return.
- [ ] Validate on low-resource Windows and stronger desktop hardware without making the test PC a feature ceiling.

## Next implementation order after the portable Windows bundle gate — 2026-11-23
1. Implement and validate the installer-authenticated Windows publisher policy, exact signer binding and bounded revocation policy; keep startup fail-closed until complete.
2. Deliver independent MSI/MSIX install, upgrade, rollback/recovery, uninstall and data-retention flows for Universal, DGM-MAT and VST.
3. Integrate signed-license verification and durable activation into each edition's host with isolated namespaces, platform identity and backup/recovery.
4. [x] Correct the VST public `/health` versus private authentication boundary (PR #132; issue #129 closed). Public health sends no token and cannot invalidate the private session.
5. Keep VST PAPER controls blocked until issue #121 has an atomic backend-enforced PAPER-only contract; implement remote Tailscale Serve only after issue #124 security and physical E2E gates pass.
6. Implement a real consented TPM 2.0 monotonic provider and physical recovery tests; do not promote protected writes based on metadata probes or fake anchors.
7. Deliver native Linux/macOS/Android hosts and platform-native keystores, then run real-device installation and lifecycle tests.
7. Generate the Desktop Commander installation/test prompt only after the package passes automated release gates. Never use live trading or destructive DGM-MAT operations during validation.
### Estado do primeiro incremento de código — PR #55 branch
- [x] Criar protótipo puro do motor social local, com seed QA, atividades variáveis e sem autoridade operacional.
- [x] Criar contrato de diagnóstico por camadas, redaction e coordenador de recuperação local com verificação de snapshot.
- [x] Criar arbitragem explícita offline/synchronizing/infirmary/live e regra de progresso real.
- [x] Criar política adaptativa de recursos com tiers de renderer, override e hysteresis, preservando semântica social.
- [ ] Obter CI Linux + Windows e regressão visual verdes no mesmo HEAD final.
- [ ] Ligar probes reais e armazenamento persistente de incidentes no host.
- [ ] Integrar deteção de hardware e política no instalador e renderer de produção.
- [ ] Ligar motor social à cena/renderers e testar equivalência comportamental em todos os tiers.

**Nota:** os quatro itens marcados como código inicial são protótipos de arquitetura/testes; não significam integração de produção nem validação física.


### Atualização 2026-11-09 — motores sociais, saúde e política de recursos (PR #55; validação pendente)

- [x] Adicionar o primeiro motor local de simulação social com seed de QA, durações variáveis, locais, interações e autoridade explicitamente simulada.
- [x] Adicionar a primeira arbitragem pura entre offline social, sincronização, enfermaria e estado live verificado; progresso visual só é exposto para tarefas de backend em execução com percentagem válida.
- [x] Adicionar coordenador inicial de diagnóstico por camadas, redaction de evidência, contrato de incident store e execução limitada por chamada de ações locais fornecidas pelo host.
- [x] Adicionar política adaptativa automática/manual de renderer, histerese e orçamento de recursos separado do backend.
- [ ] Validar CI Linux/Windows e regressão visual no mesmo HEAD final da PR #55.
- [ ] Integrar sondas reais autorizadas e atribuição positiva de causa confirmada.
- [ ] Substituir o provider de incidentes em memória por persistência SQLite durável, exportação de suporte e proteção contra adulteração.
- [ ] Implementar limites de frequência/idempotência de recuperação entre chamadas e ligar ações locais reais do host.
- [ ] Ligar a política de recursos à deteção nativa de CPU/RAM/GPU/VRAM e aos renderers efetivamente instalados.
- [ ] Validar equivalência comportamental dos renderers e desempenho em máquinas físicas.

**Limite de evidência:** os módulos e testes desta PR são um primeiro incremento de core. Não representam integração com drivers reais, persistência de incidentes em produção, instalador, renderer integrado, nem testes em PC físico. O bundle portátil Universal Windows usa uma allowlist backend-neutral; a separação do entrypoint genérico e dos pacotes npm por edição continua pendente (issue #56).
### Diagnóstico persistente e Windows bundle — incremento em PR #55
- [x] Implementar armazenamento SQLite de incidentes isolado por instalação.
- [x] Ligar store ao Windows host e permitir criar motor de diagnóstico com probes/actions injetados.
- [x] Testar persistência do incidente após reinício do host.
- [ ] Implementar probes reais por camada e identificação da origem com confiança/evidência.
- [ ] Integrar recuperação local autorizada, snapshot de verificação e exportação de suporte com consentimento.
- [ ] Validar Windows portable E2E com rejeição do launcher para signer não confiável e assinatura pinada no runner de teste; aceitação positiva de publisher confiável permanece validação física.
### Hardware host e limites de diagnóstico — incremento
- [x] Detetar OS, CPU, RAM e espaço livre através do host Node.
- [x] Aceitar providers opcionais de GPU/VRAM dedicada/API gráfica e resolução sem inventar dados.
- [x] Calcular política adaptativa no arranque e expor refresh/override manual no host Windows.
- [x] Aplicar deadlines às probes, recuperação local e verificação de snapshot.
- [x] Executar o teste do bundle através do launcher .cmd sem wrapper PowerShell extra.
- [ ] Implementar providers reais de GPU/resolução em Windows/Linux.
- [ ] Agendar reavaliação dinâmica e persistir overrides do utilizador.
- [ ] Aplicar os orçamentos/perfis ao renderer real preservando a semântica social.
### Ligação do motor social à preview
- [x] Substituir escolha de atividade fixa pelo SocialSimulationEngine.
- [x] Preservar estado entre atualizações e mover avatares quando a atividade/localização muda.
- [x] Mostrar cues visuais leves para atividades sociais e trabalho ao computador.
- [x] Manter animações no perfil gráfico economy e identificar explicitamente modo offline simulado.
- [ ] Ligar o mesmo motor ao renderer desktop/native.
- [ ] Integrar o estado live real e barras de progresso apenas com snapshots backend verificados.
- [x] Atualizar testes de preview para o banner OFFLINE e integração do SocialSimulationEngine; remover expectativa textual obsoleta e verificar movimento no perfil economy.
- [x] Distinguir threads lógicas reportadas pelo sistema operativo de núcleos físicos; não apresentar a contagem lógica como cores físicos.
- [x] Isolar stdout/stderr do E2E Windows em ficheiros temporários para evitar bloqueios por pipes herdados.
- [x] Aplicar allowlist explícita ao bundle Universal Windows e testar ausência de módulos DGM-MAT/VST no artefacto.
- [ ] Validar o ciclo portátil completo no runner Windows com assinatura pinada de teste; validar publisher confiável numa instalação física.
### Correção E2E Windows — 2026-11-10
- [x] Corrigir sintaxe PowerShell na validação da allowlist Universal do manifesto.
- [ ] Confirmar que o runner Windows ultrapassa a validação do manifesto e conclui assinatura pinada + ciclo health/create/reopen/rotate/revoke/health.
- [ ] Confirmar CI Linux, CI Windows e regressão visual no mesmo HEAD antes de merge.
- [x] Antecipar validação de sintaxe PowerShell do build e E2E no CI Windows, antes da publicação CNG.

### Edition source/package isolation — PR #56 branch (2026-11-10)
- [x] Remove DGM-MAT exports from the generic scene-engine entrypoint.
- [x] Add a DGM-MAT-only entrypoint.
- [x] Replace root-repository npm pack with temporary staging and explicit per-edition allowlists.
- [x] Keep VST package free of unimplemented VST-specific code and label the adapter as not implemented.
- [x] Align package engines and manual workflows with Node 22 / minimum 22.5 for node:sqlite.
- [x] Add tarball-content assertions for Universal, DGM-MAT and VST.
- [ ] Pass Linux/Windows CI and all three manual edition build workflows on the final PR HEAD.

### SQLite incident concurrency — PR #60
- [x] Require immediate SQLite transactions for incident append and read/modify/write updates.
- [x] Add monotonic revision and compare-and-set update guard.
- [x] Migrate existing incident rows to revision 1.
- [x] Add real SQLite migration and two-process contention tests.
- [ ] Add append-only event history and keystore-backed integrity chain.
- [ ] Add chain verification, crash/power-loss recovery and owner-consent support export.

### Connection supervision and incident lifecycle — PR #61
- [x] Detect verified live-to-unhealthy session transitions without confusing startup with an outage.
- [x] Add transport transition evidence to layered diagnostics.
- [x] Keep one incident per outage and append subsequent diagnostic observations.
- [x] Resolve only after healthy probes plus a fresh authoritative live snapshot.
- [x] Add deterministic lifecycle tests and generic entrypoint export.
- [ ] Pass Linux/Windows CI and visual regression on final PR HEAD.
- [ ] Wire supervisor into the installed host lifecycle and verify with real DGM-MAT/VST adapters.


## DGM-MAT adapter/session hardening — branch feat/dgmat-session-hardening (2026-11-10)
- [x] Restrict the adapter to authenticated loopback `GET /runtime/state` only.
- [x] Treat source `timestamp` as last state mutation, not heartbeat/snapshot freshness; remain synchronizing and suppress agent/task activity until a separate authoritative watermark exists.
- [x] Bound token-provider, fetch and response-body work under one request deadline.
- [x] Normalize provider/fetch errors; await bounded async invalidation on 401/403; prevent secret-shaped status/error values from entering Office Kit state/events.
- [x] Generate a fresh UUID session identity per successful connection and reject late poll completions from earlier connection generations.
- [x] Bound the full DGM-MAT local session exchange (bootstrap provider, POST and JSON body) and propagate caller cancellation.
- [x] Implement a dedicated Windows OS-keystore record/provider for the protected DGM-MAT bootstrap credential; do not reuse node-identity keys (PR #72).
- [ ] Wire the DGM-MAT session provider into a DGM-MAT-only Windows host composition root.
- [ ] Verify the live `/runtime/state` and `/auth/session` contracts against the running local DGM-MAT instance without enabling writes.
- [ ] Run the full DGM-MAT edition workflow and validate on a physical PC. Unit/fake tests are not live integration.
- [x] Implement the VST read-only cockpit adapter separately; keep VST credentials and code out of Universal and DGM-MAT. It consumes the fixed 12-route GET allowlist, uses a memory-only session token and redacts claim tokens/credentials/private paths.
- [ ] Complete the fixed `POST /assistant/message` bridge with backend-enforced scopes, PAPER command refusal, no automatic retries and 401/403/connectivity separation (Phase 2 branch under validation).
- [ ] Reconcile real research task states and request IDs from backend snapshots (Phase 3).
- [ ] Add PAPER controls only through the existing VST routes and their backend permissions (Phase 4).
- [ ] Validate live E2E and LAN/Tailscale identity/transport (Phase 5); Android and distribution remain later gates.

## PR #61 — merged validation record (2026-11-10)
- [x] Linux CI passed on final PR HEAD `ded5a449b452fdf56048ff547279fe3b06ddda23`.
- [x] Windows CI passed on that exact HEAD, including native CNG, persistent identity and portable host bundle end-to-end.
- [x] Visual regression passed on that exact HEAD.
- [x] PR #61 merged; merge commit `43adb778b8e03d85c1766f5f1bc68ca15ecea027`.
- [ ] Integrate OfficeConnectionSupervisor with the installed host lifecycle.
- [ ] Validate real DGM-MAT and VST backend sessions and physical-PC installation in their isolated editions.
- [ ] Complete physical-PC install/lifecycle tests; do not treat CI bundle tests as physical validation.
- [ ] Complete production signing and MSI/MSIX installer, upgrade/rollback and explicit uninstall/data-retention behavior.


## Host-managed adapter supervision — próximo incremento
- [x] Compor o supervisor de incidentes com o AdapterGateway no host Windows.
- [x] Persistir incidentes por instalação e encerrar gateways no shutdown.
- [x] Cobrir perda de transporte e recuperação confirmada com adapter de demonstração.
- [ ] Validar Linux/Windows CI e regressão visual no mesmo HEAD.
- [ ] Ligar adapters DGM-MAT e VST reais, mantendo seleção/autorização explícitas e modo read-only.
- [ ] Validar no PC físico; não confundir testes automatizados com instalação real.

- [x] Corrigir o empacotamento Windows para incluir as dependências transitivas do AdapterGateway e manter build/test allowlists sincronizadas.
- [ ] Confirmar Linux, Windows E2E e visual regression no mesmo HEAD após a correção.


## Fase 9A — ciclo de vida da instalação (em desenvolvimento)
- [x] Definir coordenador serializado para install/start/stop/restart/upgrade/rollback/uninstall.
- [x] Exigir health confirmado antes de declarar instalação/arranque saudáveis.
- [x] Preservar dados por omissão e exigir opt-in explícito para remoção.
- [x] Testar falha de upgrade, restauração da versão anterior e serialização de operações.
- [ ] Implementar store persistente com escrita atómica e recuperação de operações interrompidas.
- [ ] Implementar driver Windows real com serviço/Task Scheduler e permissões mínimas.
- [ ] Definir driver Linux (systemd/user service) sem assumir privilégios root.
- [ ] Empacotar MSI/MSIX e pacote Linux; assinar releases com publisher confiável.
- [ ] Validar upgrade/rollback/uninstall em runners e PC físico sem tocar nos backends VST/DGM-MAT existentes.

O coordenador atual é uma camada de orquestração com driver/store injetados; não equivale a instalador operacional. A próxima implementação deve construir o store durável e um driver de plataforma testável, começando por Windows.


## Fase 9B — estado durável do ciclo de vida
- [x] Implementar store SQLite isolado por installation ID.
- [x] Persistir cada atualização de registo numa transação atómica SQLite.
- [x] Integrar o store na base de dados privada do Windows host.
- [x] Testar isolamento, reabertura, corrupção e commit.
- [ ] Adicionar checkpoints explícitos para operações interrompidas (staging/backup/activation/rollback/uninstall).
- [ ] Recuperar operações incompletas com decisão fail-closed e health validation.
- [ ] Construir driver real Windows e Linux e validar em runners.
- [ ] Empacotar e assinar instaladores; validar no PC físico sem tocar nos backends já instalados.


### Nota de validação — PR #66 (2026-11-11)
- [x] Corrigir allowlist do bundle Windows para copiar `sqlite-installation-lifecycle-store.mjs` e exigir o módulo no teste E2E.
- [ ] Revalidar Linux CI, Windows portable-host E2E e visual regression no mesmo HEAD antes de integrar.


### Fase 9C — checkpoints e recuperação conservadora (PR em desenvolvimento)
- [x] Persistir checkpoints de operação/fase antes e depois dos passos externos críticos.
- [x] Detetar operação pendente na inicialização sem executar mutações automáticas.
- [x] Recuperar instalação interrompida preservando dados.
- [x] Reverter upgrade interrompido quando backup concluído e validar health.
- [x] Bloquear fases ambíguas, rollback/uninstall e transições de serviço interrompidas para intervenção explícita.
- [ ] Validar CI Linux, Windows e visual regression no mesmo HEAD.
- [ ] Ligar recuperação a driver Windows real com inspeção autoritativa do serviço e testar falhas reais em VM/PC.
- [ ] Implementar driver Linux e pacotes assinados.


### Fase 9C — validação concluída e integração no host
- [x] Validar CI Linux, Windows e visual regression no mesmo HEAD da PR #67.
- [x] Integrar a recuperação conservadora em `main` (merge #67).

### Fase 9D — composição e driver Windows real
- [x] Expor o coordenador de ciclo de vida no Windows host usando o store SQLite da instalação.
- [x] Testar persistência de estado através do fecho e reabertura do host com driver simulado.
- [ ] Implementar inspeção autoritativa read-only de serviço/processo Windows, sem iniciar/parar nada durante descoberta.
- [ ] Definir driver de controlo com allowlist explícita, validação de caminho/binário, privilégios mínimos e autorização do proprietário.
- [ ] Cobrir falhas e recuperação em Windows CI; só depois ligar operações destrutivas de lifecycle.
- [ ] Não declarar instalador até existir um executável/serviço host apropriado, pacote assinado e testes de instalação/upgrade/uninstall.


### Fase 9E — credencial DGM-MAT protegida e composição isolada (PR #72 integrada, 2026-11-11)

- [x] Validar no mesmo HEAD o CNG secret vault: SQLite contém apenas envelope AES-256-GCM; chave RSA de wrapping não exportável no Windows Software KSP.
- [x] Validar persistência entre processos helper, cancelamento/deadline, isolamento por installation ID/namespace e bundle Windows portátil.
- [x] Confirmar que apenas a edição DGM-MAT exporta `./windows-host/dgmat`; Universal e VST excluem a composição/credenciais DGM e mantêm a primitiva genérica.
- [x] Validar provisioning/removal com consentimento explícito, conexão manual e modo read-only.
- [ ] Executar teste live contra DGM-MAT e validação em PC físico.
- [ ] Implementar e validar backup/restore do perfil CNG; SQLite-only backup não é suficiente e chaves privadas permanecem não exportáveis.

**Evidência:** PR #72 squash-merged como `2395a8a841d8a0a29cc3d67a0e76eb352921f40f`; CI #493 e visual #413 passaram no HEAD `a616e902f8cf7fdbecbb1f5cd0a3e7a60cafc708`. O runner Windows validou integração nativa CNG; não é prova de execução no PC físico nem contra backend DGM-MAT ativo.

### Segurança do journal — MAC e keyring versionado (PRs #73 e #75 integradas, 2026-11-12)

- [x] MAC HMAC-SHA-256 por evento, encadeado com domínio, installation ID, sequência, hash do evento e MAC anterior.
- [x] Chave aleatória de 256 bits protegida pelo Windows CNG Software KSP; fail-closed se a chave autenticadora desaparecer.
- [x] Verificação antes de leitura/exportação, baseline autenticada para journals SHA-256 legados e testes de persistência CNG entre processos/aberturas do host.
- [x] Keyring limitado com IDs únicos e active key explícita; verificação histórica por `key_id`; novos eventos usam a chave ativa; MACs antigos não são reescritos.
- [x] Linux, Windows CNG nativo, bundle portátil E2E e regressão visual aprovados nos HEADs finais das PRs #73 e #75.
- [x] PR #79 integrada em `4d9181f2e93a9596bf268fa521a8860d14355d1b`: rotação Windows CNG pelo host com consentimento explícito, active-key pointer persistente, recuperação após interrupção e retenção de chaves históricas; CI Linux/Windows Node 22/26.13.1 e regressão visual pós-merge passaram no mesmo SHA.
- [x] Definir contrato neutro `MonotonicAnchorProvider`, estados explícitos, validação estrita de capacidades e compare-and-advance de uma geração; testes com provider fake (não é proteção física).
- [x] PR #84 squash-merged em `0163babd2ad2524dc1d82fe3f45e1c016070d6ee`: adapter SQLite para checkpoint metadata e prepare durável, `BEGIN IMMEDIATE`, finalização idempotente e testes em ficheiro temporário; CI #554 e visual #474 passaram no mesmo HEAD `c2598283cbe99f0d96c694f5e2f07419ce9181bd`.
- [ ] PR #85 em validação: partilhar lock entre writes do incident store e checkpoint coordinator; provar exclusão do host singleton Windows em processos separados. Não cobre processos que contornem o host.
- [ ] Integrar append de evento/MAC e checkpoint prepare/finalize numa sequência crash-consistent; validar recuperação com falhas injetadas.
- [ ] Implementar provider TPM 2.0 nativo com provisioning explícito e fallback fail-closed.
- [ ] Validar power-loss/filesystem durability e backup/restore em hardware físico.
- [ ] Implementar providers equivalentes para Linux, macOS e Android.

### Gate de runtime SQLite — CI concluído em 2026-11-12

- [x] PR #77 squash-merged em `d0bcd59055202e7a845bb2b103cf91c72597a1b2`; HEAD final `fe811f4d8b44ae81b4294bd2e108065212176bde`.
- [x] CI #43226023576 passou Node 22 e Node 26.13.1 em Linux/Windows; Windows executou CNG nativo, identidade persistente, journal autenticado e bundle portátil E2E em ambos os runtimes.
- [x] Regressão visual #43226023574 passou com Chromium em Node 26.13.1; workflows visuais e builds manuais das três edições foram movidos para Node 26.13.1.
- [x] Builds dos três source packages passaram na matriz Linux Node 22/26.13.1.
- [ ] Manter o engine floor `>=22.5.0` até a maturidade de `node:sqlite` justificar uma decisão diferente: Experimental no Node 22 e Stability 1.2 — Release Candidate no Node 26.
- [ ] Validar migração, locking, concorrência e recuperação no runtime final; os testes atuais não demonstram power-loss físico.


## Estado consolidado de produção — 2026-11-12

### VST — adaptador read-only preview

- [x] Implementar entrypoint VST separado e manter o entrypoint genérico independente.
- [x] Limitar o adapter a loopback autenticado `GET /observer/summary` com `X-Token`, sem redirects, rede remota ou rotas de escrita.
- [x] Compor host Windows VST com token de controlo apenas em memória durante a sessão; definir/limpar exige consentimento explícito e a ligação é manual.
- [x] Não inventar agentes/tarefas; manter `executionAuthorized=false`, `allowRiskBearingActions=false` e readiness `unverified`.
- [x] Adicionar testes de contrato/frescor, segredo, sessão, cancelamento, reconnect e isolamento dos tarballs das três edições.
- [x] Checkpoint de implementação `3aff126095e4af10d16ea65fccaeb58be983eb43`: CI #43230962819 e regressão visual #43230962934 passaram no mesmo HEAD; Linux/Windows Node 22 e Node 26.13.1 aprovados.
- [x] Teste VST de sessão efémera passou em CI quando adicionado: token não persistido, GET autenticado e limpeza em disconnect/close; a resposta HTTP é simulada, não prova compatibilidade live.
- [x] Bundle Windows portátil E2E passou nos dois runtimes Windows; launcher rejeitou publisher CI não confiável e os testes locais SQLite/CNG de identidade passaram.
- [x] PR #78 squash-merged em `28e52d500490501a2a9a6d08cd3ca6ddad8ce8d5`; HEAD final `df35a02098cce866deada73bd5c42ec4e3361811` passou Linux/Windows Node 22/26.13.1 (CI #43231720295) e Chromium visual ( #43231720515).
- [ ] Executar live E2E read-only contra uma instância VST real; verificar o contrato de rota, autenticação, campos e semântica do timestamp.
- [ ] Validar o host Windows completo assinado, trusted-publisher acceptance e recuperação no perfil real.
- [ ] Validar o fluxo no PC físico; os testes fake e runners GitHub não substituem esta etapa.

### Restantes gates globais

- [x] Implementar rotação CNG gerida pelo host com consentimento, validação histórica por key ID e retenção segura de chaves antigas (PR #79; pós-merge CI e visual verdes em `4d9181f...`).
- [ ] Especificar e implementar âncora monotónica externa ao SQLite para detetar rollback/truncagem para prefixos antigos válidos; ver `docs/security/ANTI_ROLLBACK_PROTOCOL.md`.
- [ ] Testar power-loss/filesystem durability e backup/restore em hardware físico.
- [ ] Implementar keystores/hosts nativos equivalentes para Linux, macOS e Android.
- [ ] Construir instaladores nativos assinados, atualização/rollback e desinstalação com retenção de dados explícita.
- [ ] Completar live E2E DGM-MAT e VST, licenciamento/ativação de produção e isolamento multi-organização.
- [ ] Integrar onboarding, UX adaptativa, acessibilidade, observabilidade e recuperação no host instalado.


### Windows host singleton lock — stale-recovery gate (PR #85)

- [x] Add owner PID plus random ownership token and prevent an old release closure from deleting a replacement lock.
- [x] Serialize stale-lock reclamation through an exclusive sibling recovery file and revalidate the owner under that gate.
- [x] Fail closed when an existing recovery gate makes ownership ambiguous; add regression tests for stale recovery and gate contention.
- [ ] Validate the final PR HEAD in Linux/Windows Node 22/26.13.1, native CNG, portable bundle E2E and Chromium visual regression.
- [ ] Validate interrupted recovery and operator recovery on a physical Windows installation.
- [ ] Continue to treat the host lock as a boundary for supported Office Kit processes only, not arbitrary SQLite writers.

## 2026-11-13 — checkpoint transaction and Windows host lock

- [x] Integrate Windows host singleton lock with ownership token and serialized stale-owner reclamation. PR #85 squash merge: `988c78f7e876f862356f657285b5938bad1ceabb`; CI #559 and visual #479 passed on final PR HEAD `8700f3e27862387eaf0d4bb96989136d82cd9cfa`.
- [x] Add the SQLite prepared-payload boundary that commits an incident snapshot, append-only event, HMAC row, event-chain head and monotonic checkpoint metadata in one finalization transaction. PR #86 squash merge `edb7bd3c79051078141d54424bfcaccf249156c5`; final PR HEAD `8a98567d53e8f65ce351745047c46da18b691c11`; CI #571 and visual #491 passed on that HEAD.
- [x] Add failure-path tests for anchor-success recovery, predecessor-anchor discard, rollback of event/checkpoint rows when finalization fails, mismatched event hash, missing payload and tampered prepare payload.
- [x] Pass full Linux/Windows Node 22 and Node 26.13.1 CI, Windows native CNG and portable bundle E2E, and Chromium visual regression on the exact final PR #86 HEAD. PR #86 squash merge: `edb7bd3c79051078141d54424bfcaccf249156c5`; CI #571 and visual #491 passed on final HEAD `8a98567d53e8f65ce351745047c46da18b691c11`.
- [ ] Implement and validate a real TPM 2.0 monotonic anchor with consented provisioning and atomic compare-and-advance; current anchor tests are fakes only.
- [x] Integrate the Windows host mutation facade through PR #90; all public incident mutations route through the coordinator and the default provider fails closed. Final PR HEAD `f8771a29b9873e0e61b3701dd5931787abd52e4c` passed CI `43599933818` and visual `43599933838`; post-merge main CI `43600154571` and visual `43600154514` passed.
- [x] Add process-kill fault injection after durable prepare/before anchor advance and after anchor advance/before SQLite finalization; PR #91 squash merge `419b45d4294509f1147b2d17375147cd15d1c0c9`, final PR HEAD `16256d4d6c01b0f652dd9694405a2d2cac23e944`, CI `43601453827` and visual `43601453873` passed on that HEAD; post-merge CI `43601790771` and visual `43601790788` passed on main.
- [ ] Validate power-loss, backup/restore and TPM clear/reprovision on physical Windows hardware.
- [ ] Provide equivalent platform-specific anchor/keystore providers for Linux, macOS and Android before enabling the feature on those hosts.

PR #86 is generic storage/core work. It does not change the Universal, DGM-MAT or VST edition allowlists or credentials. It is not production anti-rollback until the remaining provider, host-integration and physical validation gates are closed.

## 2026-11-13 — anchored incident writer core

- [x] Add a generic `MonotonicIncidentWriter` API for incident append and update through the checkpoint coordinator.
- [x] Bind prepared updates to the exact predecessor revision and snapshot digest; reject stale updates.
- [x] Require recognized append/update payloads and one-step sequence advancement in the SQLite journal.
- [x] Add tests for append + update, unsupported provider fail-closed behavior and predecessor digest mismatch. PR #89 squash merge `6544cd07b4aa54d4800b51956fd6a65b6e7b6125`; final PR HEAD `b6c35155a68c3640030b255d937c5efe2bc89d51`; CI run `43451943848` and visual run `43451943880` passed on that HEAD.
- [x] Implement the Windows host's single incident mutation facade (PR #90 squash merge `009766a1aac5c237dc0720294c43c6aa18141f84`); final PR HEAD `f8771a29b9873e0e61b3701dd5931787abd52e4c` passed CI `43599933818` and visual `43599933838`; post-merge CI `43600154571` and visual `43600154514` passed on main.
- [ ] Implement a consented Windows TPM 2.0 provider with verifiable compare-and-advance; do not substitute CNG Software KSP or a fake provider.
- [x] Add child-process termination tests at the durable-prepare/pre-anchor and post-anchor/pre-finalize boundaries using real SQLite/WAL; PR #91 merged and pre/post-merge CI plus visual passed on their exact respective SHAs.
- [x] Validate multi-process contention at the supported monotonic writer boundary: PR #93 final test HEAD `782b587b4e26898400b44473dd53b64423416066`, CI run `43603350677` and Chromium visual run `43603350684` passed. The test proves the real host singleton lock blocks a second process while the first commits through the writer; its anchor is an in-memory fake. [ ] Power-loss, backup/restore and TPM clear/reprovision validation on physical Windows hardware remains open.
- [ ] Implement equivalent platform providers for Linux, macOS and Android before enabling protected mode there.


## 2026-11-14 — Windows host incident write boundary

- [x] Add a restricted public incident-store facade, merged in PR #90; route host `append()` and `update()` through `MonotonicIncidentWriter`.
- [x] Route Office Health diagnostics through the same facade and remove the raw checkpoint journal/store mutation surface from the returned host object.
- [x] Default to an unsupported anchor provider and fail closed; no unanchored fallback when the TPM provider is absent.
- [x] Validate protected checkpoint sequence/hash against the keyed event chain during startup recovery.
- [x] Complete CI, native Windows CNG tests and Chromium visual regression on the final PR #90 HEAD; revalidate post-merge main CI and visual regression.
- [ ] Implement a trusted Windows TPM 2.0 provider with consented provisioning, durable identity, clear/reprovision detection and atomic compare-and-advance.
- [ ] Run physical power-loss, backup/restore and TPM 2.0 validation. Process-kill tests use a test-only fake provider and do not satisfy the hardware gate.


## 2026-11-14 — DGM-MAT local session hardening

- [x] Validate clock values before local token reuse/bootstrap and before caching session expiry; fail closed on invalid clock state, including when `getState()` is called without a cached token.
- [x] Add invalid-clock and mid-exchange clock-change regressions. Code checkpoint `738cb1a128da855ef875d6a6f741006d98af9bdc` passed CI #602 (`43604106904`) across Linux/Windows Node 22 and Node 26.13.1; visual #522 (`43604106850`) passed on the same SHA.
- [x] Revalidate final documentation-synchronized PR #94 HEAD `9cea25e098bcd5c1467b05abc21c93921f23d1bc`: CI #604 (`43604372228`) passed across Linux/Windows Node 22 and Node 26.13.1; Chromium visual #524 (`43604372222`) passed on the same SHA.
- [ ] Live DGM-MAT instance E2E, reconnect/restart and physical-PC validation remain open.


## 2026-11-15 — authenticated-only incident journal and production gates

- [x] Permit incident append/update on a fresh, never-protected Windows installation only when the monotonic provider explicitly reports `unsupported`, no prepare is pending, local generation is zero, and the SHA-256 + CNG-keystore HMAC chain verifies.
- [x] Persist a CNG-vault enrollment marker after a protected anchor is observed; reject silent downgrade and enter `recovery_required` if that anchor later disappears.
- [x] Validate the PR #95 final HEAD `514736e844a51da0d3b3e74f0485e6b535d14eb1`: CI `43710997821` and Chromium visual `43710997810` passed on the same SHA; squash merge `68be0150c8f5ecd5a59f28a99426110c0c9fed08`.
- [ ] Implement a native, consented Windows TPM 2.0 provider. CNG Software KSP, local files and fake anchors are not monotonic hardware anchors.
- [ ] Validate TPM clear/reprovision, ambiguous increment outcomes, old-backup restore, prefix truncation and power-loss on physical Windows hardware.
- [ ] Implement equivalent native keystore/anchor providers for Linux, macOS and Android; keep protected writes disabled until each provider is independently validated.
- [ ] Run live read-only E2E against actual DGM-MAT and VST instances, including reconnect, disconnect, host restart and credential recovery.
- [ ] Deliver native desktop/mobile hosts and installable packages with signed publisher, upgrade/rollback/uninstall, durable licensing and backup/restore.
- [ ] Validate each edition independently: Universal must remain backend-neutral; DGM-MAT and VST adapters/credentials remain in their own edition packages.

**Evidence boundary:** PR #95's authenticated-only regression uses real SQLite/WAL with a test fake secret vault and an explicitly unsupported anchor. It is not TPM evidence. The workflow's separate Windows CNG integration steps passed, but no physical TPM, physical-PC installation, live personal backend or commercial installer was validated by this PR. `authenticated_only` provides HMAC tamper evidence while the original key is available; it does not provide rollback/truncation protection.


## 2026-11-16 — read-only Windows TPM metadata discovery

- The main branch resolves to commit `764b8328c42559677bb7b61ca1d4137ca586cc20`, whose tree contains the read-only `tpm-info` helper command and the native TBS integration test introduced by the changeset associated with PR #98.
- PR #98 head was `9589c813b44a6e2baf00b05a118aef262e66965e`. Office Kit CI run `43750126744` and Chromium visual run `43750126757` both completed successfully on that exact PR head.
- The CI matrix passed Linux and Windows on Node 22 and Node 26.13.1. The native test `native TBS TPM metadata probe never provisions an anchor or promotes journal protection` passed in both Windows jobs after the CNG helper was published. The earlier generic test invocation skips this helper-dependent test; the dedicated native integration step executes it.
- The implementation calls `Tbsi_GetDeviceInfo`, accepts only the documented current four-`UINT32` output layout and schema version 1, and distinguishes TPM 1.2, TPM 2.0, no compatible TPM, unsupported schema/version and API unavailability.
- This is metadata discovery only. It creates no TBS context, submits no TPM command, provisions no NV index, exposes no monotonic anchor, and cannot promote the journal to `protected`. A reported TPM 2.0 version does not prove physical TPM provenance, NV command permissions, a usable counter, atomic compare-and-advance, rollback resistance or successful hardware provisioning.
- Microsoft documents `Tbsi_GetDeviceInfo` as a version query with a buffer large enough for four 32-bit values and identifies `0x8028400F` as `TBS_E_TPM_NOT_FOUND`. The implementation ignores output fields on every non-success result. See the Microsoft API reference: https://learn.microsoft.com/en-us/windows/win32/api/tbs/nf-tbs-tbsi_getdeviceinfo and structure reference: https://learn.microsoft.com/en-us/windows/win32/api/tbs/ns-tbs-tpm_device_info.
- PR #98 lifecycle: closed without merge on 2026-11-16 after its changeset was found in `main` at `764b8328c42559677bb7b61ca1d4137ca586cc20` and the PR API reported `mergeable=false`. Its `merged_at` remains null. The code is present in `main`; do not describe PR #98 itself as merged.
- PR #99 documentation-only synchronization was squash-merged as `c98e03e315f6ed186fb69c610a81cbb1cf714876` from final HEAD `264b2892f3f6a9669be94baf388ab7c8da9f2460`; CI `43883635614` and visual `43883635450` passed on that same HEAD.
- The next security gate remains a separate, consented TPM 2.0 anchor provider with a documented command path, persistent NV identity, safe handling of clear/reprovision and ambiguous increment outcomes, and atomic compare-and-advance. Keep protected writes disabled until real hardware and physical-machine validation pass.


## 2026-11-16 — protected journal backup rollback and prefix truncation tests (PR #100)

- Added two Windows-host startup regressions: restoring a previously valid sequence-1 SQLite backup after the protected anchor advances to sequence 2 must fail with `monotonic_anchor_mismatch`; truncating a locally self-consistent event/MAC/snapshot prefix while leaving the protected checkpoint at sequence 2 must fail with `windows_host_incident_checkpoint_store_mismatch`.
- The SQLite database and WAL are real. The monotonic anchor and Windows host factories are test-only fakes. These tests exercise host recovery decisions; they do not prove TPM behavior, physical power-loss durability or hardware-backed rollback resistance.
 - Initial final-HEAD validation completed on `f5dd92a71a148b5cc10a0c296f52072c4e075c71`: CI run `43886278807` and Chromium visual regression run `43886278917` both passed on that exact SHA on 2026-11-16. The follow-up documentation-only commit must be revalidated independently; these earlier results are not treated as checks for a later SHA.
## 2026-11-17 — TPM discovery milestone and next gate

- [x] Add a read-only Windows TBS `TPM2_GetCapability(TPM_CAP_COMMANDS)` probe after TPM 2.0 metadata detection (PR #102, merged as `5319c132386a6d619cafa13e0bf2669103623ce8`).
- [x] Validate PR #102 final HEAD `707ad1c2f07347f3379df1293b9e82cc1b93642d` with CI `44041193372` and visual regression `44041192318` on the same SHA.
- [x] Harden the response parser against session-tag/layout confusion, invalid `moreData`, inconsistent lengths and duplicate command codes; add a deterministic protocol test independent of physical TPM availability (PR #103, merged as `51d5db49309e02f2e42594194ab778651e26d2ae`; CI `44095809628` and visual `44095809554` passed on final PR HEAD `dd6e74faf7d66b3f6459a397f3357b2bf759e5eb`).
- [ ] Design a consented NV provisioning protocol that binds installation identity and checkpoint digest, and handles TBS command blocking, authorization, TPM clear and ambiguous increment outcomes.
- [ ] Implement and validate a real compare-and-advance provider on physical Windows TPM 2.0 hardware. Do not promote `authenticated_only` to `protected` before this gate passes.
- [ ] Keep Linux, macOS and Android protected mode disabled until each platform has its own durable monotonic provider and physical validation.

A passing native-helper CI job is not evidence that a TPM was present, that TBS permitted NV mutation, or that hardware-backed rollback resistance exists.

- [ ] Deliver edition-specific Windows desktop bundles/installers for Universal, DGM-MAT and VST, followed by native Linux/macOS/Android hosts and packages; verify artifact allowlists and installation isolation (tracked in [issue #104](https://github.com/AndreVazao/office-kit/issues/104)).

- [x] Revalidate PR #103 merge commit `51d5db49309e02f2e42594194ab778651e26d2ae`: post-merge CI `44096288229` and visual `44096287944` passed on the exact main SHA.


### Windows edition host entrypoints — 2026-11-17

- [x] Integrate isolated DGM-MAT/VST Windows CLI entrypoints with explicit connect/disconnect and no credential transport through argv or logs (PR #106; final PR HEAD `14c9e8d9e3863042fa1eba51db7133433df359ba`; CI #44102217430 and visual #44102217301 passed on that SHA).
- [ ] Extend the Windows portable bundle builder to three independent allowlists and run artifact-content plus per-edition install/start/health/uninstall smoke tests.
- [ ] Deliver signed MSI/MSIX installers with upgrade, rollback, recovery and uninstall validation. Source-package CLI entrypoints do not satisfy this gate.


### 2026-11-17 — Windows edition bundle increment (pending validation)

- [ ] Validate the DGM-MAT and VST portable Windows bundle builder derived from the exact source-package allowlists.
- [ ] Validate artifact-content exclusion, trusted CI-only helper signing, shipped launcher startup, disconnected JSON-lines control and edition-scoped data roots on Windows Node 22 and Node 26.
- [ ] Keep Universal's existing launcher/data root unchanged.
- [ ] After this portable-bundle gate, implement MSI/MSIX installation, upgrade, rollback/recovery, complete uninstall and production publisher signing. Portable bundles do not satisfy the installer gate.
- [ ] Continue Linux/macOS/Android native hosts and platform-native keystores separately.


## 2026-11-21 — Exact-head validation checkpoint

- [x] Validate the Universal, DGM-MAT and VST portable Windows bundles at final PR #107 HEAD `75fd8d027d69d49fc11c0b20f7e1d58d5eece0e4` (CI run [44911614409](https://github.com/AndreVazao/office-kit/actions/runs/44911614409)); squash merge `b27136a974d25bb1f3572a5bdb8700f359ac2627`.
- [x] Validate browser visual regression at the same final PR HEAD (run [44911614342](https://github.com/AndreVazao/office-kit/actions/runs/44911614342)).
- [ ] Implement issue #110: authenticated installer-provisioned publisher policy, SPKI pinning, exact WinTrust signature-index/signer binding, strict revocation behavior and bounded verification. Current document is design-only.
- [ ] Implement issue #110 and validate the production publisher policy on native Windows before commercial distribution. PR #107 is already merged as a portable-bundle increment; this security gate now blocks signed commercial release, not that merge.
- [ ] Deliver MSI/MSIX install, upgrade, rollback/recovery, uninstall and signed publisher distribution for each Windows edition.
- [ ] Deliver native Linux/macOS/Android hosts and platform-native keystore/install lifecycle.
- [ ] Complete real DGM-MAT/VST read-only live E2E and physical-PC lifecycle validation.
- [ ] Complete production licensing/activation, TPM-backed rollback protection and cross-platform backup/recovery gates tracked by issues #109 and #58.


## 2026-11-21 — Authenticode interim decision

- [x] Revert PR #107's WinVerifyTrust rewrite to the previously reviewed, bounded Get-AuthenticodeSignature baseline (commit f26f4b365a9ae48cca67bd1c2504ab4404d3846f). This removes the PR-introduced revocation-disabled path; it does not complete production publisher provisioning.
- [ ] Replace the legacy process-environment SHA-1 thumbprint with an authenticated installer-provisioned publisher policy and SHA-256 SPKI pin.
- [ ] Implement explicit install/update and offline-startup revocation policies, exact signature/signer binding, and native Windows positive/negative tests before commercial release.


## 2026-11-21 — SQLite finalization crash boundary

- [x] Add a real child-process termination test inside the SQLite finalization transaction (PR #111; final PR HEAD `362ac780cb7f9c31b7111ac6b7384a2179357abb`; squash merge `b8cff02dd9f74886df6c39895213cc03e31a4bbf`).
- [x] Validate CI [44912644014](https://github.com/AndreVazao/office-kit/actions/runs/44912644014) and visual regression [44912644019](https://github.com/AndreVazao/office-kit/actions/runs/44912644019) on the exact PR HEAD; post-merge CI [44913217716](https://github.com/AndreVazao/office-kit/actions/runs/44913217716) and visual [44913217681](https://github.com/AndreVazao/office-kit/actions/runs/44913217681) passed on the merge commit.
- [ ] Implement and validate a real Windows TPM 2.0 monotonic provider; keep writes fail-closed until provider and physical TPM validation pass.
- [ ] Validate power-loss, TPM clear/reprovision, backup/restore and recovery on physical Windows hardware; fake-anchor process-kill tests do not satisfy these gates.


## 2026-11-21 — lifecycle installation identity integrity

- [x] Bind SQLite lifecycle records to the installation ID used as their partition on both save and load (PR #113; final PR HEAD `6c2295d569ed8b64170dcd3dcb641987b0399445`; squash merge `e4800a76747f84b35e0f14fa4babf071c2d30de2`).
- [x] Validate Linux/Windows Node 22/26 and visual regression on the exact PR HEAD; post-merge main CI and visual regression passed on `e4800a76747f84b35e0f14fa4babf071c2d30de2`.
- [ ] Implement a concrete least-privilege Windows installation/package driver and MSI/MSIX lifecycle; injected-driver controller tests do not prove Windows Installer or SCM behavior.
- [ ] Validate clean install, upgrade, rollback, recovery, uninstall/data retention and reinstall on disposable Windows runners and physical PCs.


## 2026-11-21 — licensing seat-enforcement increment

- [x] Add real SQLite/WAL multi-process coverage for concurrent activation of a one-seat entitlement; exactly one of two independent Node processes can activate on the same local database. PR #115 final HEAD `0b4bbcf12716ef856f1c66e89ebdd9a07de5f590`; CI run [44916584036](https://github.com/AndreVazao/office-kit/actions/runs/44916584036) and visual run [44916584062](https://github.com/AndreVazao/office-kit/actions/runs/44916584062) passed on that SHA.
- [ ] Integrate the registry/store into native Universal, DGM-MAT and VST host compositions without sharing edition-specific entitlements or credentials.
- [ ] Add a production trusted issuer keyring, authenticated key rotation and signed-license verification; the current concurrency test uses a test-only verifier.
- [ ] Add platform identity, activation/deactivation UX, backup/recovery and security review.
- [ ] Do not claim multi-PC/offline seat enforcement: separate disconnected installations still require a central/private registry or explicit online activation policy.

## 2026-11-22 — Authenticode fail-closed hardening

- [x] Remove the implicit `OFFICE_KIT_CNG_SIGNER_THUMBPRINT` environment fallback from the production Windows host verifier.
- [x] Remove the environment-variable prerequisite from DGM-MAT/VST portable launchers; missing authenticated publisher policy blocks host startup before SQLite opens.
- [ ] Provision and authenticate publisher policy through the elevated installer; use SHA-256 SPKI identity and protected machine-scope configuration.
- [ ] Bind the publisher identity to the exact Authenticode signature accepted by the verifier.
- [ ] Implement explicit install/update and offline-startup revocation policies with bounded non-interactive verification.
- [ ] Add native Windows tests for trusted positive chain, untrusted/wrong/expired/revoked/unknown signers, tampering, multi-signature selection and policy ACL/integrity failures.
- [ ] Keep issue #110 open and block production distribution until all remaining gates pass.


## VST cockpit safety and transport gates — 2026-11-23
- [x] Integrate authenticated read-only cockpit snapshot (PR #118), restricted assistant bridge (PR #119), backend-sourced research tasks/evidence (PR #120) and local adapter diagnostics/recovery (PR #122).
- [x] Separate public `GET /health` from private authenticated routes (PR #132, merge `2dcfcb6d892ebdcf454855d736a3dc086df31869`; CI [45207975655](https://github.com/AndreVazao/office-kit/actions/runs/45207975655), visual [45207975761](https://github.com/AndreVazao/office-kit/actions/runs/45207975761) passed on final PR HEAD). Public health sends no token and cannot reject private session authentication. Issue #129 closed.
- [ ] Keep PAPER controls disabled until the backend atomically enforces PAPER mode for every control operation (issue #121).
- [ ] Keep remote transport disabled until the exact Tailscale Serve HTTPS, paired-device identity, scope/revocation, redirect/DNS and unknown-POST-outcome requirements in issue #124 pass.
- [ ] Complete live VST E2E and physical Windows/Android tailnet validation.
- [x] Resolve all four Windows CNG nullable `AlgorithmGroup` dereferences without suppressing nullable analysis (PR #133, merge `d97522e5f3797ee232e5fde74185805eb5a13aea`; CI [45211264089](https://github.com/AndreVazao/office-kit/actions/runs/45211264089), visual [45211264197](https://github.com/AndreVazao/office-kit/actions/runs/45211264197) passed on final PR HEAD). Issue #130 closed.

## 2026-11-23 — verified integration checkpoint

- [x] Integrate PR #132: VST public health is separated from private session authentication; exact PR HEAD CI and visual checks passed; issue #129 closed.
- [x] Integrate PR #133: null-safe CNG algorithm-group validation and focused tests; exact PR HEAD Linux/Windows Node 22/26 CI and visual checks passed; both Windows native builds and protocol tests passed; issue #130 closed.
- [ ] Implement issue #110 production Authenticode policy. Current Windows host remains deliberately fail-closed without an authenticated installer-provisioned publisher policy. No commercial distribution until SPKI pinning, signature-index binding, revocation behavior and native trust tests pass.
- [ ] Complete #104 native installers/lifecycle, #109 host-integrated production licensing, #58 TPM-backed anti-rollback and physical recovery, #57 live DGM-MAT, #121 backend PAPER enforcement and #124 private VST transport.
- [ ] Validate physical Windows installation and live VST/DGM-MAT read-only sessions. GitHub-hosted CI does not replace these tests.


## 2026-11-24 — Windows publisher-policy production gates

- [x] Add native WinTrust primary-signature verification, signer extraction from the same provider state, SHA-256 SPKI comparison and separate online-install/cache-only-runtime revocation modes in PR #139. Exact audited pre-documentation HEAD `bb457884444d14eae7e8d51cd162338c84291c56` passed CI [45403375515](https://github.com/AndreVazao/office-kit/actions/runs/45403375515) and visual regression [45403375437](https://github.com/AndreVazao/office-kit/actions/runs/45403375437); a subsequent documentation commit requires new checks.
- [ ] Resolve issue #140: obtain the Windows system directory from a trusted OS/installer boundary rather than trusting inherited `SystemRoot`/`WINDIR`; add native decoy executable tests for `powershell.exe`, `whoami.exe` and `icacls.exe`; preserve fail-closed behavior when the trusted root cannot be established.
- [ ] Resolve issue #141: anchor the highest accepted publisher-policy version and canonical envelope hash outside the user-writable profile; implement atomic or two-phase crash recovery; reject old-version replay, same-version/different-hash replacement and missing/cleared anchors.
- [ ] Complete native Windows trust matrix for expired, revoked, unknown/unavailable-revocation, untrusted, tampered and multiple-signature files, plus altered/missing/ACL-insecure policy and bounded child termination.
- [ ] Implement issue #104 installer/update verification and atomic CNG-key/policy provisioning with restrictive ACLs and recovery. The online verifier is not yet called by a production installer/update path.
- [ ] Validate the actual commercially signed package and complete install/update/startup/uninstall flow on a physical Windows PC. GitHub-hosted runner success is not physical acceptance.
- [ ] Keep PR #139 Draft and issue #110 open until all of the above release gates are satisfied.


## 2026-11-25 — Windows package trust decision gate

- [ ] Prototype MSIX deployment and verify OS-enforced package signature/publisher identity on every supported Windows baseline; first confirm whether the required host/session/service lifecycle fits MSIX restrictions (no drivers or per-user services; session-0 per-machine services only under supported system accounts).
- [ ] Prototype a fully verified MSI alternative only if all package payloads, cabinets, patches and custom actions are covered by the documented Windows Installer signature model; no external unsigned bootstrap scripts.
- [ ] Select a format only after install, upgrade, rollback, repair, uninstall, retained-data and per-edition isolation tests pass for Universal, DGM-MAT and VST.
- [ ] Establish a trusted native installer/launcher boundary before any host process can rely on inherited SystemRoot/WINDIR or launch the CNG helper.
- [ ] Implement protected monotonic publisher-policy version/hash state with crash recovery; do not claim TPM protection until a real NV provider is physically validated.
- [ ] Keep PR #139 Draft and Windows host startup fail-closed until issues #110, #140, #141 and the relevant #104 installer gates are satisfied.

References: [MSIX signing](https://learn.microsoft.com/windows/msix/package/signing-package-overview), [MSIX desktop limitations](https://learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-prepare), [fully verified MSI](https://learn.microsoft.com/en-us/windows/win32/msi/authoring-a-fully-verified-signed-installation), [MSI external cabinet signature scope](https://learn.microsoft.com/en-us/windows/win32/msi/digital-signatures-and-external-cabinet-files).


## 2026-11-25 — verified CI checkpoint and remaining installer gate

- [x] Main push CI [45221372710](https://github.com/AndreVazao/office-kit/actions/runs/45221372710) and visual [45221372578](https://github.com/AndreVazao/office-kit/actions/runs/45221372578) passed on main `027851c04ff1b23d239b90a06bfc4ef84aecf425`.
- [x] PR #139 checkpoint `c64e45522b71cc5cc6bbcaa3d8dc4e270afa7899`: CI [45624054630](https://github.com/AndreVazao/office-kit/actions/runs/45624054630) passed all four Linux/Windows Node 22/26.13.1 jobs; visual [45624032952](https://github.com/AndreVazao/office-kit/actions/runs/45624032952) passed on the same SHA.
- [x] PR #108 checkpoint `0bae4e7b7095863efe04d5b76f480cdcf69603d2`: CI [45564991138](https://github.com/AndreVazao/office-kit/actions/runs/45564991138) and visual [45564991305](https://github.com/AndreVazao/office-kit/actions/runs/45564991305) passed on the same SHA.
- [ ] Reconcile PR #108's 24-commit divergence from current main and rerun its checks after rebase; keep Avatar Studio browser/GLB acceptance separate.
- [ ] Complete #104/#110/#140/#141 trust-root, package provisioning, policy anti-replay and physical installation gates. A new documentation commit changes PR #139's head; require fresh checks for that new SHA.


## Repository governance gate — 2026-11-26

- [ ] Configure and verify a protected `main` branch/ruleset requiring PRs and current-head CI plus visual regression; block direct/force pushes and branch deletion. Tracked in issue #142. This is an administrator-level repository setting and has not been changed by automation.
