# Implementation status

This page records implemented work separately from planned or independently verified behavior.

## Implemented in the current vertical slice
- Dependency-free JavaScript core for configuration validation and defensive normalization.
- Separation between local social simulation and backend-confirmed operational state.
- Missing/stale heartbeat handling that marks operational state unverified.
- Diagnostics routing for lost communication without inventing a diagnosis.
- Generic JSON preset with configurable departments and agents.
- Responsive browser preview with department selection, zoom control, selected-department focus zoom and overview reset, social idle animation, pause control, portrait/landscape responsive CSS, and a selectable per-agent local conversation panel with an explicit no-backend disclaimer. A mobile legibility pass now adds a readable selected-department detail card (description, floor and agent names) without forcing the whole-building overview to zoom in; landscape-small-height controls and spacing are compacted.
- Preview loads the generic JSON configuration instead of maintaining a separate hard-coded scene.
- Renderer-neutral scene engine with deterministic floor ordering, logical agent positions, viewport validation, fit scaling and zoom.
- Preview now imports the scene engine and applies its calculated fit scale on initial render, zoom changes and viewport resize via ResizeObserver/resize events.
- Preview geometry dimensions are aligned with the scene engine's logical roof/floor/foundation dimensions.
- Corrected scene anchoring: the scaled building is positioned at the viewport center and clipped within the viewport, preventing the unscaled 1200px layout box from shifting the visible building off-screen on narrow displays.
- Added source-level regression tests for centered scaling, overflow clipping, resize observer, and portrait/landscape responsive rules.
- Angular-diorama geometry now feeds a lightweight SVG shell in the browser preview: roof, right side, per-floor side bands and front-cutaway face are generated from renderer-neutral polygons. Screenshot artifacts from visual regression runs #61/#62 confirm the shell is rendered in portrait, landscape and desktop captures after fixing viewport initialization. The selected-department focus now applies a stronger 2.1x zoom and shares the same vertical camera offset between the SVG shell and interactive room layer. The selected-department detail card reports description, floor and agent names; the browser regression now explicitly checks that the card appears on selection and clears on overview reset. This remains an initial perspective layer, not a finished isometric renderer; phone overview labels remain small and need a better focused-room/readability pass. Geometry unit tests cover determinism, floor coverage, optional front cutaway and invalid dimensions.
- Renderer-neutral graphics quality profile contract: economy, balanced, detailed, cinematic and automatic profile resolution from conservative device hints.
- Browser preview now exposes a quality selector (automatic/economy/balanced/detailed/cinematic) and applies lightweight CSS-level animation/effect differences; automatic mode uses available device hints and updates on resize.
- Documented roadmap and safe future backend-discovery requirement.
- Core, scene-engine layout, and graphics profile tests using Node's built-in test runner.
- GitHub Actions CI workflow.

## Not implemented yet
- Production renderer or a 3D/pixel-art asset pipeline; the preview uses CSS-built placeholder characters. The SVG shell is an initial lightweight perspective treatment; it does not yet render room interiors as perspective polygons or provide true 3D assets.
- Full whole-building angular top-perspective/front-cutaway renderer and real per-avatar command delivery (including a configurable CEO avatar representing the user) are not complete; the preview now has an initial SVG shell only. The CSS preview now has a local-only per-avatar conversation demonstration, department focus zoom and overview reset. Visual regression run #42 confirms the chat panel is captured open, including the submitted test message; this remains a local-only demo, not production renderer or backend integration.
- Applying quality profiles to a real rendering pipeline; current profiles are policy data, not active GPU/texture controls.
- Runtime performance measurement and automatic quality adjustment based on measured frame time.
- Full renderer/GPU integration for graphics quality profiles; the current selector changes preview CSS effects only, not texture resolution, DPR, GPU workload or actual FPS target.
- Real backend transport/adapters or authentication; therefore real orders/messages cannot yet be delivered or confirmed.
- Backend discovery/search assistant; requirements only are documented in docs/BACKEND_DISCOVERY.md.
- Visual editor and import/export UI.
- Production infirmary scene; only state-routing policy exists in the core.
- Native Android/desktop packaging.
- Physical-device orientation tests remain pending. Visual regression run #42 (ID 41308561426) passed on Chromium and produced screenshot artifact ID 13084118255 for 390×844 portrait, 844×390 landscape and 1366×768 desktop, including open-chat captures. Manual inspection of `visual-portrait-390x844-chat.png` confirms the panel remains open and shows the test message and explicit local-only disclaimer. The building remains too small for comfortable reading at portrait overview scale; the desktop placeholder is still a flat CSS building, not the required angular cutaway.
- Benchmarks on physical phones, tablets, and desktop hardware.

