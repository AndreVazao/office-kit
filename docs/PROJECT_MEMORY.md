# Office Kit — memória persistente do projeto

Última atualização: 2026-11-07

## Produto e invariantes
- Office Kit é genérico e backend-independent; não pode depender de Sovereign Trader, DGM-MAT, Vercel ou Tailscale no core.
- Instalação local-first e privada por omissão. Cada cliente/organização mantém dados, configuração, identidade e armazenamento próprios.
- Federação é opcional e só ocorre entre nós explicitamente autorizados da mesma organização.
- Descoberta automática não é autorização. Um peer descoberto nunca recebe acesso operacional sem identidade criptográfica verificada e aprovação.
- O utilizador não deve configurar IPs, portas ou DNS. Onboarding deve ser guiado; consentimento/login de terceiros continua explícito.
- Separar descoberta (LAN/mDNS, overlay, diretório/rendezvous) de transporte (overlay privado, ligação direta ou relay dedicado).
- Tailscale é provider opcional; usar instalação já autenticada/MagicDNS quando disponível. Nunca embutir chaves/segredos administrativos ou alterar tailnet sem consentimento.
- Vercel pode alojar portal/API/diretório e leases curtas, mas não é VPN nem relay genérico. Serviço de rendezvous não transporta por si só o tráfego peer-to-peer.
- Sem Internet ou transporte, cada nó continua local e os estados remotos ficam stale/disconnected.
- Backend local continua autoritativo; a cidade virtual é uma projeção agregada. Animações não confirmam transferências operacionais.

## Estado Git
- PR #14 foi squash-merged em 2026-11-03 após CI e regressão visual concluírem com sucesso no HEAD final 04dd35c60f71e9567035940758f9412ccf31dc60.
- Merge commit: 0096a19c541e7ac3354934652bb8d0a22d4a1e7f.
- PR #15 foi squash-merged em 2026-11-03 após CI e regressão visual concluírem com sucesso no HEAD 30e6727aae66e8aef0ba295c745be00a53d6472f.
- Merge commit: bffe8f06b169ca484e66385d452b9ad831eb2b9e.
- PR #16 feat/node-identity-security foi squash-merged após CI e regressão visual passarem no HEAD 08b146cd39dbd02944d272a43756c15a2db43352.
- Merge SHA do PR #16: 56be1b0bebdbcf5d42ede6445f18496019521b55.
- PR #17 `docs: define production secure node storage requirements` foi squash-merged em 2026-11-03; merge SHA `e31bccafa4223689c44b1cb25faa0bd250798b53`.
- `main` foi validada em 2026-11-07 no squash merge `2d9c4cbcdeeddcfa718d736ef3a04ce9f39b44ab` do PR #41; CI e regressão visual pós-merge passaram nesse SHA.
- PR #42 `feat/identity-algorithm-agility` foi squash-merged em 2026-11-07; merge SHA `5212c3044bf890cc924180c6030012d55647d5f9`. `main` ficou nesse HEAD e CI/visual pós-merge passaram.
- PR #16 adicionou NodeIdentityManager, prova Ed25519 de posse, rotação/revogação e testes; provider efémero continua exclusivo de testes.
- `docs/SECURE_STORAGE.md` especifica persistência segura por plataforma; continua a ser especificação, não um provider implementado.

## Implementado e integrado — contratos de federação v1
- Contratos abstratos DiscoveryProvider, PrivateTransportProvider, OrganizationDirectoryProvider.
- Validação de descriptor público de nó: organizationId, nodeId, fingerprint SHA-256, protocolVersion e capabilities.
- Validação de hints LAN/Tailscale/HTTPS/relay com HTTPS obrigatório para endpoints remotos.
- Leases de descoberta com origem permitida, validade máxima configurável (120 s por omissão), expiração e hints únicos.
- Envelope de evento de federação schema v1 com identidade do nó, sessão, sequência, timestamp e payload.
- Testes unitários para validação, rejeições e interfaces abstratas.

## Implementado e integrado — identidade criptográfica (PR #16)
- NodeIdentityManager com identidade Ed25519 por nó, fingerprint SHA-256, desafios nonce com validade máxima de 60 segundos, assinatura e verificação de prova de posse, rotação e revogação.
- Fronteira NodeKeyStoreProvider e metadataStore injetável; EphemeralEd25519KeyStore serve apenas para testes/sessões efémeras e NÃO é armazenamento persistente de produção.
- Testes cobrem criação, escopo, prova/tampering/expiração, rotação e revogação. O CI e regressão visual do PR #16 passaram no HEAD final antes do merge.

## Incremento local em curso — 2026-11-03
- Branch local: `feat/identity-storage-lifecycle`; ainda não publicada nem aberta em PR.
- `NodeIdentityManager` passou a exigir `NodeKeyStoreProvider.hasKey/getCapabilities` e `metadataStore.compareAndSet` com revisão monotónica; rejeita providers efémeros e chaves privadas exportáveis fora do opt-in explícito de testes.
- Criação limpa a nova chave se a gravação de metadados falhar; rotação muda primeiro a identidade ativa e mantém IDs de chaves antigas pendentes até limpeza; revogação grava o tombstone antes de apagar a chave.
- `reconcile()` retoma limpezas pendentes e marca uma chave ativa ausente como `identity_unavailable`, sem regeneração silenciosa. Inclui compatibilidade com metadados antigos sem campo `revision`.
- Testes de identidade: 14/14 aprovados. Suite completa local `npm run check`: 95/95 aprovados; `git diff --check` limpo. CI e regressão visual desta branch ainda não executados.

