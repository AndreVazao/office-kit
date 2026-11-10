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


### Windows native host contract and rotation integration — PR #48 validated
- PR #48 final code HEAD `1b856195ada69de5fbb0ab64b7c82d736aafdacb`: CI run `42484745984` passou em Linux e Windows; o runner Windows publicou o helper .NET e executou a integração composta (1/1) com create/prove/rotate, remoção da chave anterior, fecho/reabertura SQLite, persistência da nova identidade, rejeição de replay, nova prova após restart do manager, revoke e reconciliação após reabertura.
- A suite geral registou 157 pass, 0 fail e 2 skips antes do teste Windows-only ser executado explicitamente com o helper configurado; o teste nativo explícito passou com 1 pass, 0 fail e 0 skips. O teste CNG separado também passou.
- Regressão visual run `42484745951` passou no mesmo HEAD, gerou seis capturas desktop/landscape/portrait com e sem chat (artifact `13618319943`) e reportou `browserErrors: []`.
- `docs/WINDOWS_NATIVE_RUNTIME_INTEGRATION.md` é um contrato para um futuro host, não implementação de launcher/installer. Continuam pendentes falhas de cleanup/recovery, ACLs reais, assinatura/trust do helper, upgrade/rollback, uninstall, backup/restore, restart do processo host/sistema e validação no PC físico.


### Windows cleanup failure/recovery — PR #50 validated
- PR #50 code HEAD `2d62835a4e2e58187205b523b4b4bb27feb21155`: CI run `42485145796` passou em Linux e Windows; no runner Windows, o teste composto executou 2 cenários (rotação/replay/revoke e recuperação de cleanup) com 2 pass, 0 fail, 0 skips. O teste CNG nativo separado passou 1/1.
- O novo cenário injeta falhas no limite do provider durante a remoção da chave antiga na rotação e durante revoke; depois fecha/reabre SQLite, cria runtime novo e usa o helper CNG real para reconciliar. A identidade fica ativa após recuperar a rotação; a revogação fica concluída após recuperar a remoção. Isto é fault injection do contrato do provider, não simulação de falha física do Windows, disco ou ACL.
- A suite geral registou 157 pass, 0 fail e 3 skips antes dos testes Windows-only serem executados explicitamente com o helper configurado. Regressão visual run `42485145823` passou no mesmo HEAD, seis capturas (artifact `13619182381`), `browserErrors: []`.
- Continuam pendentes host/launcher, instalador, ACL/assinatura reais, backup/restore, upgrade/uninstall, falhas físicas de armazenamento, restart do processo host/sistema e PC físico.

## Windows local host runtime — implementação inicial
- Adicionado `packages/windows-host`: composição local Windows-only, armazenamento SQLite local, instalação ID estável, lock de instância única, ACLs por SID, verificação Authenticode do helper CNG, reconciliação no arranque, health e encerramento limpo.
- CLI explícito: `health`, `create-identity`, `rotate-identity`, `revoke-identity`. O arranque nunca cria uma identidade automaticamente e não inicia listeners, descoberta, telemetria ou comandos remotos.
- Testes de host usam runtime/ACL/verificação de assinatura injetados e SQLite real; não são validação de ACLs, certificados ou instalação física.
- Limite de release: o helper CNG do CI ainda não tem assinatura de distribuição; o CLI rejeita corretamente helpers sem Authenticode válido. MSI/MSIX, assinatura de release, atualização/rollback, backup/restore e PC físico continuam pendentes.
- Requisito do host: Windows + Node.js 22.5+ (`node:sqlite`). O pacote não é importado pelo core genérico nem pela preview.

### Windows host — integração nativa de ACL/trust em CI
- Acrescentado teste Windows-only que executa `whoami`, `icacls` e icacls reais; verifica ACL efetiva do utilizador atual e SYSTEM na pasta de instalação, pasta de dados, installation metadata e SQLite.
- O teste separado usa `Get-AuthenticodeSignature` real e confirma rejeição de helper sem assinatura. O cenário de ACL injeta apenas a aceitação do helper para não depender de certificado de release.
- A validação está pendente até o runner Windows executar o novo HEAD. Não equivale a PC físico, assinatura de release ou instalador.

