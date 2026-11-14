# Implementation status

This page records implemented work separately from planned or independently verified behavior.

## Current integration status — 2026-11-14

- Main HEAD at this status update: `419b45d4294509f1147b2d17375147cd15d1c0c9` (PR #91 squash merge). No PR is currently open.

- **Universal:** backend-independent core and source-package profile. It must not include DGM-MAT/VST adapter code or credentials.
- **DGM-MAT:** isolated read-only adapter/session and Windows CNG bootstrap composition are integrated. Live E2E against a running DGM-MAT instance, physical-PC validation and CNG-profile backup/recovery remain pending.
- **VST:** the isolated VST source package now contains a read-only preview adapter and Windows host composition. It uses authenticated loopback `GET /observer/summary` with `X-Token`; the token is stored through the generic Windows CNG vault in namespace `vst.local-api`. Provisioning/removal require explicit owner consent and connection is manual. No write/trading capability is exposed; `REAL` is informational only, `executionAuthorized=false`, and backend readiness remains `unverified`.
- VST adapter unit tests use injected token providers and fake HTTP responses. A dedicated Windows integration test uses the real CNG helper and SQLite vault through an injected host factory with a fake observer response. It passed on Windows Node 22 and Node 26.13.1 in CI #43230962819 on implementation HEAD `3aff126095e4af10d16ea65fccaeb58be983eb43`; it verifies encrypted persistence, key non-exportability, close/reopen, authenticated GET and explicit token/key removal. It does not validate the full signed Windows host lifecycle, a live VST instance or the user's physical PC.
- All three edition source tarballs are checked for positive and negative module membership. They are not OS installers.
- PR #77 was merged as `d0bcd59055202e7a845bb2b103cf91c72597a1b2`. On final PR HEAD `fe811f4d8b44ae81b4294bd2e108065212176bde`, CI #43226023576 passed Node 22 and Node 26.13.1 on Linux/Windows, including Windows native CNG/identity and portable bundle E2E; visual regression #43226023574 passed on Node 26.13.1. The package engine floor remains `>=22.5.0` because `node:sqlite` is still Experimental on Node 22 and Release Candidate on Node 26.


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
- Production command transport and live backend validation are not complete. DGM-MAT and VST currently expose read-only adapter paths only; neither authorizes commands or trading operations, and neither has a live-backend E2E gate recorded here.
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
- O provider de sessão e a composição CNG DGM-MAT-only foram posteriormente ligados no host Windows e integrados na PR #72. Continua pendente um watermark autoritativo que prove sincronização atual; o estado fica unverified até live E2E contra DGM-MAT e validação no PC físico.


## DGM-MAT endpoint security hardening — 2026-11-04
- PR #20 merged (`6c5f8ed088741dacc667c96775f7806edb10500d`): initial read-only DGM-MAT adapter.
- PR #21 branch `fix/dgmat-loopback-endpoint-hardening`: restrict endpoint to HTTP loopback port 8181 and root URL only; remove unused health route from allowlist; add tests for alternate ports, paths, query, credentials and HTTPS.
- The session provider/OS keystore and authoritative source freshness contract remain outstanding. No live PC E2E claim.


## DGM-MAT local session provider — 2026-11-04
- New branch `feat/dgmat-local-session-provider` implements `DgmMatLocalSessionProvider` for the documented `POST /auth/session` contract.
- Bootstrap credential is supplied by an injected host keystore provider, used only for loopback exchange, and never cached by Office Kit; access token remains memory-only and is refreshed before expiry.
- 401/403 from the read-only adapter invalidates the injected session cache. Added unit tests for endpoint restrictions, request contract, concurrent exchange, expiry, invalidation and fail-closed responses.
- Historical note: the CNG bridge and DGM-MAT-only host composition were subsequently integrated in PR #72. Live DGM-MAT and physical-PC validation remain pending.


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

### Connection supervisor — PR #61 merged (2026-11-10)
- Squash-merged as `43adb778b8e03d85c1766f5f1bc68ca15ecea027` after Linux CI, Windows CI and browser visual regression passed on exact HEAD `ded5a449b452fdf56048ff547279fe3b06ddda23`.
- Added an event-driven supervisor that records only a confirmed live-to-unhealthy transition and does not mislabel startup failures as backend outages.
- Serialized observations to prevent fast recovery racing ahead of incident persistence; incident identity is assigned only after append succeeds.
- Diagnostic codes reject opaque/secret-shaped values. Repeated state events are coalesced into one outage; recovery requires passing probes plus a fresh authoritative live snapshot.
- CI used fake/injected probes for supervisor lifecycle. This is not proof of real DGM-MAT/VST adapter integration or physical-PC validation.

## DGM-MAT adapter and session lifecycle hardening — branch feat/dgmat-session-hardening (2026-11-10)
- Changed the DGM-MAT adapter allowlist to authenticated loopback `GET /runtime/state` only. The source `timestamp` is treated as last state mutation, not heartbeat/snapshot generation; mutation age is diagnostic only and the adapter remains `synchronizing` / unverified.
- Added one request deadline covering access-token acquisition, fetch and response-body parsing. Hanging injected token providers and stalled response bodies are bounded.
- Provider/fetch errors are normalized to safe codes; 401/403 awaits bounded async token invalidation. Secret-shaped status values are not copied into snapshots.
- Each successful connection gets a fresh UUID session ID. A generation fence rejects late polling results from a disconnected/replaced session.
- Added unit/fake tests for deadline boundaries, cancellation, safe error events, timestamp semantics, session rotation and late-poll suppression. CI has not yet run on the final branch HEAD.
- The local session provider now bounds the complete bootstrap credential -> loopback POST -> response-body exchange with one deadline and supports caller cancellation.
- PR #72 later integrated the dedicated Windows CNG bootstrap vault and DGM-MAT-only host composition. Live contract tests against a running DGM-MAT instance and physical-PC validation remain pending; node-identity keys remain separate.

## Connection supervisor — validation and merge (2026-11-10)
- [x] PR #61 merged into main; merge commit `43adb778b8e03d85c1766f5f1bc68ca15ecea027`.
- [x] Final PR HEAD `ded5a449b452fdf56048ff547279fe3b06ddda23`: Linux CI passed.
- [x] Same final HEAD: Windows CI passed, including CNG host publication, persistence/isolation, persistent node identity and portable host E2E.
- [x] Same final HEAD: browser visual regression passed.
- [x] Supervisor detects only verified live-to-unhealthy transitions; startup failures remain distinct.
- [x] One incident per outage; recovery requires passing probes and a fresh authoritative live snapshot.
- [ ] Integrate supervisor into the installed host lifecycle and validate against real DGM-MAT/VST adapters.
- [ ] Physical PC validation remains outstanding. CI and browser rendering do not replace installation tests.


## Host-managed connection supervision — PR em desenvolvimento (2026-11-10)
- [x] Adicionar composição host-managed de AdapterGateway + OfficeConnectionSupervisor + SQLite persistente.
- [x] Exigir adapter explicitamente selecionado e probes read-only explícitos.
- [x] Supervisionar eventos intermédios de sessão, não apenas o estado final de connect.
- [x] Encerrar gateways geridos antes de fechar SQLite.
- [ ] Validar Linux/Windows CI e regressão visual no HEAD final.
- [ ] Exercitar adapters reais DGM-MAT/VST; GenericDemoAdapter é apenas teste de contrato.
- [ ] Validar instalação física e comportamento de recuperação no PC do utilizador.

- [x] Corrigir a allowlist do bundle Windows para incluir as dependências transitivas do AdapterGateway (`adapter-gateway`, `runtime-session`, `runtime-state`, `adapter-contract`) e validar a lista no teste independente.
- [ ] Reexecutar Linux, Windows e regressão visual no mesmo HEAD final; a execução anterior falhou no E2E Windows por módulo ausente no bundle, embora os testes de identidade/CNG tenham passado.


## Installation lifecycle controller — PR em desenvolvimento (2026-11-11)
- Implementado coordenador serializado para install/start/stop/restart/upgrade/rollback/uninstall com driver de plataforma e store injetados.
- Instalação e arranque só são confirmados após health `ready`; falhas ficam `degraded`.
- Upgrade cria backup antes de ativar; falha tenta restaurar versão anterior e retomar o runtime.
- Uninstall retém dados por omissão; apagar dados exige `retainData: false` explícito e só ocorre depois de remover runtime.
- Testes adicionados para transições, persistência/reabertura, concorrência, falha de health, rollback e retenção de dados. CI ainda não executado no HEAD final.
- Limite: não há driver Windows real, serviço Windows, MSI/MSIX, assinatura de distribuição ou validação física. Não declarar instalador pronto.


## SQLite lifecycle state store — PR em desenvolvimento (2026-11-11)
- Implementado `SqliteInstallationLifecycleStore` com isolamento por installation ID, JSON validado e escrita transacional `BEGIN IMMEDIATE/COMMIT`.
- Integrado na composição Windows host e exposto como `installationLifecycleStore`, partilhando a base de dados com o host.
- Testes cobrem round-trip/reabertura, isolamento entre instalações, argumentos inválidos, JSON corrompido e commit.
- O host usa WAL e `synchronous=FULL`; isto protege transações SQLite, mas não substitui backup de binários/pacotes nem recovery do driver de plataforma.
- CI ainda pendente; sem driver de serviço Windows/Linux ou instalador MSI/MSIX nesta etapa.


### Correção do bundle Windows — PR #66 (2026-11-11)
- O E2E Windows no HEAD anterior falhou porque `index.mjs` passou a importar `sqlite-installation-lifecycle-store.mjs`, mas o builder do bundle portátil não incluía esse módulo.
- A allowlist explícita do builder e a allowlist independente do teste foram atualizadas para incluir o store; o manifesto deriva a lista do builder e o E2E compara os ficheiros efetivamente copiados.
- O erro anterior impediu a validação do host portátil; não foi uma falha de SQLite/CNG. A correção ainda exige nova execução Linux, Windows E2E e visual regression no mesmo HEAD.
- Sem alteração dos backends DGM-MAT/VST; nenhum teste físico foi executado.


### Recuperação de ciclo de vida interrompido — PR em desenvolvimento (2026-11-11)
- O coordenador persiste checkpoints antes/depois de staging, instalação, paragem, backup, ativação, arranque e desinstalação; o registo SQLite conserva o journal dentro do JSON da instalação.
- `initialize()` deteta uma operação pendente e expõe `recoveryRequired: true`; não executa operações de plataforma automaticamente no arranque.
- `recover()` permite limpar uma instalação interrompida preservando dados e reverter uma atualização quando existe checkpoint de backup concluído. A recuperação valida health antes de confirmar o estado.
- Se o backup foi interrompido durante a chamada, ou se uma desinstalação/rollback/transição de serviço foi interrompida, o coordenador falha fechado e exige intervenção do operador. Não repete remoção de dados nem presume o estado do serviço.
- A recuperação usa driver injetado e testes simulados; não prova um driver Windows/Linux real, MSI/MSIX, serviço do sistema ou PC físico.

- Correção pré-CI: checkpoints de instalação mantêm `state: absent` com `version: null`; a versão-alvo fica no campo `targetVersion` do journal, preservando a validação do estado ausente.
- Correção do teste de recuperação: o fixture de instalação interrompida representa corretamente `state: absent` com `version: null` e guarda a versão pretendida em `targetVersion`, em linha com o contrato do registo.


### Composição do ciclo de vida no Windows host — integrado em main (2026-11-11)
- O host expõe `createInstallationLifecycleRuntime({ driver, clock })`, ligando o coordenador ao store SQLite da própria instalação.
- Teste de integração de composição cobre initialize/install/start, fecho do host e recuperação do estado após reabertura da base SQLite.
- O driver continua simulado/injetado; ainda não existe gestão real de serviços/processos Windows, instalador MSI/MSIX, assinatura de release ou validação física.


### Isolamento do lifecycle por instalação e higiene de testes — PR em desenvolvimento (2026-11-11)
- O facade do Windows host valida o `installationId` recebido em `install()` antes de qualquer checkpoint ou chamada ao driver; instalações cruzadas são recusadas sem efeitos laterais.
- O teste de composição confirma que uma identidade diferente é rejeitada antes de `stage/install` e fecha sempre o host reaberto no bloco `finally`.
- A alteração protege a fronteira do host, mas não substitui autenticação/autorização do utilizador nem um driver de sistema operativo.


### DGM-MAT Windows bootstrap vault and edition-isolated composition — integrado (PR #72, 2026-11-11)

- PR #72 squash-merged em `2395a8a841d8a0a29cc3d67a0e76eb352921f40f`; HEAD final `a616e902f8cf7fdbecbb1f5cd0a3e7a60cafc708`. CI #493 e visual #413 passaram nesse SHA.
- `WindowsCngSecretVault` guarda envelopes AES-256-GCM em SQLite e protege chaves de dados com RSA não exportável no Windows CNG Software KSP; a chave é separada da identidade ECDSA do nó.
- `createWindowsDgmMatHost` e o fluxo bootstrap são exclusivos da edição DGM-MAT. Universal/VST recebem apenas a primitiva genérica do vault, sem rotas nem semântica de credenciais DGM.
- O job Windows executou integração CNG nativa, persistência/isolation, bootstrap secret vault e bundle portátil E2E. Os testes fake/unitários não são contados como evidência nativa.
- Consentimento explícito para provisionar/remover; conexão manual; adapter GET-only/read-only; estado backend `unverified`.
- Pendentes: DGM-MAT live E2E, PC físico, backup/restore e recuperação de perda do perfil CNG. SQLite isolada não é backup suficiente.

### Keystore-backed incident journal MAC — integrado em main (PR #73, 2026-11-12)

- PR #73 squash-merged em `e8bc303096f26b437d13b7fa820443427c72596e`; HEAD final `7b390080645f910cf394ba9c10e83a2f81c8078c`; CI #502 e visual #422 passaram nesse mesmo HEAD.
- HMAC-SHA-256 por evento, com key ID, encadeamento e verificação fail-closed antes de leitura/exportação.
- Windows host obtém a chave de 256 bits no CNG Software KSP, namespace `incident.journal`; o CI Windows validou persistência entre processos/aberturas do host e ausência de substituição silenciosa da chave.
- Limite: chave user-profile-scoped; sem âncora externa anti-rollback, power-loss físico ou recuperação cross-profile. Não declarar resistência absoluta.

### Versioned incident journal MAC keyring — integrado (PR #75, 2026-11-12)

- PR #75 squash-merged em `99ecc7048ae235e89a6fa18fa62eb66f1f7a63ab`; HEAD final `2444e1f0af660cc46a12b43669a3b058c221b256`; CI #506 e visual #426 passaram nesse HEAD.
- A store aceita keyring limitado com IDs únicos e active key explícita; verifica MACs históricos com o provider indicado em cada linha e assina novos eventos com a chave ativa.
- Preserva MACs históricos e falha fechada para chave histórica ausente, cadeia parcial e configuração inválida.
- Não inclui provisioning/rotação CNG pelo host, consentimento do proprietário, eliminação/retirada de chaves ou recuperação; trata-se da fundação de armazenamento, não do workflow completo de rotação.

### Bloqueios de produção ainda abertos

- Resolver a maturidade/versão suportada de `node:sqlite` e alinhar engines, CI e bundle. PR #77 em validação adiciona CI Node 22 + 26.13.1 em Linux/Windows e move regressão visual/builds manuais para Node 26.13.1; o engine floor permanece `>=22.5.0`. `node:sqlite` continua Stability 1.2 — Release Candidate nos docs Node 26 e Experimental no Node 22; não declarar o runtime final escolhido até os checks passarem no mesmo HEAD.
- Implementar rotação CNG gerida pelo host, recuperação autorizada e política de retenção das chaves antigas.
- Adicionar âncora monotónica externa e testes de rollback/power-loss em hardware físico.
- Implementar keystores/hosts Linux, macOS e Android.
- Validar DGM-MAT live e VST live, instaladores reais, assinatura, backup/restore e ciclo completo de atualização/desinstalação.



## VST read-only adapter preview — implementation increment (2026-11-12)

- Added a VST-only adapter entrypoint and Windows host composition; the generic scene-engine entrypoint remains backend-neutral.
- The adapter allowlist contains only authenticated loopback `GET /observer/summary` on port 8765 with `X-Token`; redirects are rejected and remote endpoints are disabled.
- The host stores the local API token in the generic CNG vault under `vst.local-api`; owner consent is required for provisioning/removal and no connection is started automatically.
- Snapshots accept observer data only when the response envelope has `ok === true`, then copy bounded fields. Failed envelopes suppress supplied status/count/health values and remain synchronizing. Agent/task arrays remain empty; observer publication time is not treated as engine readiness. Stale/future/missing timestamps do not become authoritative.
- `REAL` mode is reported as configuration only. No command capability, risk-bearing action or execution authorization is exposed.
- Disconnect and superseding connection attempts abort the active token-provider/fetch signal; each connection has a fresh session UUID and bounded request deadline.
- Unit/fake tests cover route restrictions, authentication, normalization, freshness, deadlines, cancellation, reconnect generation and secret redaction. Edition artifact tests inspect actual tarball contents for isolation.
- CI #43230962819 and visual regression #43230962934 passed on implementation HEAD `3aff126095e4af10d16ea65fccaeb58be983eb43`; Linux/Windows Node 22/26 matrix, Windows CNG integration (including VST namespace) and portable bundle E2E passed. The subsequent documentation-only synchronization commit is being revalidated on its own PR HEAD before merge. Remaining gates: live E2E against the real VST observer, full signed host lifecycle, physical-PC provisioning/reconnect/restart, and production installer/signing.



## SQLite monotonic checkpoint journal — PR #84 integrada (2026-11-13)

- PR #84 squash-merged em `0163babd2ad2524dc1d82fe3f45e1c016070d6ee`.
- HEAD final da PR: `c2598283cbe99f0d96c694f5e2f07419ce9181bd`.
- CI #554 (`43433248846`) passou em Linux e Windows, Node 22 e Node 26.13.1; o runner Windows executou os testes nativos CNG e o bundle portátil E2E.
- Regressão visual #474 (`43433249070`) passou com Chromium no mesmo HEAD.
- `SqliteMonotonicCheckpointJournal` persiste checkpoint metadata e prepare records em transações SQLite `BEGIN IMMEDIATE`, com reabertura e finalização idempotente.
- Limitação: não acrescenta ainda o evento/MAC ao journal de incidentes. O lock e anchor dos testes são fixtures; não existe provider TPM nem prova de rollback/power-loss físico.
- PR #85 em desenvolvimento: lock assíncrono partilhado entre writes do incident store e operações de checkpoint, host singleton Windows e teste de exclusão entre processos. A validação ainda está pendente.
- Próximos gates: integração transacional com evento/MAC real, lock de produção para todos os writers suportados, provider TPM 2.0, fault injection e validação física.


## Windows host lock stale-recovery hardening — PR #85

- [x] Identify a stale-lock reclamation race: two contenders could both read the same dead owner, then one could remove the lock file created by the other between stale-check and removal.
- [x] Serialize stale reclamation through an exclusive host.lock.recovery file; re-read the original lock and re-probe the owner while holding the gate.
- [x] Fail closed when a recovery gate already exists; do not automatically steal an ambiguous gate.
- [x] Add tests for stale-lock recovery, an existing recovery gate, owner recheck and replacement-safe release.
- [ ] Re-run Linux/Windows Node 22 and Node 26.13.1 CI, native Windows CNG/bundle E2E and visual regression on the final PR HEAD.
- [ ] Validate stale-lock recovery and interrupted-recovery handling on a physical Windows installation.

The new gate is a safety mechanism, not proof of arbitrary-process SQLite locking. A crash while the recovery gate is held can require operator inspection/removal after confirming that no host/recovery process remains.

## Current security/storage increment — 2026-11-13

- **PR #85 merged:** `988c78f7e876f862356f657285b5938bad1ceabb`; final PR HEAD `8700f3e27862387eaf0d4bb96989136d82cd9cfa`. CI #559 (run ID `43439223212`) and Chromium visual #479 (run ID `43439223186`) passed on that same final PR HEAD.
- Windows host lock stale-owner recovery now uses an exclusive sibling recovery gate and rechecks owner state while holding it. A stale recovery gate is deliberately not auto-removed after a crash. The mechanism protects the supported Office Kit host boundary, not arbitrary direct SQLite writers.
- **PR #86 merged:** `feat/security: bind incident events to monotonic checkpoints`. It added a synchronous prepared-payload applier so incident snapshot/event/HMAC/chain-head rows and checkpoint metadata are committed in one SQLite finalization transaction.
- PR #86 tests use real temporary SQLite files with WAL, `synchronous=FULL`, `BEGIN IMMEDIATE` and reopen-based recovery. The anchor is a test-only fake; no TPM/hardware-backed anchor has been implemented or validated.
- With the Windows host's incident-payload applier configured, the journal rejects sequence advancement without the recognized incident append payload and fails closed if the persisted prepare payload is removed before finalization. A generic journal without that applier remains metadata-only and does not anchor incident events.
- **At the time PR #86 was integrated:** a production TPM 2.0 provider, host-wide anchored mutation facade, live Windows TPM integration, power-loss/filesystem durability, backup/restore and physical-PC testing were still outstanding. PR #90 subsequently completed the public Windows host write-path integration; the TPM and physical-validation gates remain open.
- **PR #86 merged:** `edb7bd3c79051078141d54424bfcaccf249156c5`; final PR HEAD `8a98567d53e8f65ce351745047c46da18b691c11`. CI #571 and Chromium visual #491 passed on the same HEAD. Windows Node 22/26 jobs passed native CNG, DGM/VST vault integration, CNG incident journal restart and portable bundle E2E; Linux Node 22/26 passed. Initial CI #567 exposed an over-broad guard; the final code scopes it to journals configured with the incident applier and includes regressions.

## Current security/storage increment — 2026-11-13 (anchored writer core)

- Added `MonotonicIncidentWriter` in the generic scene-engine core. Its `append()` and `update()` methods call the monotonic checkpoint coordinator and return only after the final checkpoint is confirmed.
- Added prepared update payloads bound to the previous incident revision and SHA-256 digest of the predecessor snapshot. The applier rejects stale predecessor state before changing the incident snapshot.
- Extended the SQLite checkpoint journal to recognize both append and update payloads, require a single-sequence advance, and dispatch synchronous payload application inside the same SQLite finalization transaction.
- Updated the Windows host payload dispatcher to handle both mutation types. At the time of this core increment, the writer had not yet been installed as the public host facade; the follow-up branch dated 2026-11-14 adds that integration and remains subject to CI/visual validation.
- Added tests for create + update through a coordinator, unsupported-anchor fail-closed behavior, and predecessor-digest mismatch. Tests use real SQLite files/WAL when `node:sqlite` is available, but a fake anchor; this is not TPM evidence.
- PR #89 merged the generic append/update writer after CI and visual passed on final PR HEAD `b6c35155a68c3640030b255d937c5efe2bc89d51` (CI `43451943848`, visual `43451943880`). PR #90 integrated the writer as the Windows host facade. PR #91 then added real child-process termination tests before anchor advancement and after anchor advancement/before SQLite finalization. PR #91 squash merge is `419b45d4294509f1147b2d17375147cd15d1c0c9`; final PR HEAD `16256d4d6c01b0f652dd9694405a2d2cac23e944` passed CI `43601453827` and visual `43601453873`, with post-merge CI `43601790771` and visual `43601790788` passing on main. The file-backed anchor is test-only; TPM 2.0 and physical power-loss/backup-restore validation remain open. No anti-rollback production claim is made.


## 2026-11-14 — Windows host incident mutation facade (PR #90 merged)

- PR #90 was squash-merged as `009766a1aac5c237dc0720294c43c6aa18141f84` from final PR HEAD `f8771a29b9873e0e61b3701dd5931787abd52e4c`.
- CI run `43599933818` and Chromium visual run `43599933838` both passed on that exact PR HEAD. Post-merge CI run `43600154571` and visual run `43600154514` passed on the main merge commit.
- The Windows host exposes only a restricted incident-store facade. Public `append()` and `update()` route through `MonotonicIncidentWriter`; the raw store, prepare methods and checkpoint journal are not returned to callers.
- Office Health diagnostics use the same facade. Incident MAC-key rotation shares the monotonic journal exclusive lock.
- The default anchor provider reports `unsupported`; writes fail closed with `monotonic_anchor_not_protected`. Reads and integrity inspection remain available. There is no unanchored fallback.
- Startup compares a protected checkpoint with the keyed SQLite event-chain sequence/hash/MAC. A mismatch blocks startup/recovery rather than silently mixing histories.
- Tests use real SQLite/WAL and a test-only fake anchor. The fake's capability flags are fixtures, not TPM evidence. The default production path remains write-disabled until a trusted provider exists.
- No native Windows TPM 2.0 provider, physical TPM validation, power-loss proof, or physical-PC validation is claimed. The merge completes host write-path integration, not production anti-rollback readiness.
- The portable Universal Windows bundle includes the generic monotonic anchor contract, coordinator and writer modules. DGM-MAT/VST-specific adapters remain excluded from the Universal bundle. CI bundle E2E passed on the post-merge main commit.

## Current next gates

1. Implement a consented Windows TPM 2.0 provider with durable identity, clear/reprovision detection and verifiable atomic compare-and-advance; do not substitute CNG Software KSP or a fake.
2. Add process-kill fault injection at prepare/anchor/finalize boundaries, then multi-process contention and physical power-loss/backup/restore validation.
3. Keep writes fail-closed until the provider is trusted and physically validated.
4. Implement equivalent providers for Linux, macOS and Android before enabling protected writes on those platforms.


## 2026-11-14 — process termination recovery (PR #91 merged)

- PR #91 squash merge: `419b45d4294509f1147b2d17375147cd15d1c0c9`; final PR HEAD: `16256d4d6c01b0f652dd9694405a2d2cac23e944`.
- Pre-merge CI `43601453827` and Chromium visual `43601453873` passed on the same PR HEAD. Post-merge CI `43601790771` and visual `43601790788` passed on the main merge commit.
- CI matrix passed on Linux/Windows with Node 22 and Node 26.13.1. Both new process-termination scenarios passed in all four matrix jobs.
- Scenario A kills the child after the durable SQLite prepare and before anchor advancement; recovery discards the prepare and leaves event count/checkpoint unchanged.
- Scenario B kills the child after the test anchor advances and before SQLite finalization; recovery finalizes the incident event and checkpoint.
- The tests use real SQLite/WAL with `synchronous=FULL`; the anchor is a test-only file-backed fake. This is process-crash recovery evidence, not TPM, hardware-backed, power-loss or physical-PC evidence.
- Next gates: native TPM 2.0 provider, power-loss, backup/restore and physical TPM validation. The supported host-process contention test is recorded below.


## 2026-11-14 — monotonic writer host-process contention (CI and visual validated)

- Added `packages/windows-host/test/monotonic-writer-process-lock.test.mjs` to exercise the supported single-host writer boundary across independent Node processes.
- The first process acquires the real host singleton lock, opens a real SQLite/WAL database with `synchronous=FULL`, and commits one incident through `MonotonicIncidentWriter`. A second process attempts to acquire the same host lock while the first writer remains alive and must fail with `windows_host_already_running` before entering the writer boundary.
- After the first process exits, the test reopens the SQLite database and verifies one authenticated incident event, checkpoint sequence/hash/MAC agreement and no pending prepare.
- The monotonic anchor is an in-memory test fake. This validates the supported host process-exclusion boundary, not TPM behavior, arbitrary direct SQLite writers, power-loss durability or physical hardware.
- PR #93 test HEAD `782b587b4e26898400b44473dd53b64423416066` passed Linux/Windows Node 22 and Node 26.13.1 CI run `43603350677`; the test passed in all four matrix jobs. Chromium visual regression run `43603350684` also passed on the same HEAD. These results validate the supported host process-exclusion boundary only.


## 2026-11-14 — DGM-MAT local-session clock validation

- Added bounded clock validation to `DgmMatLocalSessionProvider`: invalid/throwing/non-finite/negative-zero/out-of-Date-range values fail closed before bootstrap access, and the expiry timestamp is checked before the access token is cached.
- `getState()` now evaluates a validated clock even when no token exists, avoiding a short-circuit that could hide invalid clock state.
- Added regressions for invalid clocks before bootstrap and a clock that becomes invalid after the session response but before expiry is stored.
- Code checkpoint `738cb1a128da855ef875d6a6f741006d98af9bdc` passed CI run `43604106904` (run #602) on Linux/Windows with Node 22 and Node 26.13.1; both new tests passed on Linux and Windows. Chromium visual run `43604106850` (run #522) also passed on that code checkpoint.
- Documentation synchronization is being added in this PR; its final HEAD must pass CI and visual regression independently before merge. This remains unit-level validation, not live DGM-MAT or physical-PC evidence.