## Não implementado
- Keystore de produção integrado ao armazenamento seguro do sistema operativo/browser e metadataStore persistente.
- Autenticação mútua, convite/aprovação de peers e autorização granular após a prova de posse já implementada.
- Descoberta LAN/mDNS real.
- Integração Tailscale real ou deteção do daemon/CLI.
- Diretório/rendezvous HTTP e deploy Vercel ou alternativo.
- Transporte P2P, relay e sincronização.
- UI de onboarding, cidade agregada e federação multi-computador.
- Avatar Studio, geração por fotografia, instalador de renderers adaptativos e renderer 3D avançado.

## Próximos passos
1. Validar o endurecimento do ciclo de vida de identidade na branch `feat/identity-storage-lifecycle` com a suite completa, CI e regressão visual antes de abrir/mergear PR.
2. Implementar primeiro um provider persistente de keystore e metadata store para Windows, sem exportar chaves privadas; nunca usar o provider efémero em produção.
3. Definir convite de organização e protocolo de aprovação com expiração, nonce, proteção replay e autorização granular.
4. Implementar primeiro provider LAN/mDNS atrás dos contratos e sem aceitar automaticamente peers.
5. Implementar provider Tailscale opcional, read-only para deteção inicial, sem gerir credenciais.
6. Definir API rendezvous HTTPS com leases curtas e metadados mínimos; adaptar para Vercel ou self-host sem acoplamento ao core.
7. Implementar transporte privado e só depois agregar snapshots/eventos na cidade virtual.
8. Manter documentação Architecture, Roadmap, Implementation Status e esta memória sincronizadas em cada PR.

## Regra de comunicação
Nunca declarar funcionalidade implementada, testada, publicada ou merged sem confirmação objetiva no GitHub e/ou execução de testes no SHA referido.


### Registo de validação PR #16
- Primeira execução CI falhou em cinco testes devido a `Crypto.randomUUID` ter sido passado como método desligado do respetivo receiver (`ERR_INVALID_THIS`).
- Corrigido o provider e fixture de teste para invocar `randomUUID()` através da instância Crypto.
- Regressão visual passou na primeira execução; CI foi corrigido e aguarda nova execução no HEAD `0681e2ccfb83f96cd2b9f91a45085539cbe0032c`.


## Decisão de produto — três edições no mesmo core (2026-11-04)
- Universal: edição pública genérica, backend-independent e sem dependências de DGM-MAT/VST.
- DGM-MAT: edição pessoal para a instalação ligada ao backend DGM-MAT, com adaptador próprio.
- VST: edição pessoal para a instalação ligada ao VazaoSovereignTrader, com adaptador próprio.
- As três usam o mesmo core; DGM-MAT e VST são instalações distintas com IDs/namespaces, configurações, credenciais, dados e memória isolados.
- A edição Universal não contém allowlist de adaptadores pessoais. A edição DGM-MAT permite `dgm-mat`; VST permite `vazao-sovereign-trader`.
- Perfis nunca fazem auto-connect. O proprietário configura e autoriza a ligação; modo inicial read-only.
- Branch ativa: `feat/product-editions-profiles`; implementação inicial em `packages/scene-engine/src/product-profile.mjs` e testes em `packages/scene-engine/test/product-profile.test.mjs`.
- Limite atual: perfis/allowlists/namespaces são implementados como contrato. Persistência por namespace, keystores de produção, instalador e adaptadores reais DGM-MAT/VST ainda não estão implementados.

- `docs/PERSONAL_BACKEND_ADAPTERS.md` mapeia rotas de leitura e autenticação reais encontradas nos repos DGM-MAT e VST. Regista que DGM-MAT usa sessões bearer curtas e bootstrap apenas loopback (pairing remoto separado), enquanto VST protege `/status` e diagnósticos com token local e o shell documenta `X-Token`. WebSockets DGM-MAT atualmente sem autenticação não serão usados. Nenhum dos dois adaptadores foi ainda implementado; primeira fase será GET-only/read-only.


## Workflows de build por edição — 2026-11-04
- Adicionados três pipelines separados: Universal, DGM-MAT e VST, no branch `feat/product-editions-profiles` / PR #19.
- Os pipelines usam exclusivamente `workflow_dispatch`, com concorrência serializada por edição e sem cancelamento de execução em curso. Não há gatilho automático por push, PR, schedule ou release.
- Todos validam o core com `npm run check`, executam `scripts/build-edition.mjs` para o perfil específico e publicam `edition-manifest.json` + pacote `npm pack` como artifact de 14 dias.
- Os manifests não incluem credenciais, installationId nem storageNamespace reais; esses valores serão provisionados por instalação.
- Os artifacts atuais são pacotes de código-fonte perfilados, não instaladores nativos nem adaptadores backend funcionais.
- A política é disparar os builds manualmente apenas em marcos de desenvolvimento, antes de validar uma edição ou preparar um artifact para teste. Não os executar em cada commit.
- Corrigido no branch o teste `product-profile.test.mjs` que continha caracteres `\
` literais e provocava SyntaxError na CI anterior.


## DGM-MAT adapter — incremento 2026-11-04
- Branch ativo: `feat/dgmat-readonly-adapter`, criado a partir do merge `d0471453dfa890b83cd67acb0a83360c36cd9319` do PR #19.
- Primeiro adaptador em `packages/scene-engine/src/dgmat-readonly-adapter.mjs`, API v1, `read_state` apenas. Loopback HTTP only; GET allowlist `/runtime/status` apenas; token de sessão fornecido por provider injetado; timeout, `no-store`, redirect error, polling serializado e sem escrita.
- O adaptador não acede ao bootstrap token do DGM-MAT, não inicia sessões, não faz pairing e não persiste tokens. Host secure-session provider ainda por implementar.
- A rota `/runtime/status` atual não oferece source timestamp/watermark de sincronização verificável. O snapshot é deliberadamente `synchronizing` e não confirma atividade de agentes/tarefas. Não contornar esta limitação com timestamps locais.
- Testes em `packages/scene-engine/test/dgmat-readonly-adapter.test.mjs`. CI/visual PR ainda pendentes; live E2E aguarda PC/keystore/provider.
- Próxima prioridade: concluir e verificar este PR, depois implementar provider de sessão seguro/keystore e obter freshness watermark; só então validar a integração no DGM-MAT ativo. VST adapter virá em incremento separado.


