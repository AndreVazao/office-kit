# Office Kit — memória persistente do projeto

Última atualização: 2026-11-03

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