## Verification
GitHub Actions run #122, ID 41308561429, completed successfully for the core checks. Visual regression run #42, ID 41308561426, completed successfully on commit 5467eb4822f7f31436645d1355073e0233bbe3a9 and produced artifact 13084118255; the portrait chat screenshot was manually inspected and confirms the corrected capture timing. After the corrected-import commit, CI run #134 passed and visual run #54 passed. The SVG shell integration is in commits 287901f and 2e622cd. Visual regression runs #61 and #62 (commit 86e0f6356d97de413ba1188c75e377b3a4b8b4f2) completed successfully and produced artifact 13086102640; manual inspection confirms the SVG shell renders in portrait, landscape and desktop. The renderer focus-offset alignment improvement is in commit cc293c1737e34224f49438bfd13b4b20ca0729fa. PR #2 merged after CI and visual regression both passed on latest commit 436e79e5fa5044811e8065e66fa2ec6a73ea1c0f. The follow-up branch adds explicit visual assertions for selected-department details and overview reset; its fresh CI/visual checks are pending. Earlier run #120 and visual run #40 remain historical evidence for the prior state. Earlier historical run records are retained below.
GitHub Actions run #50, ID 41291148536, completed successfully on commit 5a96970246aebc3abcb2d8203a64b8a1c2983afc. Syntax checks, all core/scene-engine/profile tests, and example JSON parsing passed after the preview integration.
GitHub Actions run #62, ID 41291442920, completed successfully for the preview quality-selector changes (commit 55031c9456533a579de459cdc7ead87a92b5edd3). GitHub Actions run #70, ID 41292191794, completed successfully for the centered-layout fix and source-level regression tests on commit f13f8233348134fc741e032ae5d170349d3d28ba. Visual regression run #2, ID 41293249440, succeeded and produced screenshot artifact ID 13077921682; all three viewport screenshots were inspected. This verifies the current preview layout only, not the final angular cutaway design or physical devices. The later focus-zoom/reset test additions still await CI.

## Design rules
- The core is authoritative for configuration and state interpretation; renderers consume its outputs.
- Local social activity must never become a claim that an agent is doing real work.
- Quality profiles may reduce detail and effects, but must not alter operational state, remove essential information, or compromise readable layout.


## Estado de proveniência visual (implementação inicial)
- A pré-visualização marca a atividade de cada personagem como “Simulado” e “não verificado”; o cabeçalho distingue simulação local de backend apenas declarado.
- Esta etiqueta não é um adaptador de backend nem prova de execução. O Office Kit ainda não recebe estados operacionais reais.
- Foi registada a revisão documental inicial do Deskforce em `docs/REFERENCE_DESKFORCE.md`. Não foi copiado código nem asset desse projeto nesta fase.
- Verificação automatizada desta alteração: pendente de CI e regressão visual do PR.


## Contrato neutro de estados — fase em curso
- Implementado em branch `feat/backend-state-contract`: módulo puro `runtime-state.mjs`, versão de schema 1, vocabulários explícitos para agente/tarefa, validação de proveniência estrutural e timestamp, TTL configurável e derivação de `live`, `stale`, `synchronizing`, `disconnected`, `connecting` e `error`.
- Dados de agente/tarefa só são expostos como estados confirmados quando o snapshot está fresco e sincronizado; nos restantes estados, o campo visual passa a `unknown`.
- Testes adicionados para snapshots válidos/inválidos, timestamp expirado/futuro, reconexão e estados desconectado/erro.
- Limitação importante: validação estrutural não autentica a origem. Ainda não há adaptador de backend, ligação real, heartbeat nem comandos.
- CI e regressão visual desta branch: ainda não verificados nesta atualização.


## Ciclo de vida de sessão runtime — incremento em revisão
- Adicionado `packages/scene-engine/src/runtime-session.mjs`: controlador determinístico sem sockets, dependências de rede ou execução de comandos.
- Estados implementados no controlador: `connecting`, `synchronizing`, `live`, `stale`, `disconnected` e `error`. Uma sessão só passa a `live` depois de receber snapshot válido, fresco e sincronizado; heartbeat isolado nunca promove uma sessão por sincronizar.
- Timeout de heartbeat, desconexão, falha de transporte e snapshot inválido retiram a confirmação dos estados operacionais e convertem agentes/tarefas para `unknown`.
- Reconexão exige novo snapshot; não se reutiliza o estado anterior como prova de atividade atual.
- Testes adicionados para arranque, heartbeat expirado, reconexão, snapshot inválido, heartbeat antes da sincronização e falha/desconexão.
- Limite: este é um controlador puro para adaptadores e testes. Não implementa transporte nem heartbeat de rede real e não autentica a origem. CI e regressão visual do PR ainda por executar.