- Correção encontrada pela integração nativa: ACLs de diretório usam herança `(OI)(CI)F`; ACLs de ficheiros usam `F` direto. A regra anterior podia deixar ficheiros sem ACE efetiva. A nova execução Windows deve confirmar o SID do utilizador e SYSTEM em ambos.

### Windows host startup reconciliation
- O composition root executa `manager.reconcile()` no arranque e expõe `ready`; operações de identidade e CLI aguardam essa barreira.
- Se a recuperação de metadata/chaves falhar, create/rotate/revoke não são executados. O encerramento aguarda a reconciliação e fecha DB/lock mesmo em erro.
- Testes acrescentados para ordem reconcile-before-mutation e fail-closed em erro de reconciliação. CI pendente no HEAD desta PR.

- A barreira `ready` também bloqueia estados de reconciliação não finais (por exemplo `cleanup_pending`): health fica degraded, não expõe identidade possivelmente obsoleta e nenhuma mutação é executada.

### Portable Windows host bundle — em validação
- Criado builder que inclui Node.js 22, módulos scene-engine/windows-host e helper CNG.
- CI cria certificado Code Signing efémero, instala-o apenas nos stores do runner, assina o helper e executa o CLI portátil em processos separados para health, create, reopen, rotate e revoke.
- Este teste não equivale a certificado de distribuição nem a instalador MSI/MSIX. O workflow ainda tem de passar no HEAD final.
## Product requirements added — incident diagnosis, recovery and behavior-preserving adaptive rendering (2026-11-09)

### Required architecture (not yet claimed implemented)
- [ ] Add OfficeHealthRecoveryEngine to classify evidence across Office Kit runtime, adapter, transport/network and backend. Outcomes must distinguish confirmed, probable and indeterminate causes; do not blame a component from a timeout alone.
- [ ] Persist/export incident records with ID, timestamps, edition/version, adapter/backend, last confirmed communication, diagnostic checks, evidence, confidence, impact, recovery attempts, duration and final outcome. Redact credentials, tokens, secret headers and sensitive payloads.
- [ ] Add bounded safe recovery: validate local configuration; rediscover only authorized/configured endpoints; verify endpoint/port; restart local adapter only when safe; renew sessions through the host provider; reconnect and require a fresh consistent snapshot before declaring healthy.
- [ ] Never alter credentials, bypass authentication, write to external backends or restart external services without explicit authorization.
- [ ] Add SocialSimulationEngine with variable pseudo-random activities, durations, routes and avatar interactions. It must run without a backend and clearly label all activity as simulated.
- [ ] On loss of a previously working backend, preserve the incident and mark real tasks interrupted/unknown; social animation may continue but must not imply real task progress/completion.
- [ ] Distinguish backend absent/not configured (offline social mode) from configured backend unhealthy (infirmary/diagnostic mode).
- [ ] Add BackendActivityEngine and OfficeStateManager arbitration. Real work/progress bars require fresh backend evidence; never invent task progress.
- [ ] Add AdaptiveRenderingEngine with multiple renderers (advanced 3D, low-poly, pixel, minimal/retro) over the same behavior/scene model. Hardware reduction changes rendering fidelity/cost, not available social activities or interaction semantics.
- [ ] Decouple simulation clock from renderer FPS. Adapt shadows, lighting, textures, polygons/LOD, pixel ratio and render cadence with hysteresis; support automatic and manual profiles.
- [ ] Detect/reassess CPU, available RAM, GPU/VRAM and graphics API, OS, storage, display resolution and measured frame time. Resource profiles must never hard-cap product editions/features.
- [ ] Keep renderer and backend resource budgets separate.
- [ ] Add tests for simulated-vs-real state leakage, random scheduling determinism under seeded QA, endpoint/adapter/backend fault attribution, redaction, bounded recovery, offline operation, renderer equivalence and low-resource behavior.