## DGM-MAT endpoint security hardening — 2026-11-04
- PR #20 merged (`6c5f8ed088741dacc667c96775f7806edb10500d`): initial read-only DGM-MAT adapter.
- PR #21 branch `fix/dgmat-loopback-endpoint-hardening`: restrict endpoint to HTTP loopback port 8181 and root URL only; remove unused health route from allowlist; add tests for alternate ports, paths, query, credentials and HTTPS.
- The session provider/OS keystore and authoritative source freshness contract remain outstanding. No live PC E2E claim.


## DGM-MAT local session provider — 2026-11-04
- New branch `feat/dgmat-local-session-provider` implements `DgmMatLocalSessionProvider` for the documented `POST /auth/session` contract.
- Bootstrap credential is supplied by an injected host keystore provider, used only for loopback exchange, and never cached by Office Kit; access token remains memory-only and is refreshed before expiry.
- 401/403 from the read-only adapter invalidates the injected session cache. Added unit tests for endpoint restrictions, request contract, concurrent exchange, expiry, invalidation and fail-closed responses.
- Still missing: concrete Windows CNG/DPAPI/credential-vault bridge to retrieve the protected DGM-MAT bootstrap credential, process-host wiring, and live PC E2E. Do not claim DGM-MAT connection is operational.


## Comercialização e licenças — 2026-11-04
- PR em desenvolvimento: `feat/offline-commercial-licensing`.
- Core passa a definir entitlement versionado, edição/plano, features, validade UTC, licença perpétua (`expiresAt: null`), limite de instalações e envelope Ed25519.
- Verificação de assinatura é injetada pelo host e deve usar chave pública confiável/pinned; a chave privada nunca pertence ao cliente nem ao repositório.
- Limites de postos exigem registry persistente e atómico no host. Contadores enviados pela UI não são autoridade.
- Modelo comercial proposto: Personal 1 instalação, Small Team até 10, Business até 50, Enterprise por volume negociado; compra perpétua com política explícita de updates/suporte. Serviços geridos podem ser recorrentes e separados.
- Assinatura Android/Windows é distinta da assinatura de licença. AAB + Play App Signing para Google Play; Authenticode para Windows. Não existem ainda apps nativas, chaves de produção, pipeline de signing, checkout, emissão de licenças ou billing.
- PR #22 integrada no merge `69946aaa01f22ab243dd0b785dd1dff5b190c2f5` após CI e visual regression verdes no HEAD `0558cf75206a012b3510807a6f38c545b597edb4`.


## Ativação de licenças — 2026-11-05
- Branch `feat/license-activation-registry`: `LicenseActivationRegistry` adiciona ativação idempotente, limite de instalações dentro de transação atómica, desativação idempotente e listagem sem expor fingerprint de hardware.
- O store de produção tem de oferecer transação durável, atómica e serializável por licença, partilhada entre processos/máquinas. O store em memória existe apenas nos testes; não é adequado para produção.
- Identidade da máquina é representada por installationId opaco e SHA-256 fingerprint; nunca recolher serials/MAC/raw hardware IDs. A ativação multi-PC não funciona offline sem autoridade/registry partilhado.
- Endurecido parsing de datas UTC da licença para rejeitar datas impossíveis e anos bissextos incorretos.
- PR #23 integrada em `b148721e83ecad67224bf5f9dce8e79b05c6afa2`; CI e visual regression verdes no HEAD `97956d8be622870eca9632c625efacd5a72547fc`.
- Continua em falta: store persistente de produção, providers nativos Windows/Android, serviço emissor de licenças, checkout e aplicações instaláveis.


## SQLite real — integração inicial em curso (2026-11-07)
- PR #27 `feat/sqlite-activation-store-boundary` foi integrada após CI e regressão visual verdes no HEAD `f9ed10688eebc37bee2106f5bb5f25592d8d2530`; merge commit `e69fa502e62ab6c15ed489a3542faed03c1db026`.
- PR #28 `fix/sqlite-noop-write-semantics` foi integrada após CI e regressão visual verdes no HEAD `b929dfc6099dcd4cfef1f30cc4dc88f6eb242320`; merge commit `02888d49fe372975245f7dbfaa4ee4d38eabc4b5`.
- PR #29 `fix/sqlite-mutation-detection` foi integrada após CI e regressão visual verdes no HEAD `58e386d4fb2e8bcb4f75157cc03ceef33df252df`; merge commit `57084a20d18482fbec08148622672add68ee773e`.
- A store SQLite agora deteta alterações por comparação de snapshots JSON antes/depois, incluindo mutações in-place, e evita UPSERT em transações sem alterações.
- Branch ativa: `test/real-sqlite-driver-integration`. Adiciona testes de integração com `node:sqlite` real em ficheiro temporário: persistência após fechar/reabrir conexão, mutação in-place e rollback de estado inválido.
- CI passa a usar Node.js 22 para executar os testes reais `node:sqlite`. O core mantém `engines.node >=20`; nos runtimes sem `node:sqlite`, apenas estes testes de integração são ignorados. A regressão visual continua independente.
- Estes testes ainda aguardam CI. Não demonstram ainda concorrência entre processos, crash recovery, encriptação/ACLs do sistema operativo, backups, nem provider nativo de produção.
- Próximo passo após validação: endurecer persistência e identidade por plataforma, começando por Windows, e integrar o host nativo; não declarar o produto instalável enquanto esse host e os instaladores não existirem.