## Simulador genérico de runtime — incremento em revisão
- Adicionado `packages/scene-engine/src/runtime-simulator.mjs`, um simulador determinístico e independente de backend sobre `RuntimeSession`, sem transporte de rede, credenciais, dependências específicas ou execução de comandos.
- Regista eventos sequenciados e emite snapshots neutros v1. IDs duplicados são ignorados; snapshots antigos permanecem sem confirmação; reconexão exige novo snapshot sincronizado.
- Adicionados testes em `packages/scene-engine/test/runtime-simulator.test.mjs` para arranque, sincronização, snapshots duplicados/antigos, heartbeat, reconexão, histórico e dados inválidos.
- O simulador foi incluído nas verificações de sintaxe do pacote.
- CI e regressão visual deste PR e pós-merge ainda têm de passar. Os testes foram escritos, mas não executados localmente neste ambiente.
- Office Kit continua genérico: não existe ligação automática ou fixa a VST, DGM-MAT ou qualquer backend. Descoberta, seleção e instalação de adaptadores são fases futuras.


## Contrato público de adaptadores — incremento em revisão
- Adicionado `adapter-contract.mjs` com API versionada, métodos mínimos, metadados e capacidades conhecidas.
- Modo seguro por omissão: somente leitura. Comandos são capacidade explícita, não fazem parte da interface mínima e exigem autorização externa.
- Adicionado normalizador de envelope de eventos com sequência monotónica, timestamp e rejeição de eventos repetidos, fora de ordem, expirados ou com timestamp futuro.
- Testes adicionados para contrato mínimo, capacidades inválidas, envelope, sequência, validade temporal e timestamps numéricos.
- CI e regressão visual deste PR ainda pendentes; a validação estrutural não autentica adaptadores.


## Gateway de adaptadores — incremento em revisão
- Adicionado `AdapterGateway` para ligar um adaptador explicitamente escolhido à `RuntimeSession`.
- Valida a interface, obtém snapshot inicial antes de considerar estado confirmado e processa envelopes de evento com sequência e idade.
- Falhas de ligação falham em segurança; desligar limpa subscrições. Não existe descoberta automática, autenticação integrada, transporte próprio ou execução de comandos.
- Testes adicionados para adaptador válido/inválido, falha de ligação, duplicados, ordem, expiração, heartbeat e limpeza de subscrição.
- CI e regressão visual ainda pendentes; identidade/autorização continuam responsabilidade do anfitrião.


## Catálogo de adaptadores — implementação em revisão
- Adicionado `AdapterCatalog`: registo explícito em memória, validação do contrato, IDs únicos, listagem/filtro de capacidades, descrição, seleção por ID e remoção.
- A seleção verifica capacidades exigidas e devolve o adaptador registado sem executar `connect()`.
- Não existe descoberta de rede/disco, importação dinâmica, autenticação integrada ou ligação automática.
- Testes cobrem registo válido/inválido, duplicados, filtros, requisitos de capacidade, metadados defensivos e remoção.
- CI e regressão visual do PR ainda não executados nesta atualização.

## Incremento atual — adaptador genérico de demonstração

- Adicionado packages/scene-engine/src/generic-demo-adapter.mjs: adaptador de referência em memória, contrato v1, capacidades exclusivamente de leitura, snapshots sequenciados e eventos determinísticos.
- O host pode registar e selecionar o adaptador através de AdapterCatalog, e ligá-lo explicitamente através de AdapterGateway; selecionar continua sem ligar automaticamente.
- O adaptador permite alterar estados de agentes/tarefas, emitir heartbeat, simular falha de transporte e injetar envelopes para regressões de sequência/origem.
- Adicionado packages/scene-engine/test/generic-demo-adapter.test.mjs cobrindo seleção sem ligação, snapshot inicial, atualização de agentes/tarefas, heartbeat/timeout, eventos duplicados/fora de ordem/origem incorreta, falha, limpeza e reconexão.
- Incluído o novo módulo na verificação de sintaxe do script npm run check.
- Limites: implementação local/determinística; não autentica criptograficamente, não implementa transporte real, não envia comandos e não substitui a autorização do host.
- Estado de validação deste incremento: código e testes adicionados ao branch; CI e regressão visual ainda pendentes no HEAD final do PR. Não há execução local declarada nesta sessão.
- PR #12 foi integrado por squash no commit 93afbe9cc89092f08984380703eaae822147e5fc. A consulta do conector a workflows pós-merge não devolveu runs, porque a função disponível filtra execuções acionadas por pull request; estado de CI da main nesse SHA permanece por confirmar por outra via.



## Avatar Studio — estado e limites

