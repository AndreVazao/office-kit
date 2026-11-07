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
- `main` local sincronizada com `origin/main` em `e31bcca`.
- Branch local de trabalho atual: `feat/identity-storage-lifecycle` (ainda sem push/PR).
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
- Corrigido no branch o teste `product-profile.test.mjs` que continha caracteres `\\n` literais e provocava SyntaxError na CI anterior.


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


## CI multiplataforma — 2026-11-07
- Branch `ci/validate-sqlite-on-windows` altera a workflow principal para executar a suite completa em runners Linux e Windows com Node.js 22.
- A validação Windows inclui os testes SQLite reais e a terminação de processo filho antes de COMMIT. CI desta matriz ainda pendente.
- Runner Windows automatizado não substitui instalação em hardware físico, testes de CNG/DPAPI ou testes de distribuição/assinatura.