## SQLite integration validation — atualização 2026-11-07
- PR #30 `test: validate activation persistence with real SQLite` integrada em `907b6a9b5ebead7aba116c8dcd40c982e5d0372c`, após CI e regressão visual verdes no HEAD `1b9cd9665edf59feffc59465f2223136901eab3c`.
- PR #31 `test: cover SQLite multi-connection locking` integrada em `54c4401dfd89573f4092d59bbfc4a9ecdcdda5e2`; CI e regressão visual verdes no HEAD `5db6a11822cc200ad02d3745cc992dc84af2a7eb`.
- PR #32 `test: verify SQLite locking across processes` integrada em `da10294556fc51bc1a23caa0b8f85e78fbd38ac3`; CI e regressão visual verdes no HEAD `25107e411c940cf443de1e969d0334b4473b4d11`.
- A integração usa o motor SQLite real de `node:sqlite` em ficheiros temporários. O adaptador de teste aproxima a API `transaction().immediate()`; não é um teste do driver better-sqlite3 nem de um host nativo.
- Os testes provam persistência após reabrir a base, rollback de estado inválido, bloqueio entre conexões e exclusão de escritores em processos Node.js separados. Não provam crash/power-loss recovery, ACL/encriptação do SO, backup/restore ou keystore nativo.


## Persistência de metadados de identidade — 2026-11-07
- PR #33 `feat: persist node identity metadata in SQLite` integrada em `10f386081118c0951ac23deeeedba5b83af1156e`.
- HEAD validado da PR: `737adf3aeeea804a278d60dd81792226f5adbea3`; CI e regressão visual passaram nesse SHA. CI e regressão visual de push também passaram no merge commit `10f386081118c0951ac23deeeedba5b83af1156e`.
- `SqliteNodeIdentityMetadataStore` persiste apenas metadados públicos e handles opacos, com isolamento por `installationId`, transação imediata, compare-and-set monotónico e rejeição de JSON/revisões/scope inconsistentes. Chaves privadas não são guardadas na base.
- O host continua responsável pelo driver e ficheiro SQLite, ACLs, cifragem, backup e keystore do sistema operativo.
- PR #36 integrada por squash em `e68e9ee434ab9a6af7b0a6e9b73de318da4065c1`; HEAD final validado `4a95875df759c7df37701568a5910bd7abb62125`, CI run `42381571495` e visual run `42381571523` ambos verdes. A suite usa import dinâmico de `node:sqlite` e mantém Node 20 suportado, ignorando apenas os testes que exigem o módulo ausente. O teste de lifecycle usa `EphemeralEd25519KeyStore` no mesmo processo; não prova persistência de chaves após reinício do processo/SO.


## SQLite identity lifecycle integration — 2026-11-07
- PR #33 integrada: HEAD `737adf3aeeea804a278d60dd81792226f5adbea3`; CI e regressão visual passaram no mesmo SHA; merge `10f386081118c0951ac23deeeedba5b83af1156e`.
- `SqliteNodeIdentityMetadataStore` persiste metadados públicos e handles opacos, com isolamento por installationId e CAS revisionado. Chaves privadas nunca entram na base.
- O teste de ciclo de vida cobre reabertura da DB e recriação do manager ao longo de create/prove/rotate/reconcile/revoke. O keystore de teste é efémero e partilhado no mesmo processo; não simula reinício do SO nem prova keystore persistente.


## SQLite crash recovery — 2026-11-07
- Branch `test/sqlite-node-identity-crash-recovery` acrescenta teste com SQLite real em WAL: processo filho executa a atualização dos metadados dentro de transação imediata e é terminado antes do commit.
- Após reabertura, o teste exige que o último estado confirmado permaneça, que a escrita não confirmada desapareça e que `PRAGMA integrity_check` seja `ok`.
- PR #37 integrada por squash em `9cc92f3ed6be21d1140ce9fe76f843d5186fc9b4`; CI run `42382078748` e visual run `42382078743` passaram no HEAD `6b99b093a0912d705cea551f8bcf3e020ef584ab`. É evidência de recuperação após terminação do processo, não de power-loss físico, falha do armazenamento, backup/restore, ACLs ou cifragem.


## 2026-11-07 — proteção contra replay da identidade
- PR em desenvolvimento: `feat/identity-challenge-replay-protection-v2`.
- `NodeIdentityManager.provePossession()` consome cada nonce antes de assinar e rejeita reutilização.
- `SqliteNodeIdentityChallengeStore` oferece consumo atómico entre processos; `InMemoryNodeIdentityChallengeStore` é apenas efémero.
- Configuração com keystore persistente exige challenge store persistente.
- O verificador remoto continua responsável por aceitar cada challenge uma única vez do seu lado. Não declarar segurança de federação completa com esta proteção isolada.


## CI Windows/Linux — 2026-11-07
- Branch `ci/validate-sqlite-on-windows-v2` acrescenta runner `windows-latest` à suite Node.js 22, mantendo `ubuntu-latest`.
- A primeira execução Windows expôs uma conversão incorreta de file URL no teste multi-processo SQLite: o caminho resultava em `D:\\D:\\...`. Corrigido com `new URL(...).href`.
- Primeiro HEAD corrigido do PR #41 (`f8e84462e4c7533b22a528bbeb4a50f7ebf1f40b`): CI run `42383194963` passou em Linux e Windows; visual run `42383194951` passou e gerou artifact `13578905427`. O crash recovery e o locking multi-processo passaram nos dois sistemas após a correção do file URL. Esta evidência é histórica desse SHA; o HEAD final após atualizações documentais tem de voltar a passar antes do merge.
- CI Windows não substitui hardware físico, host/instalador, CNG/DPAPI, ACLs ou assinatura.