The 2-core/approximately 3-GB Windows PC is a validation target only, not a product support ceiling. The physical test matrix remains Universal offline, DGM-MAT read-only, VST read-only and standalone office without backend. No physical installation is authorized until the portable runtime/installer gate is complete.
### Initial code slice on active PR #55 branch — awaiting final CI
- Added packages/scene-engine/src/social-simulation.mjs: deterministic-seed-capable local behavior engine with weighted pseudo-random activity selection, variable durations, location changes, peer interactions, explicit simulated authority and host-driven clock. Tests cover offline labeling, reproducibility, activity changes, repetition, enable/disable and invalid input.
- Added packages/scene-engine/src/office-health.mjs: host-injected layered diagnostic probes for Office Kit runtime, adapter, transport and backend; evidence classification; secret redaction; incident-store contract; local-only bounded recovery scopes; fresh/consistent snapshot verification; recovery history. The included InMemoryIncidentStore is a test/reference implementation, not durable production persistence. Real probes, SQLite persistence, support export integration and actual host recovery actions remain pending.
- Added packages/scene-engine/src/office-state-manager.mjs: explicit offline-social, synchronizing, infirmary and verified-live arbitration. Simulated activity never carries backend tasks/progress; real progress requires a verified live snapshot and a valid backend-supplied percentage.
- Added packages/scene-engine/src/resource-policy.mjs: host-supplied hardware capability normalization, automatic/manual renderer policy, independent renderer budget, protected backend execution policy and degradation/recovery hysteresis. This is a policy engine; OS/GPU/VRAM detection and integration into actual renderer/installer remain pending.
- Added unit tests for all four modules and included the modules in public scene-engine exports and syntax checks.
- These source additions are not yet marked production-ready. Final Linux/Windows CI and visual regression must pass on the exact final PR HEAD. No physical-PC validation has occurred.
### Persistent diagnostics increment — PR #55 branch
- Added `SqliteOfficeIncidentStore`, installation-scoped with append/get/list/update/export, corruption checks, bounded listing, duplicate protection and secret-field/value redaction.
- Windows host now composes the SQLite incident store over its existing host-owned database and exposes `createDiagnostics({ probes, recoveryActions, clock })`; the caller supplies explicitly authorized probes and local recovery actions.
- Added a Windows host integration test proving an incident survives host close/reopen.
- This establishes durable local incident history but does not yet ship real OS/renderer/adapter/transport/backend probes. Cause attribution remains evidence-based and may be indeterminate; no automatic backend restart/write is permitted.
- Windows CI certificate trust uses explicit `certutil` CurrentUser store operations rather than certificate-provider import cmdlets. The first run after this change still timed out on the initial Root-store add, before signing or host execution; therefore the earlier change did not resolve the runner hang. The follow-up adds certutil silent mode and bounded stdout/stderr capture; its CI result is pending.
### Hardware detection and host resource policy — initial host integration
- Added packages/windows-host/src/hardware-capabilities.mjs to detect OS/release, architecture, CPU model/core count, total/available RAM and free storage.
- GPU name/dedicated VRAM/graphics API and display dimensions are optional platform providers. Unknown values remain null; adapter-reported memory is not mislabeled as dedicated VRAM.
- Windows host now computes the initial adaptive resource policy, exposes hardware facts in health, supports runtime refresh and validated manual profile/renderer overrides.
- Renderer profile is separate from backend execution; social activity semantics remain full at every renderer tier.
- This is the initial detection and policy composition. GPU/display platform probes, automatic periodic refresh, persistence of user overrides and actual renderer application remain pending.
### Diagnostic safety hardening
- Diagnostic probes, local recovery actions and fresh-snapshot verification now have bounded deadlines and receive AbortSignals.
- Timeout or inconclusive evidence remains indeterminate; backend restart/write operations remain outside automatic recovery.
- Windows portable E2E now invokes the actual .cmd launcher directly via cmd.exe, avoiding a nested PowerShell wrapper.
### Social simulation connected to the browser office preview
- The preview now instantiates the SocialSimulationEngine from the generic scene-engine instead of selecting a fixed activity from the legacy demo helper.
- Agent activity/location/peer state is retained between UI updates; the preview updates only when an agent's social state changes, so CSS movement is not restarted on every timer tick.
- Added distinct low-cost activity animations and visual cues for walking, conversation, greeting, computer work, whiteboard use, coffee and smoke breaks.
- Offline banner explicitly says there is no backend and all movement is simulated. Economy quality no longer disables avatar animation; it removes effects while preserving social motion.
- The preview uses a fixed QA seed for repeatable visual regression. Production runtime must use a non-fixed seed.
- This connects the social model to the browser preview, not yet to a packaged native renderer or real desktop host UI.
### Preview social regression coverage
- Updated preview contract tests for the explicit OFFLINE banner and added checks that the preview uses the local social simulation engine, updates activity without rebuilding the scene, displays work/coffee/conversation states, and preserves movement in economy quality.
- The prior CI failure on HEAD 7d0025e was a stale text assertion expecting the old "estado não verificado" label; the new assertion matches the explicit OFFLINE wording. The final branch HEAD includes the corrected test.
### Hardware capability naming correction
- The Node OS API reports logical processor count, not physical CPU cores. The detector now records this fact as cpuThreads; the resource policy accepts cpuThreads and retains cpuCores only for host providers that can genuinely report physical cores.
### Windows bundle E2E process isolation
- The portable bundle test now redirects each launcher invocation to isolated output files instead of inherited stdout/stderr pipes. This avoids a child process keeping redirected pipe handles open and blocking PowerShell's asynchronous output drain.
- Per-command timeout is 45 seconds; timeout cleanup terminates the process tree and includes captured stdout/stderr in the failure.
- The final Windows E2E run with this process/output isolation is pending.