- Requisito aceite: avatares configuráveis com apresentações humana masculina/feminina, robótica masculina/feminina e opções neutras/personalizáveis.
- Requisito aceite: personalização de cabelo, olhos, rosto, tom de pele, proporções, roupa, acessórios, cores e animações, condicionada às capacidades do modelo/renderer.
- Requisito aceite: fotografia de referência opcional; após upload e consentimento, o sistema determina automaticamente a apresentação visual e guarda o avatar gerado, sem pedir escolha de estilo. O utilizador pode ajustar manualmente o resultado depois.
- Separação obrigatória: Avatar é identidade visual; Agent é identidade/runtime do backend. A associação entre ambos é explícita e pode ser alterada.
- Privacidade obrigatória: consentimento explícito, fornecedor de geração identificado, fotografia original não retida por omissão, opção de eliminação e nenhuma partilha automática com backends de agentes.
- Estado real: ainda não existe Avatar Studio, pipeline de modelos 3D, editor de traços, importação de fotografia nem geração de avatar por fotografia. O preview atual continua a usar personagens CSS de placeholder.
- A geração por fotografia dependerá de escolher e integrar um serviço/pipeline adequado; não se declara qualidade, semelhança ou execução local antes de testes reais.

## Modelo de instalação e privacidade — requisitos aceites

- Office Kit será distribuído como software instalável/licenciável em cópias independentes por utilizador/cliente.
- Cada instalação terá armazenamento e configuração próprios; não existe ligação, partilha ou sincronização entre instalações por omissão.
- As funcionalidades locais devem operar sem conta central, backend externo ou Internet.
- Qualquer backend ou serviço externo será opcional e ligado manualmente pelo proprietário, com autenticação/autorização explícitas.
- Não haverá telemetria nem envio dos dados do escritório ao fornecedor por omissão. Backup, exportação, migração ou sincronização futura serão operações explícitas.
- Estado: requisitos documentados; isolamento de instalações, instaladores comerciais e mecanismos de licenciamento ainda não implementados nem verificados.


## Requisitos aceites — instalação gráfica adaptativa

- Objetivo visual máximo: renderer 3D avançado/realista, com níveis progressivos até chat/2D, diorama/pixel e 2.5D/isométrico.
- O instalador deve avaliar as capacidades reais de cada dispositivo e instalar todos os níveis gráficos compatíveis, não apenas o nível mais alto.
- O modo inicial é escolhido automaticamente entre os níveis validados; o utilizador pode fazer fallback manual para qualquer nível inferior instalado ou regressar ao automático.
- Catálogo de avatares e identidade visual são universais e independentes do renderer. Cada avatar pode ter variantes/LOD para vários modos; a ausência de asset avançado não remove o avatar.
- Estado: requisitos documentados; avaliador, manifestos, pacotes por capacidade, instalação seletiva, fallback runtime e renderers 3D avançados ainda não implementados.

## Requisitos aceites — federação privada multi-computador

- Cada instalação mantém o seu escritório e dados locais, podendo funcionar isoladamente sem Internet ou serviço central.
- O proprietário pode autorizar explicitamente vários nós/computadores da mesma organização privada a comunicar através de LAN/rede privada.
- Cada nó pode representar um departamento ou edifício; uma instalação agregadora pode mostrar uma cidade/organização unificada com vários edifícios e equipas.
- A federação não é pública nem automática: exige identidade de nó, confiança mútua, autenticação, autorização granular e possibilidade de revogação.
- A vista agregada é uma projeção; cada backend local mantém autoridade operacional. Estados remotos perdem confirmação quando a ligação expira. Animações de deslocação/conversa entre edifícios são visuais, salvo confirmação operacional explícita.
- Não há relay/cloud obrigatório, telemetria ou comunicação externa por omissão. Organizações diferentes e instalações não associadas permanecem isoladas.
- Estado: contratos de federação e identidade criptográfica inicial já implementados; keystores persistentes, metadata store durável, onboarding/aprovação de peers, providers de rede, agregador multi-escritório, topologia/cidade e testes de rede continuam por implementar.

## Descoberta automática e conectividade — requisito aceite, não implementado

- Objetivo UX: o utilizador não introduz IPs, portas ou DNS. O Office Kit tenta LAN e redes privadas já configuradas e oferece onboarding guiado para opções adicionais.
- Tailscale é um provider opcional de transporte/descoberta para instalações já autenticadas; MagicDNS pode evitar a necessidade de conhecer IPs. A integração não pode conter OAuth client secrets/auth keys, provisionar dispositivos ou alterar o tailnet sem consentimento e autorização.
- Um rendezvous HTTPS opcional com nome/slug da organização pode registar presença e metadados mínimos. Pode ser alojado na infraestrutura do cliente, incluindo Vercel quando adequado, ou num serviço hospedado explicitamente escolhido pelo cliente.
- Rendezvous não é transporte: tráfego real requer overlay privado, conexão direta/P2P ou relay dedicado autorizado. Vercel não é assumida como VPN nem como relay genérico. WebSockets suportados pela plataforma não removem a necessidade de armazenamento partilhado, reconexão e coordenação distribuída.
- Aprovação explícita de nós, identidade criptográfica, permissões granulares, revogação e isolamento entre organizações são obrigatórios. Descobrir um nó nunca lhe dá acesso automaticamente.
- Modo standalone e operação local continuam disponíveis sem Internet, Tailscale, Vercel ou serviço central.
- Estado real: contratos neutros iniciais implementados em `packages/scene-engine/src/federation-contract.mjs`, com testes em `packages/scene-engine/test/federation-contract.test.mjs`. Incluem validação de identidade pública, fingerprint SHA-256, capabilities, hints de transporte, leases limitadas/expiráveis e envelopes de eventos v1, além de interfaces abstratas para providers. Estes contratos não fazem I/O, não autenticam peers, não criam chaves e não implementam LAN, Tailscale, rendezvous, relay, onboarding ou autorização. CI ainda tem de validar o novo HEAD.