## Atualização de 2026-11-07 — validação Windows e agilidade de algoritmo
- PR #41 ci/validate-sqlite-on-windows-v2 foi squash-merged após revalidação imediata do HEAD afbae1a07730509175c3e1d9742d76e4019e12a2: CI run 42383828000 passou em windows-latest e ubuntu-latest, e regressão visual run 42383827922 passou. Cada runner executou 147 testes, com 147 pass, 0 fail e 0 skipped; os testes incluíram SQLite real, writers/processos independentes e WAL crash recovery. Artifact visual 13578343670 contém seis capturas desktop/landscape/portrait, com e sem chat.
- Squash merge SHA de PR #41: 2d9c4cbcdeeddcfa718d736ef3a04ce9f39b44ab. Após o merge, CI run 42383940775 e visual run 42383940809 passaram no próprio SHA de main.
- Inspeção manual das capturas: layout e painel de chat renderizam nos três viewports; o edifício continua pequeno na vista geral portrait e os avatares permanecem placeholders CSS. Não é regressão introduzida por PR #41 e continua como dívida visual.
- O CI Windows é runner nativo Windows, não teste de instalação/desinstalação numa máquina física. SQLite Node continua a emitir aviso de funcionalidade experimental; actions/checkout e setup-node emitem aviso de runtime Node 20 deprecado.
- PR #42 foi squash-merged após CI run `42384699834` e visual run `42384699857` passarem no HEAD `650e63a417dfca36483d20bdbde2d945542ee1b2`. Os dois runners executaram 150/150 testes, 0 falhas e 0 skips; o teste adicional confirma que metadados legados sem algoritmo continuam Ed25519 e não migram silenciosamente para P-256. Merge SHA `5212c3044bf890cc924180c6030012d55647d5f9`; CI pós-merge `42384818786` e visual pós-merge `42384818767` passaram no mesmo SHA de main. EphemeralP256KeyStore continua apenas para testes; nenhum provider persistente nativo foi implementado.
- PR #25 feat/adapter-runtime-bridge permanece draft e divergiu de main (7 commits ahead, 25 behind no último compare). O seu AdapterRuntimeBridge parece sobreposto pelo AdapterGateway já integrado; não fazer merge direto. Reconciliar o comportamento único e os testes antes de decidir fechar ou recuperar a branch.
- Universal continua sem dependência obrigatória de DGM-MAT/VST. Os perfis DGM-MAT e VST mantêm allowlists e namespaces próprios; o adaptador DGM-MAT existe em modo read-only e o adaptador VST concreto continua por implementar.


## Atualização de 2026-11-07 — provider CNG Windows integrado
- Branch `feat/windows-cng-p256-keystore` parte do main `007e3a73370a4e78f03ffba0013852e113c9a8c1` após PR #43.
- Implementação em curso: helper .NET com Microsoft Software Key Storage Provider, `CngExportPolicies.None`, ECDSA P-256, key names delimitados por installation ID e provider Node com bridge por processo.
- PR #44 integrada por squash em `6d9d8498a5e965e18eb6edf221bebb8b5f2bf8df`. HEAD final `e04c9a4a9e00a5d39b9c1aa982186403dfed1877`: CI `42420915287` verde em Windows/Linux e visual `42420915296` verde no mesmo SHA. O job Windows publicou o helper e passou na integração CNG persistente entre processos, export refusal, sign/verify, delete e isolamento de instalações. Pós-merge main CI `42421035235` e visual `42421035019` também verdes.
- O provider declara software/OS-protected e `hardwareBacked=false`; não o confundir com TPM. SQLite metadata/challenge store continua separado e fornecido pelo host.


## 2026-11-07 — isolamento do provider CNG por plataforma
- A primeira regressão visual da PR #44 expôs que exportar `WindowsCngP256KeyStore` pelo `scene-engine/src/index.mjs` contaminava o browser com módulos Node (`child_process`, `crypto`, `path`), impedindo o carregamento do escritório.
- Corrigido: provider Windows é exportado apenas por `scene-engine/src/windows.mjs`; o índice genérico permanece browser-safe. A alteração deve ser validada novamente em CI e regressão visual no mesmo HEAD.
- O runner Windows já compilou o helper CNG e passou no teste de persistência entre processos, assinatura/verificação, recusa de exportação e isolamento entre instalações no HEAD anterior `1f4c1b78bb74bab823e527b746def53cf36c4035`. Não confundir com validação física no PC do utilizador.


## 2026-11-07 — recuperação de trabalho antigo de Adapter Runtime Bridge
- Branch de recuperação: `feat/recover-adapter-runtime-bridge-hardening`.
- A branch antiga `feat/adapter-runtime-bridge` continha 7 commits exclusivos, mas PR #25 estava em draft, apontava para base de recuperação antiga e não era mergeável. PR #10 anterior também estava encerrada sem merge.
- Em vez de duplicar `AdapterRuntimeBridge`, foram portados para o `AdapterGateway` existente os comportamentos de segurança que faltavam: buffer limitado de eventos durante startup, sequência contígua, sessão fixa, fail-closed para lacunas/troca de sessão/eventos incrementais não suportados, cleanup em erro e reset no reconnect.
- PR #44 integrada em `6d9d8498a5e965e18eb6edf221bebb8b5f2bf8df`: CNG Windows nativo validado em runner Windows, provider isolado em `windows.mjs`, índice genérico/browser safe. Próximo incremento ativo é recuperação do gateway.