### Windows certificate-store CI follow-up — 2026-11-10
- The exact failing job on PR #55 HEAD `0e9dd8e46c9ddf3404eb9fc16b942b1e855a315b` completed the full 214-test suite (211 pass, 0 fail, 3 skip), native CNG integration (1/1), persistent identity integration (2/2), and bundle build. The portable E2E then timed out after 20 seconds at `certutil -f -user -addstore Root`; signing and the portable host lifecycle were not reached.
- Updated `test-host-bundle.ps1` to pass certutil's documented `-silent` flag for ephemeral CurrentUser trust operations and cleanup, and to capture bounded native stdout/stderr. This is a diagnostic/fix attempt, not a validated resolution; rerun on the new HEAD is required.

### Windows certificate trust API correction — 2026-11-10
- The rerun on HEAD `b33425c9ef617942b120954c8c8375880f4fe9ba` completed Linux CI and visual regression successfully; Windows failed immediately because this runner's `certutil -addstore` does not accept `-Silent` (exit 1). This disproves the previous silent-flag attempt; no host lifecycle commands ran.
- A second attempt using the .NET `X509Store` API also timed out after 20 seconds while opening/adding to CurrentUser Root. No signing or host lifecycle commands ran. The CI design is now changed: do not mutate Root/TrustedPublisher stores; leave the ephemeral code-signing cert untrusted, assert the production launcher rejects it, and use a test-only verifier that requires Authenticode `NotTrusted` plus the exact ephemeral signer thumbprint to exercise the portable runtime. This validates signature integrity/pinning and real CNG/SQLite lifecycle, not trusted-chain acceptance. New CI is pending.

