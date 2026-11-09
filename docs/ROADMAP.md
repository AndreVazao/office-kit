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
- Preservar as mesmas atividades sociais em todos os níveis; reduzir apenas fidelidade/custo de renderização em hardware fraco e provar que a simulação nunca envia comandos.

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
- [ ] Ligar o host à sessão local DGM-MAT através de keystore persistente e bootstrap protegido.
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
- Still missing: concrete Windows CNG/DPAPI/credential-vault bridge to retrieve the protected DGM-MAT bootstrap credential, process-host wiring, and live PC E2E. Do not claim DGM-MAT connection is operational.


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
- [x] Testar create/prove/recriação do manager/replay/revoke com CNG + SQLite no runner Windows (PR #46).\n- [ ] Testar rotação, falhas de cleanup, restart do processo host/sistema e capacidades no desktop/PC físico.
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

## Next implementation order after the portable Windows bundle gate
1. Complete and merge the portable Windows host bundle only after Linux, Windows E2E and visual regression pass on the same HEAD.
2. Implement the installable Windows host lifecycle (install/start/health/stop/restart/uninstall/upgrade/rollback/data retention) without touching existing DGM-MAT or VST installations.
3. Implement hardware capability discovery and dynamic resource budgets, separating renderer cost from backend resources.
4. Implement Office Health & Recovery incident contracts, safe diagnostic probes, redaction and bounded recovery.
5. Implement social simulation independent of backend and renderer FPS, then renderer-tier equivalence.
6. Implement and validate the four physical scenarios: Universal offline, DGM-MAT read-only, VST read-only and standalone offline.
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

**Limite de evidência:** os módulos e testes desta PR são um primeiro incremento de core. Não representam integração com drivers reais, persistência de incidentes em produção, instalador, renderer integrado, nem testes em PC físico. A edição Universal continua independente; os adaptadores DGM-MAT e VST não são alterados por este incremento.
### Diagnóstico persistente e Windows bundle — incremento em PR #55
- [x] Implementar armazenamento SQLite de incidentes isolado por instalação.
- [x] Ligar store ao Windows host e permitir criar motor de diagnóstico com probes/actions injetados.
- [x] Testar persistência do incidente após reinício do host.
- [ ] Implementar probes reais por camada e identificação da origem com confiança/evidência.
- [ ] Integrar recuperação local autorizada, snapshot de verificação e exportação de suporte com consentimento.
- [ ] Confirmar Windows portable E2E após substituir trust-store PowerShell por certutil com logs.
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