### Windows identity runtime factory — validação PR #46
- PR #46 adiciona `createWindowsNodeIdentityRuntime`, exportada exclusivamente por `packages/scene-engine/src/windows.mjs`. O entrypoint genérico/browser mantém-se livre de imports nativos Node.
- HEAD validado: `77669de98b42bdc6bcf1d866797cc6ef1a066707`. CI `42483528564` passou em Linux/Windows; no runner Windows foram publicados o helper .NET e executados com sucesso os testes CNG e runtime identity (1/1 cada). Regressão visual `42483528517` passou no mesmo SHA e gerou seis capturas (artifact `13618816020`), sem erros de browser.
- A integração cobre create/prove, fecho/reabertura SQLite, recriação do manager, persistência da identidade, replay rejection e revoke. A persistência CNG entre processos helper foi validada separadamente na PR #44. Não foi testado restart do processo host nem do sistema.
- O host continua dono da conexão/ficheiro SQLite, ACLs, cifragem, backups, instalação do helper e lifecycle. O Microsoft Software KSP é OS-protected/software-backed, nunca declarar TPM/hardware-backed.
- Próximo bloqueio: construir o host/launcher Windows e instalador, definir ACL/backup/restore, validar instalação/desinstalação e executar teste no PC físico. Providers macOS, Linux, Android e browser persistente continuam pendentes.


### Windows runtime integration contract
- The Windows runtime factory is composed and exported only from `windows.mjs`. The host owns the SQLite connection, per-installation database path, ACLs, helper signature/trust, backups, shutdown and uninstall retention choice.
- `docs/WINDOWS_NATIVE_RUNTIME_INTEGRATION.md` records the host lifecycle and security boundary. The native test now includes rotation and old-key cleanup across database reopen.
- CNG Software KSP remains OS-protected, not TPM-backed. Desktop launcher/installer and physical-PC validation remain outstanding.


### Windows identity rotation — PR #48
- PR #48 acrescenta rotação real ao teste composto CNG + SQLite: valida nova geração/keyId/fingerprint, remoção da chave antiga, persistência após reabrir a base, prova com a nova chave, replay rejection da challenge anterior, revoke e reconciliação após nova reabertura.
- Code HEAD `1b856195ada69de5fbb0ab64b7c82d736aafdacb`: CI `42484745984` passou em Linux/Windows; integração Windows explícita 1/1. Visual `42484745951` passou, seis screenshots no artifact `13618319943`, sem erros de browser.
- O novo `docs/WINDOWS_NATIVE_RUNTIME_INTEGRATION.md` define a fronteira do futuro host: startup/reconcile, health, SQLite/ACL, trust do helper, shutdown e política explícita de retenção no uninstall. Não é um host instalado.
- Próximo bloqueio: implementar launcher/host e instalador, testar cleanup interrompido, ACL/assinatura/backup/restore, upgrade/uninstall e PC físico. Não declarar o produto pronto.


### Windows cleanup recovery — PR #50
- PR #50 testa dois caminhos de falha: delete da chave antiga falha após commit de rotação; delete da chave ativa falha depois de gravar o tombstone de revoke. Em ambos os casos, SQLite é fechada/reaberta, o manager é recriado e `reconcile()` recupera o estado com o helper CNG real.
- Code HEAD `2d62835a4e2e58187205b523b4b4bb27feb21155`: CI `42485145796` passou em Linux/Windows; no runner Windows, 2/2 cenários compostos e o teste CNG 1/1 passaram. Visual `42485145823` passou com seis capturas e sem erros de browser.
- As falhas são injetadas no método do provider; não provam falha real de ACL, disco, CNG/OS, perda de energia ou restart do host. Continuam pendentes launcher/installer, ACL/backup/restore e validação física.

### Windows local host runtime — incremento em desenvolvimento
- Branch `feat/windows-native-host-lifecycle-v2` cria o primeiro composition root local Windows: diretório privado, ACL por SID, installation ID persistente, lock de processo, SQLite WAL/FULL, verificação Authenticode do helper, factory CNG+SQLite, reconcile e health.
- O CLI oferece apenas ações locais explícitas: health/create/rotate/revoke; startup não cria identidade nem abre rede.
- Testes automatizados usam SQLite real e injeção para runtime/ACL/trust. Não equivalem a validar ACLs do Windows, certificado de distribuição ou PC físico.
- Bloqueio para execução real: helper CNG precisa de assinatura Authenticode confiável; o artefacto CI ainda não está assinado. Sem MSI/MSIX, assinatura de release, upgrade/rollback e backup/restore, não declarar instalável.

### Windows host ACL/trust integration — em validação
- Branch `test/windows-host-acl-integration` acrescenta teste nativo Windows com SID do utilizador real, ACLs verificadas por `icacls` e icacls para diretórios e ficheiros de dados.
- Inclui teste real de rejeição Authenticode para helper sem assinatura; o cenário ACL injeta somente a confiança do helper.
- Aguardam-se CI e regressão visual no mesmo HEAD; PC físico e release assinada continuam pendentes.

- A validação real no Windows detetou e corrigiu uma falha na ACL: permissões herdáveis são usadas apenas em diretórios; ficheiros recebem permissões diretas. Aguardam-se novos resultados CI no HEAD atualizado.

### Windows host startup reconciliation — em validação
- Branch `fix/windows-host-startup-reconcile` garante reconcile antes de mutações. `host.ready` é aguardado pelo CLI e pelas operações manager; erro de recovery bloqueia mutações e não deixa DB/lock abertos.
- Testes verificam ordem e fail-closed. CI/visual no HEAD final ainda pendentes.

- A reconciliação de startup não basta apenas terminar sem exceção: só `empty`, `active` e `revoked` autorizam mutações. `cleanup_pending` mantém health degraded, oculta identidade e bloqueia create/rotate/revoke.

### Portable Windows bundle — em desenvolvimento
- Branch `feat/windows-portable-host-bundle` adiciona builder PowerShell e teste end-to-end no runner Windows. O pacote inclui node.exe, scene-engine, windows-host e helper CNG.
- CI usa certificado efémero Code Signing, confia-o apenas no runner, assina o helper e testa create/reopen/rotate/revoke em processos separados.
- Não é release assinada para utilizadores nem MSI/MSIX; signing comercial, instalação, upgrade/uninstall e PC físico continuam pendentes.
## Decisões de produto — diagnóstico, recuperação e simulação social adaptativa (2026-11-09)