### Portable bundle trust boundary — revised CI strategy — 2026-11-10
- GitHub-hosted Windows runner timed out on both `certutil -addstore Root` and .NET `X509Store` CurrentUser Root mutation. The test no longer writes Root or TrustedPublisher stores.
- The production launcher is now expected to reject the untrusted ephemeral test signer. A separate test-only runner accepts only a cryptographically intact Authenticode signature with the exact ephemeral thumbprint and `NotTrusted` chain status, then exercises the bundled Node runtime, SQLite, Windows CNG create/reopen/rotate/revoke across fresh processes.
- This is not a positive trusted-publisher integration test. Acceptance of a real trusted release signer remains a physical Windows/release validation gate. CI on the updated HEAD is pending.

### Universal Windows bundle isolation and Authenticode CI — 2026-11-10
- The Universal portable bundle builder now stages an explicit allowlist: nine backend-neutral scene-engine modules and three Windows-host modules. It does not copy `scene-engine/src/index.mjs`, DGM-MAT adapter/session modules or VST modules. The manifest records the allowlist and explicitly excludes DGM-MAT/VST.
- The bundle E2E now compares the actual staged file set with that allowlist before executing any host command. This closes the DGM/VST source leakage in this specific portable Windows bundle; the generic scene-engine entrypoint and npm edition artifacts remain tracked in issue #56.
- The previous CI run failed during signing because the child Windows PowerShell process lacked the Cert: provider drive. The current attempt explicitly imports Microsoft.PowerShell.Security and retrieves the ephemeral signing certificate from CurrentUser/My through a read-only .NET X509Store. CI on the resulting HEAD is pending. The production launcher must still reject the untrusted CI signer; the test-only verifier is restricted to NotTrusted plus the exact ephemeral thumbprint.
### Windows portable bundle — correção do parser PowerShell
- A execução Windows mais recente tinha passado os 214 testes da suite (211 pass, 0 fail, 3 skips), CNG nativo, runtime de identidade e build do bundle, mas o E2E parou antes da assinatura/execução do host devido a um parêntese em falta na validação do manifesto.
- Corrigida a expressão no script E2E. No HEAD `60eb648fd7fcaf381039e7805c193ac6474c87f7`, Linux CI está verde; Windows E2E e regressão visual continuam pendentes. Isto ainda não é evidência de bundle E2E aprovado.
- O workflow Windows valida agora a sintaxe dos scripts PowerShell de build e E2E antes dos passos nativos mais demorados. Isto antecipa erros de parser; não substitui o teste do bundle.

### Edition artifact isolation — PR #56 branch, awaiting CI
- The generic packages/scene-engine/src/index.mjs no longer re-exports DGM-MAT modules. DGM-MAT exports live in the dedicated packages/scene-engine/src/dgmat.mjs entrypoint.
- scripts/build-edition.mjs now stages explicit per-edition source allowlists in a temporary directory and packs only that staged package. Universal excludes DGM-MAT/VST modules; DGM-MAT includes only its own adapter/session modules; VST includes no backend-specific adapter until a real VST adapter is implemented.
- VST product metadata no longer claims a vazao-sovereign-trader adapter exists. Its adapter allowlist is empty and status is not_implemented.
- Root package engine floor and all three manual edition workflows now use Node.js 22.5+ / Node 22, matching the host's node:sqlite requirement. The manifest documents that node:sqlite remains experimental on Node 22.
- New artifact tests inspect the actual .tgz contents for all three editions, checking both required and forbidden modules. CI on the branch is pending; this is not yet a merged/released package.

### SQLite incident concurrency — PR #60
- SQLite incident append/update now requires an immediate transaction provider and uses BEGIN IMMEDIATE for atomic read/modify/write.
- Added monotonic per-incident revision, compare-and-set update predicate, reserved-field rejection and legacy schema migration to revision 1.
- Added real node:sqlite migration and two-process contention tests.
- This is concurrency consistency, not tamper evidence. Append-only journal, keystore-backed MAC/signature chain, chain verification, crash/power-loss recovery and owner-consent support export remain pending.