## Identidade criptográfica de nó — estado consolidado
- PR #16 integrado: `NodeIdentityManager` usa Ed25519, fingerprint SHA-256, desafios nonce com audiência/expiração, prova de posse, rotação e revogação.
- PR #17 integrado: `docs/SECURE_STORAGE.md` define os requisitos de providers persistentes para Windows, macOS, Linux, Android e browser; continua a ser especificação, não implementação nativa.
- O ciclo de vida revisionado está em `main`: `NodeKeyStoreProvider.hasKey/getCapabilities`, metadata CAS, rejeição de providers efémeros/exportáveis em produção, limpeza de chaves após falhas, tombstones e reconciliação de pendências.
- PR #33 integrada: `SqliteNodeIdentityMetadataStore` persiste metadados públicos e handles opacos, isolados por `installationId`; não armazena chaves privadas.
- A store SQLite recebe uma conexão do host. O provider `WindowsCngP256KeyStore` e o helper .NET já fornecem chaves ECDSA P-256 persistentes, não exportáveis e isoladas por installation ID no Microsoft Software KSP; `createWindowsNodeIdentityRuntime` compõe esse provider com metadata e replay stores SQLite apenas no entrypoint Windows. O host continua responsável pela conexão/ficheiro SQLite, ACLs, cifragem, backups e ciclo de vida do helper. macOS Keychain, Linux Secret Service/PKCS#11, Android Keystore e browser CryptoKey persistente continuam por implementar.
- `EphemeralEd25519KeyStore` é exclusivo de testes/sessões efémeras e é rejeitado em configuração de produção.
- PR #36 integrada: testes de integração do manager com SQLite real, reabertura da base e reconciliação de limpeza pendente. O provider de chaves usado nessa suite era deliberadamente efémero/test-only; a validação posterior do provider CNG persistente e da factory Windows está registada abaixo.