### Office Health & Recovery Engine
- O Office Kit deve diagnosticar falhas de comunicação separando runtime do Office Kit, adaptador, transporte/rede e backend.
- Os diagnósticos distinguem causa confirmada, causa provável e causa indeterminada. Timeout isolado não prova culpa do backend nem do Office Kit.
- Cada incidente gera registo persistente e exportável: ID, timestamps, versão/edição, adaptador/backend, última comunicação confirmada, testes e evidências, origem/confiança, impacto, reparações tentadas, duração e resultado.
- Nunca guardar tokens, palavras-passe, headers secretos ou payloads sensíveis nos relatórios. Logs devem ser protegidos contra alteração acidental e ter política de retenção/exportação explícita.
- Recuperação automática limitada e segura: validar configuração; redescobrir apenas fontes autorizadas; verificar endpoint/porta; reiniciar apenas o adaptador local quando seguro; renovar sessão pelos providers autorizados; reconectar; exigir snapshot completo e consistente antes de declarar recuperação.
- Não alterar credenciais, contornar autenticação, executar operações de escrita no backend nem reiniciar serviços externos sem autorização explícita.
- Falhas internas do Office Kit devem gerar relatório local para suporte e permitir auto-recuperação segura. Falhas externas devem ser atribuídas apenas com evidência suficiente.

### Social Simulation Engine e atividade real
- O escritório permanece visualmente vivo sem backend através de simulação social local pseudoaleatória, com decisões e durações variáveis, destinos, deslocações, interações e atividades como trabalhar visualmente, pausas, café, varanda, conversas e circulação.
- Repetição de atividades é permitida; não há uma rotina fixa sincronizada. Seed determinística é permitida exclusivamente para QA/reprodução de bugs.
- Simulação nunca é apresentada como trabalho real. Banner/estado persistente identifica explicitamente offline e movimento social simulado.
- Se uma ligação previamente funcional cair, a tarefa real fica interrompida/desconhecida e o incidente é registado. A simulação pode continuar sem apagar o histórico ou declarar tarefas concluídas.
- Backend detetado mas com falha confirmada coloca o agente/departamento afetado em enfermaria; backend ausente/não configurado usa estado offline, não enfermaria.
- Atividade real e progresso só podem ser mostrados a partir de dados/eventos reais e frescos do adaptador. Sem progresso fornecido pelo backend, não inventar percentagens nem barras.

### Adaptive Rendering — preservar comportamento, reduzir fidelidade
- Hardware fraco deve reduzir fidelidade/custo de renderização, não remover atividades, interações ou semântica da simulação social.
- Um único modelo de comportamento e cena alimenta vários renderers/níveis: 3D avançado, low-poly, pixel e mínimo/retro. Cada nível preserva caminhar, sentar/levantar, interagir com computador/quadro, pausas, conversas e deslocações; a representação usa menos polígonos, texturas, efeitos ou frames quando necessário.
- Separar relógio/simulação da taxa de frames do renderer: a lógica social continua a progredir mesmo com FPS baixo.
- Deteção e reavaliação de CPU, RAM disponível, GPU/VRAM/capacidades gráficas, OS, armazenamento, resolução e frame time; perfis são políticas de recursos, nunca limites de funcionalidades ou de edição.
- Ajustar qualidade, pixel ratio, sombras, iluminação, texturas, LOD, frequência de render e concorrência gráfica com histerese. Perfil manual pode sobrepor Auto. Recuperar qualidade quando houver recursos.
- Orçamentos do renderer e backend são separados para que o escritório não prejudique o backend anfitrião.

### Subsistemas de referência
- Social Simulation Engine: comportamento visual local sem autoridade operacional.
- Backend Activity Engine: snapshots/eventos reais e progresso confirmado.
- Office Health & Recovery Engine: diagnóstico, incidentes e recuperação segura.
- Adaptive Rendering Engine: renderiza a mesma simulação com níveis de fidelidade diferentes.
- Office State Manager: arbitra estados por agente/departamento e impede mistura de estados simulados/reais.

### Matriz de validação física futura
- Universal sem backend.
- Edição DGM-MAT ligada em modo read-only ao backend DGM-MAT já instalado.
- Edição VST ligada em modo read-only ao backend VST já instalado.
- Escritório standalone sem backend, responsivo, com simulação social claramente identificada.
- Testar falha de ligação depois de uma sessão live, atribuição/diagnóstico da causa, registo, recuperação, perda/retoma de snapshot, isolamento de credenciais e ausência de ações reais não autorizadas.
- PC de 2 cores/3 GB é apenas ambiente de teste; não pode definir o teto de capacidades do produto.
## Código iniciado — social simulation, health/recovery, state arbitration e resource policy (PR #55 branch, 2026-11-09)
- Implementado em código no branch ativo feat/windows-portable-host-bundle:
  - packages/scene-engine/src/social-simulation.mjs: motor social local, pseudoaleatório ponderado, duração variável, locais/atividades/interações, seed QA, clock injetado, sem tarefas/progresso de backend.
  - packages/scene-engine/src/office-health.mjs: coordenador de diagnóstico por camadas, redaction, incident store interface, tentativas de recuperação apenas locais e validação obrigatória de snapshot fresco/coerente.
  - packages/scene-engine/src/office-state-manager.mjs: arbitra offline social, sincronização, enfermaria e live; barras só com progresso backend válido e fresco.
  - packages/scene-engine/src/resource-policy.mjs: normaliza capacidades fornecidas pelo host e resolve qualidade/renderer com hysteresis, override manual, sem cortar semântica social e com orçamento do renderer separado.
