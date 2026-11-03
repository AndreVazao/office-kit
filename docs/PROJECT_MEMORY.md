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
- Próxima branch ativa: feat/private-discovery-contracts.
- Implementação inicial: packages/scene-engine/src/federation-contract.mjs.
- Testes: packages/scene-engine/test/federation-contract.test.mjs.
- O package check inclui verificação de sintaxe do novo módulo; a suite test inclui o novo teste via glob existente.
- Novo código ainda aguarda CI/regressão visual no HEAD final; não afirmar testes verdes antes dos resultados.

## Implementado neste incremento (ainda sujeito a CI)
- Contratos abstratos DiscoveryProvider, PrivateTransportProvider, OrganizationDirectoryProvider.
- Validação de descriptor público de nó: organizationId, nodeId, fingerprint SHA-256, protocolVersion e capabilities.
- Validação de hints LAN/Tailscale/HTTPS/relay com HTTPS obrigatório para endpoints remotos.
- Leases de descoberta com origem permitida, validade máxima configurável (120 s por omissão), expiração e hints únicos.
- Envelope de evento de federação schema v1 com identidade do nó, sessão, sequência, timestamp e payload.
- Testes unitários para validação, rejeições e interfaces abstratas.

## Não implementado
- Criação/armazenamento seguro de identidade e chaves de nó.
- Prova criptográfica de posse da chave, autenticação mútua, convite, aprovação e revogação.
- Descoberta LAN/mDNS real.
- Integração Tailscale real ou deteção do daemon/CLI.
- Diretório/rendezvous HTTP e deploy Vercel ou alternativo.
- Transporte P2P, relay e sincronização.
- UI de onboarding, cidade agregada e federação multi-computador.
- Avatar Studio, geração por fotografia, instalador de renderers adaptativos e renderer 3D avançado.

## Próximos passos
1. Validar CI e regressão visual no HEAD exato da branch atual; corrigir falhas antes de merge.
2. Implementar armazenamento/identidade criptográfica local de nó com APIs de runtime compatíveis (Node e browser/desktop) e testes de rotação/revogação.
3. Definir convite de organização e protocolo de aprovação com expiração, nonce, proteção replay e autorização granular.
4. Implementar primeiro provider LAN/mDNS atrás dos contratos e sem aceitar automaticamente peers.
5. Implementar provider Tailscale opcional, read-only para deteção inicial, sem gerir credenciais.
6. Definir API rendezvous HTTPS com leases curtas e metadados mínimos; adaptar para Vercel ou self-host sem acoplamento ao core.
7. Implementar transporte privado e só depois agregar snapshots/eventos na cidade virtual.
8. Manter documentação Architecture, Roadmap, Implementation Status e esta memória sincronizadas em cada PR.

## Regra de comunicação
Nunca declarar funcionalidade implementada, testada, publicada ou merged sem confirmação objetiva no GitHub e/ou execução de testes no SHA referido.