## Pipelines de build por edição — adicionados ao branch ativo
- Criados `.github/workflows/build-universal.yml`, `build-dgmat.yml` e `build-vst.yml`.
- Os três workflows só aceitam `workflow_dispatch`; não são disparados por push/PR/schedule/release. Cada edição tem grupo de concorrência próprio, sem cancelar builds em curso.
- Criado `scripts/build-edition.mjs`: valida o perfil através de `createProductProfile`, gera `edition-manifest.json` sem IDs/segredos reais e empacota a distribuição de código-fonte com `npm pack`.
- Cada workflow executa `npm run check` antes do empacotamento e publica o artifact correspondente durante 14 dias.
- Limite: estes artifacts são source packages perfilados, não instaladores Windows/Android nem prova de integração real com DGM-MAT/VST.
- Não executar os workflows automaticamente a cada commit. A validação de cada pacote será iniciada manualmente em marcos estratégicos.
- A CI automática existente do PR #19 detetou um defeito real no teste de perfis (sequências `\
` literais); corrigido no branch antes da nova validação.


## Adaptador DGM-MAT GET-only — branch em revisão
- Adicionado `packages/scene-engine/src/dgmat-readonly-adapter.mjs`, compatível com o contrato de adaptadores v1.
- Endpoint limitado a loopback HTTP, rotas GET allowlisted `/runtime/status` apenas, token de sessão curto fornecido por provider seguro externo.
- Não faz bootstrap, pairing, armazenamento de credenciais, WebSocket ou chamadas de escrita. Capacidade única: `read_state`.
- Polling serializado com intervalo configurável e timeout limitado; 401/403, redirects e respostas inesperadas falham fechados.
- A resposta atual `/runtime/status` não tem watermark de frescura de origem. O adaptador mantém o snapshot como `synchronizing` e não publica agentes/tarefas como confirmados.
- Testes unitários cobrem loopback, sessão injetada, GET-only, allowlist, sanitização, estado não verificado e rejeição de sessão.
- Pendente: provider real de sessão ligado ao keystore seguro, watermark autoritativo, testes E2E no PC com DGM-MAT ativo e validação CI/visual no HEAD final. Não declarar integração operacional antes disso.


## DGM-MAT endpoint security hardening — 2026-11-04
- PR #20 merged (`6c5f8ed088741dacc667c96775f7806edb10500d`): initial read-only DGM-MAT adapter.
- PR #21 branch `fix/dgmat-loopback-endpoint-hardening`: restrict endpoint to HTTP loopback port 8181 and root URL only; remove unused health route from allowlist; add tests for alternate ports, paths, query, credentials and HTTPS.
- The session provider/OS keystore and authoritative source freshness contract remain outstanding. No live PC E2E claim.


## DGM-MAT local session provider — 2026-11-04
- New branch `feat/dgmat-local-session-provider` implements `DgmMatLocalSessionProvider` for the documented `POST /auth/session` contract.
- Bootstrap credential is supplied by an injected host keystore provider, used only for loopback exchange, and never cached by Office Kit; access token remains memory-only and is refreshed before expiry.
- 401/403 from the read-only adapter invalidates the injected session cache. Added unit tests for endpoint restrictions, request contract, concurrent exchange, expiry, invalidation and fail-closed responses.
- Still missing: concrete Windows CNG/DPAPI/credential-vault bridge to retrieve the protected DGM-MAT bootstrap credential, process-host wiring, and live PC E2E. Do not claim DGM-MAT connection is operational.


## Comercialização e assinatura — implementação em curso
- Adicionado contrato de entitlement offline com schema versionado, Ed25519, datas UTC, edição/plano, features, licença perpétua e limite explícito de instalações.
- Verificação delegada a provider confiável do host; não há chave privada no cliente. A função de capacidade de lugares exige contagem proveniente de registry durável/atómico.
- Ainda não existem emissão/assinatura de licenças, checkout, billing, registry de ativações, UI de ativação, app Android/Windows nativa nem pipeline de assinatura de releases.
- Modelo comercial inicial documentado: Personal 1, Small Team 10, Business 50, Enterprise volume negociado; preços dependem de pesquisa e custos reais.


## Ativação e limite de instalações — em desenvolvimento
- Implementado módulo `LicenseActivationRegistry` com contrato explícito de transação atómica por licença, ativação idempotente, bloqueio ao atingir o limite, desativação idempotente e listagem sem fingerprint.
- Testes usam store em memória serializado apenas como double; não é provider de produção e não prova consistência entre computadores.
- O core agora valida datas UTC de calendário estritas, incluindo dia/mês e ano bissexto.
- Falta provider durável/partilhado, keystore nativo, UI de ativação, serviço de emissão e pipeline de vendas.


## Persistência SQLite — estado em 2026-11-07
- [x] Adaptador SQLite host-injected com transação `immediate` e serialização JSON (PR #27).
- [x] Evitar UPSERT em transações sem alterações (PR #28).
- [x] Detetar mutações in-place por comparação de snapshots (PR #29).
- [x] Testes com o motor SQLite real, ficheiro temporário, reabertura de conexão e rollback de updater inválido (PR #30).
- [x] Concorrência e bloqueios entre conexões independentes no mesmo processo (PR #31).
- [x] Exclusão de escritores em processos Node.js separados com `BEGIN IMMEDIATE` (PR #32).
- [x] Persistência de metadados públicos de identidade, isolamento por instalação e CAS revisionado (PR #33).
- [x] Recuperação após terminação abrupta de processo durante transação SQLite WAL, com preservação do último commit e `PRAGMA integrity_check` (PR #37; CI/visual verdes no HEAD `6b99b093a0912d705cea551f8bcf3e020ef584ab`).
- [ ] Perda física de energia/falha do armazenamento, ACLs do sistema operativo, encriptação, backup e restore.
- [ ] Host nativo Windows com localização de dados, ACLs e integração DPAPI/CNG/Windows Credential Manager.
- A store recebe a conexão do host; ainda não existe host/instalador nativo de produção.


## SQLite identity metadata persistence — integrado
- PR #33 integrada em `10f386081118c0951ac23deeeedba5b83af1156e`; CI e regressão visual passaram no HEAD `737adf3aeeea804a278d60dd81792226f5adbea3` e no merge commit.
- `SqliteNodeIdentityMetadataStore` usa conexão SQLite fornecida pelo host, separa registos por `installationId` e aplica CAS revisionado em transação imediata.
- Metadados corrompidos, revisão divergente e mudança de instalação são rejeitados. Só são persistidos dados públicos e handles opacos; nunca chaves privadas.
- Testes da store usam o motor `node:sqlite` real em base temporária. O adaptador é um wrapper de teste sobre `DatabaseSync`, não um teste do driver better-sqlite3 nem de host nativo.
- PR #36 (`feat/sqlite-identity-lifecycle-validation`) acrescenta testes do ciclo de vida do manager com reabertura da base. CI e regressão visual passaram no HEAD `1503db41f7be669c67d7f9b94070f83cffe6af10`; a suite usa keystore efémero no mesmo processo e não prova persistência de chaves após reinício.


## Integração do ciclo de vida da identidade — CI e regressão visual aprovadas
- Adicionado teste de integração `node-identity-sqlite-lifecycle.integration.test.mjs`: cria identidade, fecha/reabre a base SQLite, instancia novo `NodeIdentityManager`, valida identidade pública e prova Ed25519, executa rotação, reconciliação e revogação.
- O teste usa `EphemeralEd25519KeyStore` mantido no mesmo processo para isolar a persistência dos metadados; não prova persistência de chaves entre processos nem um keystore de sistema operativo.
- PR #36 integrada por squash no commit `e68e9ee434ab9a6af7b0a6e9b73de318da4065c1`; CI run `42381571495` e regressão visual run `42381571523` passaram no HEAD final `4a95875df759c7df37701568a5910bd7abb62125`. A suite carrega `node:sqlite` dinamicamente e ignora apenas esta integração em Node 20, mantendo a compatibilidade declarada.


## Recuperação SQLite após terminação abrupta — incremento em validação
- Adicionado teste de integração que usa SQLite real em ficheiro e modo WAL; um processo filho executa o UPDATE de metadados dentro de `BEGIN IMMEDIATE` e é terminado antes de `COMMIT`.
- Após reabrir a base, o teste exige que a revisão anterior continue intacta e que `PRAGMA integrity_check` devolva `ok`.
- Isto cobre recuperação após terminação do processo com transação não confirmada; não prova perda física de energia, falha do disco/controlador, ACLs, cifragem ou backup/restore.
- PR #37 integrada por squash em `9cc92f3ed6be21d1140ce9fe76f843d5186fc9b4`; CI run `42382078748` e regressão visual run `42382078743` passaram no HEAD `6b99b093a0912d705cea551f8bcf3e020ef584ab`.


### Identidade — proteção contra replay de challenges
- Adicionados stores de nonce one-time em memória e SQLite.
- O manager consome atomicamente o nonce antes de assinar; reutilização é rejeitada.
- O store SQLite usa chave primária única e transação imediata para coordenar processos que partilham a mesma DB; entradas expiradas são limpas durante o consumo.
- Keystores persistentes exigem store de replay persistente. O store em memória só é permitido no modo explicitamente efémero/teste.
- CI valida persistência através de duas ligações SQLite e reabertura da DB. Isto não substitui validação do verificador remoto nem testes de power-loss/Windows nativo.


## CI nativa em Windows e Linux — em validação
- A workflow principal executa a suite completa em `ubuntu-latest` e `windows-latest`, com Node.js 22.
- A primeira execução Windows encontrou um defeito no teste SQLite multi-processo: converter `URL.pathname` com `pathToFileURL` duplicava a unidade do disco (`D:\\D:\\...`). A construção foi corrigida para usar diretamente `new URL(..., import.meta.url).href`.
- HEAD final do PR #41 (`afbae1a07730509175c3e1d9742d76e4019e12a2`): CI run `42383828000` passou nos jobs `core-tests (windows-latest)` e `core-tests (ubuntu-latest)`; regressão visual run `42383827922` passou e produziu o artifact `13578343670` com seis capturas desktop, landscape e portrait, com/sem painel de conversa. Cada runner executou 147 testes, 147 pass, 0 fail e 0 skipped. O PR foi squash-merged em `2d9c4cbcdeeddcfa718d736ef3a04ce9f39b44ab`; CI pós-merge run `42383940775` e visual run `42383940809` também passaram no SHA de main. Runner Windows é CI nativa automatizada, não teste de instalação em máquina física nem prova de CNG/DPAPI, ACLs, assinatura ou desinstalação.


## Identity algorithm compatibility — in progress
- NodeIdentityManager now supports the explicit algorithms Ed25519 and ECDSA-P256-SHA256, with algorithm-specific public-key/signature lengths recorded in metadata and returned in possession proofs.
- Added EphemeralP256KeyStore as a test-only WebCrypto provider. It creates non-extractable P-256 private CryptoKey objects; this is not a persistent or hardware-backed provider.
- Added lifecycle coverage for P-256 create/sign/verify/replay rejection/rotation and private-key non-exportability.
- This work enables native providers to use the algorithms exposed by common platform keystores without changing the neutral identity protocol. Native CNG/TPM, Keychain/Secure Enclave, Android Keystore, PKCS#11 and browser-persistent providers remain unimplemented.
- PR #42 foi validado no HEAD `650e63a417dfca36483d20bdbde2d945542ee1b2`: CI run `42384699834` passou em Windows e Linux com 150/150 testes em cada runner, incluindo prova P-256, rejeição de exportação da chave privada e proteção contra migração implícita de identidade Ed25519 legada; regressão visual run `42384699857` passou e produziu artifact `13578962189`. O PR foi squash-merged em `5212c3044bf890cc924180c6030012d55647d5f9`; CI pós-merge run `42384818786` e visual run `42384818767` passaram no mesmo SHA de main (artifact `13578524723`). Continuam pendentes providers persistentes/nativos e testes de persistência em reinício real.


## Windows CNG P-256 keystore — integrado, CI nativa validada
- Foi acrescentado WindowsCngP256KeyStore, ligado a um helper .NET nativo que usa Microsoft Software Key Storage Provider, chaves ECDSA P-256 persistentes e ExportPolicy.None.
- Os key handles incluem um hash do installation ID; a API rejeita assinatura/remoção fora do âmbito e responde como inexistente a consultas de outro installation ID.
- O provider declara persistent=true, protectionLevel=os-protected, hardwareBacked=false e privateKeyNonExportable=true. Não reivindica TPM, Secure Enclave ou proteção física.
- PR #44 integrada por squash em `6d9d8498a5e965e18eb6edf221bebb8b5f2bf8df`. HEAD final validado `e04c9a4a9e00a5d39b9c1aa982186403dfed1877`: CI run `42420915287` passou em Linux e Windows; no runner Windows o helper .NET foi publicado e a integração CNG real passou (persistência entre processos, assinatura/verificação, recusa de exportação privada, remoção e isolamento entre instalações). Regressão visual run `42420915296` passou no mesmo SHA. CI pós-merge `42421035235` e visual pós-merge `42421035019` passaram no commit main `6d9d8498a5e965e18eb6edf221bebb8b5f2bf8df`.
- A base SQLite de metadata/challenges continua injetada e gerida pelo host; este incremento não é instalador nem política de backup/ACL.


## Recuperação da bridge de adaptadores — PR em desenvolvimento
- Recuperados os invariantes úteis do antigo `feat/adapter-runtime-bridge` (7 commits exclusivos), sem copiar uma segunda classe paralela `AdapterRuntimeBridge`, porque `AdapterGateway` já ocupa esse papel no core atual.
- A subscrição começa antes do snapshot inicial; eventos precoces ficam numa fila limitada e só são aplicados depois do snapshot.
- A sessão de eventos fica vinculada ao `metadata.id` e a um único `sessionId`; lacunas de sequência, troca de sessão, overflow e eventos incrementais agent/task ainda não suportados fazem fail-closed.
- Falhas na obtenção do snapshot limpam a subscrição e desligam o adaptador. Desconexão explícita limpa sequência e identidade de sessão.
- Testes adicionados para lacunas, troca de sessão, eventos incrementais, eventos durante startup, overflow, cleanup e reconnect. CI/visual ainda pendentes no HEAD da PR.
- A bridge não autentica adaptadores, não implementa patches de agentes/tarefas e não envia comandos. O host deve autenticar/autorizar antes de fornecer o adaptador; capacidade inicial continua read-only.


### Windows identity runtime composition — PR #46 validada
- A factory `createWindowsNodeIdentityRuntime` compõe o CNG P-256 persistente, `SqliteNodeIdentityMetadataStore` e `SqliteNodeIdentityChallengeStore`; é exportada apenas por `windows.mjs`, mantendo o entrypoint genérico/browser-neutral sem dependências Node nativas.
- PR #46 validada no HEAD `77669de98b42bdc6bcf1d866797cc6ef1a066707`: CI run `42483528564` passou em Linux e Windows; o job Windows publicou o helper .NET e passou os testes explícitos de CNG e runtime identity (1/1 cada). A suite geral registou 157 pass, 0 fail e 2 skips antes desses testes nativos serem executados explicitamente com o helper configurado.
- Regressão visual run `42483528517` passou no mesmo HEAD, gerou seis capturas desktop/landscape/portrait com e sem chat (artifact `13618816020`) e reportou `browserErrors: []`. Inspeção manual das capturas não encontrou regressão; a vista geral portrait continua com o edifício pequeno, dívida visual anterior a esta alteração.
- O teste da factory cria identidade, prova posse, fecha/reabre SQLite, recria o manager, confirma a identidade, rejeita replay e revoga. A integração CNG já tinha validado persistência da chave entre processos helper na PR #44. Isto não equivale a reinício do processo host ou do sistema.
- O helper usa Microsoft Software KSP: proteção OS-level/software-backed, `hardwareBacked=false`; não é TPM.
- Continuam fora do âmbito desta PR: launcher/host desktop, instalador/desinstalador, ACLs e backup/restore do ficheiro SQLite, teste no PC físico e integração de adaptadores autenticados.


### Windows native host integration contract
- Added `docs/WINDOWS_NATIVE_RUNTIME_INTEGRATION.md` defining startup, reconciliation, health, lifecycle, ACL, helper trust, retention and explicit validation boundaries.
- Extended the Windows runtime integration test to cover key rotation, old-key deletion and persistence after reopening SQLite.
- A desktop host/installer is still not present; this document is a contract for future integration, not evidence of an installed product.