- Testes correspondentes adicionados e módulos exportados pelo scene-engine; npm run check inclui validação de sintaxe.
- Limites honestos: diagnóstico ainda usa probes injetados, sem sondas reais integradas; InMemoryIncidentStore não é persistência de produção; deteção real de hardware e integração com renderer/installer continuam pendentes. Os módulos estão sujeitos ao CI do HEAD final da PR #55.
- A matriz física continua por executar: Universal offline, DGM-MAT read-only, VST read-only e standalone offline. Não instalar no PC do utilizador antes do pacote e lifecycle passarem os gates.
## Persistência de incidentes — PR #55 branch (2026-11-09)
- Novo `SqliteOfficeIncidentStore` em `packages/scene-engine/src/sqlite-office-incident-store.mjs`: histórico persistente por installationId, append/get/list/update/export, validação/corrupção, duplicados, limite de leitura e redação de campos/valores secretos.
- Windows host cria o store na base SQLite local já protegida por ACL e expõe `createDiagnostics({ probes, recoveryActions, clock })`, sempre com probes e ações locais fornecidas explicitamente pelo host.
- Teste Windows host verifica que o incidente permanece após fechar e reabrir o host.
- Ainda faltam probes reais (renderer/runtime, adapter, transporte, backend), exportação de suporte com consentimento e integração com reparação/UX. Não declarar causa sem evidência suficiente; timeouts permanecem indeterminados; não reiniciar nem escrever no backend automaticamente.
- Teste do bundle Windows: o job anterior ficou 29 minutos bloqueado depois de criar o certificado efémero, antes de qualquer comando do host. Substituídas importações PowerShell do certificado por `certutil.exe -user -addstore` explícito para Root/TrustedPublisher, com logs entre etapas. Resultado CI desta correção ainda pendente.
## Hardware detection e adaptação no Windows host — 2026-11-09
- Novo packages/windows-host/src/hardware-capabilities.mjs: recolhe OS/release, arquitetura, CPU/modelo/cores, RAM total/disponível e espaço livre. GPU/VRAM dedicada/API gráfica e resolução são providers opcionais; desconhecido permanece null e não confunde AdapterRAM com VRAM dedicada.
- Windows host calcula o perfil adaptativo no arranque, expõe factos de hardware no health e oferece refreshResourcePolicy() para reavaliação, getResourcePolicy() e setResourceOverrides() com validação antes de aplicar.
- O perfil muda fidelidade/orçamento do renderer; não remove comportamentos sociais nem corta funcionalidades. O orçamento do backend continua independente.
- Limites: falta ligar providers reais de GPU/resolução por plataforma, refrescamento periódico automático, persistência das preferências manuais e aplicação da política no renderer real.
- OfficeHealthRecoveryEngine agora impõe deadlines às probes, ações locais e verificação de snapshot; passa AbortSignal e classifica timeouts como indeterminados. Não faz restart nem writes no backend.
- O teste Windows do bundle passa a executar o launcher diretamente com cmd.exe, evitando o wrapper PowerShell adicional. A validação E2E ainda tem de terminar no HEAD final.
## Motor social ligado à preview — 2026-11-09
- A preview de browser agora usa SocialSimulationEngine real, em vez do helper antigo que escolhia atividades fixas por tick.
- Cada avatar mantém atividade, localização e eventual colega; a UI só atualiza quando o estado social muda para não reiniciar a animação a cada segundo.
- Existem cues/animacões leves para caminhar, conversar, cumprimentar, trabalhar no computador, usar quadro, café e pausa de varanda. A seleção pseudoaleatória permite repetir a mesma atividade.
- O estado sem backend fica explicitamente OFFLINE e SIMULADO. Perfil economy reduz efeitos, mas mantém a movimentação social e as mudanças de atividade.
- A preview usa seed QA fixa para screenshots reproduzíveis; runtime de produção deve usar seed variável/não fixa.
- Limite: integração atual é na browser preview; falta ligar o mesmo modelo ao renderer nativo/desktop e à arbitragem backend real. A preview não simula progresso operacional.
- Nota CI: HEAD 7d0025e falhou apenas porque o teste de preview ainda esperava o texto antigo "estado não verificado". O estado agora é explicitamente OFFLINE e SIMULADO. Teste atualizado para validar o novo texto, a utilização do SocialSimulationEngine e a preservação de animações no perfil economy; HEAD 1289644856049a05814c322676c33e76a5991981 inclui a correção.
- Precisão da deteção CPU: os.cpus() devolve processadores lógicos/threads, não núcleos físicos. O detector reporta agora cpuThreads; cpuCores fica reservado para providers que consigam medir núcleos físicos. A política usa cpuThreads como métrica conservadora quando cpuCores não existe. Esta regra foi adicionada ao contrato de hardware.
- Os snapshots de health copiam hardware e resourcePolicy em JSON antes de os devolver; consumidores não podem alterar o perfil interno através de objetos retornados.
- Diagnóstico do E2E Windows: os jobs ficavam presos na etapa de bundle depois de CNG/build. A hipótese mais provável era o processo filho herdar handles dos pipes redirecionados e impedir o drain. O teste foi alterado para redirecionar stdout/stderr do launcher para ficheiros temporários por comando, sem pipes herdados; timeout de 45s, kill da árvore e captura dos logs no erro. Ainda aguarda CI no HEAD final. O teste não deve ser considerado aprovado até o ciclo health/create/reopen/rotate/revoke/health terminar.
- Correção adicional: os providers nativos platform(), release() e arch() são invocados no default da deteção; o teste confirma que o relatório contém valores do sistema e não texto de funções.
- Correção do wrapper cmd.exe: a string /s /c termina agora com a aspa exterior adicional exigida depois da aspa que fecha o caminho do ficheiro stderr. O runner com este ajuste ainda tem de concluir o E2E.
- O teste do bundle passou a impor 20s de timeout a cada operação certutil de trust/removal, para que qualquer bloqueio do Windows Certificate Store produza falha explícita e logs em vez de deixar o runner preso.
