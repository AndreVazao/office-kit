# Windows host runtime — primeira composição local

## Implementação

O pacote `packages/windows-host` acrescenta uma composição local Windows-only que:
- resolve e valida a pasta privada por instalação;
- aplica ACLs restritivas ao diretório de dados e aos ficheiros de identidade/lock;
- cria e preserva um `installationId` estável;
- impede duas instâncias simultâneas através de lock de processo;
- exige um helper CNG com assinatura Authenticode válida antes de abrir a base de dados;
- abre SQLite local com WAL, synchronous FULL, foreign keys e busy timeout;
- compõe `createWindowsNodeIdentityRuntime` e reconcilia a identidade antes de expor health;
- encerra SQLite e liberta o lock em `close()`.

O host não inicia rede, descoberta, telemetria, federation, backend adapter, enrollment ou comandos remotos. O CLI só cria/roda/revoga identidade quando o utilizador pede explicitamente.

## Verificação do publisher — bloqueio fail-closed

O host já não lê `OFFICE_KIT_CNG_SIGNER_THUMBPRINT` nem qualquer outra variável de ambiente para escolher o publisher. A função de verificação só aceita um pin explicitamente fornecido por uma política autenticada; a composição de produção ainda não dispõe desse provider. Por isso, o arranque normal falha antes de abrir a base de dados com `windows_host_publisher_policy_unavailable`.

O parâmetro explícito de thumbprint permanece apenas para testes isolados do comando PowerShell. Não é uma configuração de produção, não deve ser passado pelo CLI e não autoriza distribuição. O launcher dos bundles não exige nem consulta variáveis de publisher. Até existir provisionamento autenticado pelo instalador, o host Windows permanece intencionalmente indisponível para arranque de produção.

```powershell
$env:OFFICE_KIT_CNG_HOST_PATH = "C:\\Program Files\\Office Kit\\OfficeKit.CngHost.exe"
node packages/windows-host/src/cli.mjs health
```

O comando acima deve falhar fechado nesta fase, porque a política autenticada ainda não foi implementada. Não definir um thumbprint no ambiente para contornar o bloqueio.

## Limites e validação

- A verificação de produção usa o caminho PowerShell `Get-AuthenticodeSignature`, limitado a 15 segundos, mas a política autenticada do publisher ainda não está implementada. O pin por variável de ambiente foi removido da composição de produção; sem um pin fornecido por uma política autenticada, o host falha fechado antes de abrir a base de dados. O parâmetro explícito de thumbprint existe apenas para testes isolados. Continuam pendentes pin SHA-256 SPKI, política provisionada pelo instalador, associação explícita à assinatura selecionada e regras de revogação distintas para instalação/atualização e arranque offline. Ver issue #110.
- Os testes automatizados injetam o verificador de assinatura e as operações ACL; validam a composição, isolamento do processo, persistência do installation ID, health e rejeição de helper não confiável. Isto não valida as ACLs ou a cadeia de certificados de uma instalação física.
- O helper CNG atualmente publicado no CI não é assinado por um certificado de distribuição. Portanto, o CLI de produção não arranca com esse artefacto até existir assinatura e trust chain válidas.
- Ainda não existe instalador MSI/MSIX, assinatura de release, serviço Windows, UI, atualização/rollback, backup/restore ou teste num PC físico.
- O módulo usa `node:sqlite`; a execução do host exige Node.js 22.5 ou superior. O core genérico e a preview não importam este pacote.
- A autenticação do utilizador Windows e as ACLs do sistema protegem o armazenamento local; não há autenticação remota nem exposição de porta local.

Este incremento é um host de runtime local executável, não uma release instalável/comercial.

## Validação Windows real acrescentada
A suite `windows-host.windows.integration.test.mjs` executa no runner Windows:
- resolve o SID real do utilizador com `whoami.exe`;
- executa `icacls.exe` no diretório da instalação, diretório de dados, metadados de instalação e base SQLite;
- consulta a saída de `icacls` para cada caminho e confirma explicitamente o SID/nome do utilizador e SYSTEM;
- confirma que o verificador Authenticode rejeita um helper sem assinatura.

O teste injeta apenas a aceitação do helper no cenário de ACL para isolar a validação de permissões. O cenário separado usa o verificador real e um ficheiro sem assinatura. Isto é validação no runner Windows, não substitui teste no PC físico nem uma cadeia de assinatura de release.

As ACLs distinguem diretórios e ficheiros: diretórios recebem permissões herdáveis `(OI)(CI)F`; ficheiros recebem `F` diretamente. A validação Windows cobre ambos os tipos, incluindo a base SQLite e o ficheiro de installation ID.

## Startup reconciliation gate
O host inicia uma promessa `ready` que reconcilia a identidade persistida antes de qualquer mutação exposta por `host.manager`. O CLI aguarda `host.ready` antes de executar o comando pedido. Se a reconciliação falhar, create/rotate/revoke falham sem executar a mutação; `close()` aguarda o resultado e liberta SQLite/lock mesmo em falha. O health continua a distinguir estado recuperado de estado degradado.

Estados de reconciliação que não sejam `empty`, `active` ou `revoked` são considerados incompletos: health reporta `degraded`, a identidade persistida não é exposta e create/rotate/revoke ficam bloqueados. Um erro de reconciliação também bloqueia as operações.

## Portable Windows bundle
Os scripts `tools/windows/build-host-bundle.ps1` e `tools/windows/test-host-bundle.ps1` criam e exercitam uma distribuição portátil com `node.exe`, os módulos de runtime e o helper CNG. O teste CI cria um certificado Code Signing efémero e assina o helper, mas deixa a cadeia desse certificado sem confiança. O launcher de produção tem de rejeitá-lo. Um runner de teste separado, explicitamente injetado, aceita apenas a assinatura criptograficamente íntegra com o thumbprint efémero exato e executa o host/CLI, SQLite e CNG em processos separados. Não são modificadas as stores Root ou TrustedPublisher. Este teste prova integridade da assinatura e o ciclo de runtime com um verificador de teste; não prova aceitação positiva pelo verificador de produção nem uma cadeia comercial.

Isto valida o empacotamento e o fluxo local com um trust publisher de teste. Não produz um certificado de release confiável nos PCs dos utilizadores, não cria MSI/MSIX nem serviço Windows e não substitui assinatura comercial, upgrade/uninstall ou validação física. O bundle não deve ser distribuído como release.


## Managed adapter supervision (incremento em desenvolvimento)
O bundle portátil inclui também as dependências transitivas necessárias ao `AdapterGateway` (`adapter-gateway.mjs`, `runtime-session.mjs`, `runtime-state.mjs` e `adapter-contract.mjs`). A allowlist do script de build e a allowlist independente do teste têm de coincidir; o teste falha se faltar ou sobrar qualquer módulo. Esta inclusão corrige a composição gerida sem incluir adaptadores específicos de DGM-MAT/VST.

O host expõe `createManagedAdapterGateway({ probes, ... })`. O chamador tem de selecionar e autorizar explicitamente o adapter e fornecer probes read-only não vazios. O gateway encaminha estados autoritativos de RuntimeSession para OfficeConnectionSupervisor; os incidentes são persistidos no SQLite associado à instalação. A perda só é registada depois de uma sessão live confirmada e a recuperação exige probes saudáveis e novo snapshot live sincronizado. O host fecha gateways geridos antes de encerrar a base de dados. Esta composição não fornece descoberta nem transporte de rede. O adaptador VST é uma composição separada, incluída apenas na edição VST; não pertence ao bundle Universal. Os testes com GenericDemoAdapter são integração de contrato, não validação de backend real ou PC físico.


## Installation lifecycle controller — PR em desenvolvimento

O módulo `packages/windows-host/src/installation-lifecycle.mjs` acrescenta um coordenador serializado para instalação, arranque, paragem, reinício, atualização, rollback e desinstalação. O coordenador recebe um driver de plataforma e um store persistente por injeção; não executa shell, não regista serviços do sistema e não remove dados diretamente.

- Instalação só é marcada como concluída após health `ready`.
- Start/restart só ficam `running` depois de health confirmado; falhas ficam `degraded`.
- Upgrade prepara pacote, pára o runtime quando necessário, cria backup, ativa a versão e valida health. Em falha tenta restaurar a versão anterior e voltar a arrancar.
- Rollback manual só existe quando há versão anterior registada e exige health confirmado.
- Uninstall preserva dados por omissão. A remoção de dados exige `retainData: false` explícito e ocorre depois da remoção do runtime.
- Operações concorrentes são serializadas e o estado é persistido pelo store fornecido.

Este incremento é um coordenador testável, não um instalador MSI/MSIX nem um Windows Service. Drivers de plataforma, store durável com escrita atómica, assinatura de release, migração/backup real e testes físicos continuam por implementar. Os testes do coordenador usam driver/store de teste e não provam operações no Windows do utilizador.


## Durable installation lifecycle state

`SqliteInstallationLifecycleStore` persists lifecycle records in the host's existing SQLite database, scoped by the host installation ID. Each save uses a single `BEGIN IMMEDIATE` / `COMMIT` transaction and JSON payload validation on read. The Windows host exposes this store as `installationLifecycleStore`; it shares the host database connection and is closed with the host, not independently.

The host configures SQLite WAL and `synchronous=FULL` before constructing the store. This gives transactional state persistence, not a full backup of installed binaries or package payloads. Crash recovery orchestration and platform drivers remain separate work. The store deliberately refuses to silently replace corrupt persisted state.


## Host composition for lifecycle orchestration — integrado em main

`createInstallationLifecycleRuntime({ driver, clock })` cria o coordenador de ciclo de vida usando o `SqliteInstallationLifecycleStore` pertencente à mesma instalação do host. Assim, o estado e o journal de recuperação sobrevivem ao fecho/reabertura do host e ficam isolados pelo `installationId`.

O driver continua a ser injetado pelo anfitrião e não existe driver de produção nesta alteração. A API não instala serviços, não inicia processos, não altera o backend e não concede privilégios. A prova adicionada usa um driver simulado e confirma install/start, persistência SQLite e reabertura. O próximo incremento tem de fornecer inspeção autoritativa e operações Windows reais, com limites de privilégio e consentimento explícito.


## Generic CNG secret vault and DGM-MAT-only host composition — 2026-11-11

The Windows host now exposes `createSecretStore(namespace)`, backed by the same installation-scoped SQLite connection and the Authenticode-verified CNG helper. The generic vault stores an AES-256-GCM envelope in SQLite and wraps the random data key with a separate RSA CNG key whose name is derived from the installation ID and namespace. The RSA private key is non-exportable under Microsoft Software KSP; the vault does not reuse the node-identity key and does not claim TPM backing.

The DGM-MAT package adds `createWindowsDgmMatHost` through the DGM-only `./windows-host/dgmat` export. It provisions the bootstrap credential only after explicit owner consent, retrieves it on demand from `dgmat.bootstrap`, passes cancellation through the CNG helper read, and performs no backend connection until `connect()` is explicitly called. Disconnect/close clears the memory-only access token. Removal requires owner consent and returns both the ciphertext row count and whether the CNG key was deleted.

The host's health result deliberately labels backend operational state `unverified`; a successful local session/transport handshake does not establish fresh authoritative operational state. Fake composition tests are distinct from the Windows native CNG integration test. Live DGM-MAT protocol validation and a physical-PC installation test remain pending.

The secret-vault capability also declares `backupRestoreRequiresSameUserProfile=true`: a SQLite-only backup cannot restore the encrypted bootstrap credential without the matching user-scoped CNG key. Cross-profile/machine recovery is not implemented; the safe recovery path is explicit re-enrolment, not exporting the private key.

### Integridade autenticada do journal de incidentes — PR #73 integrada (2026-11-12)
O Windows host só fica ready depois de obter a chave HMAC do journal através do WindowsCngSecretVault na namespace incident.journal. No primeiro arranque sem histórico autenticado, cria uma chave aleatória de 256 bits e guarda-a como segredo CNG journal-mac-v1. A chave não é escrita em texto simples no SQLite e o buffer de memória é limpo no fecho do host.

O SqliteOfficeIncidentStore verifica SHA-256 + HMAC-SHA-256 antes de operações de leitura/exportação. Se existirem MACs e a chave protegida estiver ausente, o host falha fechado e não gera uma chave substituta. A migração de eventos antigos valida a cadeia SHA-256 e cria o baseline HMAC na primeira ativação.

Limites: chave associada ao perfil Windows atual; backup apenas do SQLite não é suficiente. Sem âncora externa monotónica, rollback/truncagem para um prefixo antigo válido não é detetado. Rotação de chave e recuperação entre perfis ainda não estão implementadas. CI Windows com helper CNG real passou, mas não substitui teste no PC físico.


## VST Windows host composition — preview isolado (2026-11-12)

A edição VST expõe `createWindowsVstHost` apenas pelo entrypoint `./windows-host/vst`. O host usa o `WindowsCngSecretVault` genérico no namespace `vst.local-api`, separado de `dgmat.bootstrap` e da identidade do nó. Provisionar/remover o token exige consentimento explícito do proprietário; provisionar não liga o adapter automaticamente.

A ligação é manual e read-only: somente `GET http://127.0.0.1:8765/observer/summary` com `X-Token`, sem redirects ou endpoints remotos. O envelope só é aceite quando `ok === true`. O adapter não expõe comandos, não infere atividade de agentes/tarefas e mantém o estado operacional `unverified`. O modo REAL não concede autorização de execução.

O CI #43230962819 passou em Node 22 e Node 26.13.1 no HEAD de implementação `3aff126095e4af10d16ea65fccaeb58be983eb43`. O teste VST usa o helper CNG nativo e SQLite real através da composição VST, com host factory injetada e resposta HTTP simulada; valida o percurso do segredo/CNG, não o host Windows completo nem uma instância VST ativa. A regressão visual #43230962934 também passou. O commit subsequente de sincronização documental está a ser revalidado no seu próprio HEAD da PR antes do merge. A validação live e no PC físico continua pendente.


The portable Universal Windows bundle now includes the generic monotonic anchor contract, coordinator and incident writer modules required by the Windows host composition. These modules are backend-neutral; DGM-MAT/VST adapter modules remain excluded from the Universal bundle. The bundle allowlist test must stay in sync with the copy list.


## Edition-specific Windows CLI entrypoints — 2026-11-17

The DGM-MAT and VST source packages expose separate Windows host CLI entrypoints:

- DGM-MAT: `./windows-host/dgmat-cli` → `packages/windows-host/src/dgmat-cli.mjs`.
- VST: `./windows-host/vst-cli` → `packages/windows-host/src/vst-cli.mjs`.

Each launcher composes only its own adapter/credential provider and uses a separate persistent data root below `%LOCALAPPDATA%\\OfficeKit\\` (`DGM-MAT` or `VST`). The existing Universal data root and launcher are preserved to avoid silently moving existing installation data.

The launcher starts disconnected. `health` does not connect. `serve` accepts newline-delimited JSON requests with exactly one property, `command`, and supports `health`, `credential-status`, `connect`, `snapshot`, `disconnect` and `shutdown`. A snapshot is rejected until an explicit connect succeeds. Every process exit closes the host and disconnects its adapter.

Credential values are not accepted in command-line arguments or control messages, and are never printed. Provisioning/removal remains available only through the edition host API with explicit owner consent; a future onboarding UI must collect secrets through a protected input path. The CLI opens no network listener and does not perform backend discovery or auto-connect.

This increment adds source-package entrypoints and deterministic command-loop tests. It does **not** yet add DGM-MAT/VST portable Windows bundles, MSI/MSIX installers, service registration, live backend proof or physical-PC installation validation. The existing portable bundle builder remains Universal-only until its own edition-specific allowlist and smoke-test work is completed.


## 2026-11-21 — Portable edition bundles merged; publisher trust remains open

PR #107 was squash-merged as `b27136a974d25bb1f3572a5bdb8700f359ac2627` from final PR HEAD `75fd8d027d69d49fc11c0b20f7e1d58d5eece0e4`. CI [44911614409](https://github.com/AndreVazao/office-kit/actions/runs/44911614409) passed Linux/Windows Node 22/26.13.1, including the Universal, DGM-MAT and VST portable bundle E2E tests; visual regression [44911614342](https://github.com/AndreVazao/office-kit/actions/runs/44911614342) passed on that exact PR HEAD.

The bundles are portable runtime distributions, not MSI/MSIX installers. They do not prove commercial publisher trust, install/upgrade/rollback/uninstall, live backend integration or physical-PC installation. Issue #110 remains open. The current bounded `Get-AuthenticodeSignature` baseline requires Status `Valid` and a SHA-1 thumbprint supplied through the process environment, with a 15-second child-process timeout. It is a reviewed compatibility baseline, not installer-authenticated production publisher policy.

## 2026-11-21 — SQLite finalization process-crash boundary

PR #111 was squash-merged as `b8cff02dd9f74886df6c39895213cc03e31a4bbf` from final PR HEAD `362ac780cb7f9c31b7111ac6b7384a2179357abb`. CI [44912644014](https://github.com/AndreVazao/office-kit/actions/runs/44912644014) and visual regression [44912644019](https://github.com/AndreVazao/office-kit/actions/runs/44912644019) passed on that exact PR HEAD. Post-merge CI [44913217716](https://github.com/AndreVazao/office-kit/actions/runs/44913217716) and visual [44913217681](https://github.com/AndreVazao/office-kit/actions/runs/44913217681) passed on main.

The test uses a real SQLite/WAL file, `synchronous=FULL`, immediate transactions and a real child process terminated after domain rows are applied but before checkpoint update and prepare deletion. Reopen/recovery confirms atomic rollback and exactly-once finalization. Its monotonic anchor is explicitly a file-backed test fake; this does not prove TPM, hardware rollback resistance, power-loss durability or physical-PC behavior.


## 2026-11-21 — lifecycle SQLite partition identity check

PR #113 was squash-merged as `e4800a76747f84b35e0f14fa4babf071c2d30de2` from final PR HEAD `6c2295d569ed8b64170dcd3dcb641987b0399445`. On the exact PR HEAD, CI [44914347607](https://github.com/AndreVazao/office-kit/actions/runs/44914347607) passed Linux and Windows on Node 22 and Node 26.13.1; the two new partition-binding regressions were observed passing in all four job logs. Visual regression [44914336936](https://github.com/AndreVazao/office-kit/actions/runs/44914336936) passed on that same HEAD. Post-merge main CI [44914574477](https://github.com/AndreVazao/office-kit/actions/runs/44914574477) passed all four jobs and visual regression [44914574487](https://github.com/AndreVazao/office-kit/actions/runs/44914574487) passed on the merge commit.

The store now rejects a record whose `installationId` differs from its SQLite partition on both save and load. This prevents a mismatched persisted JSON record from making the lifecycle controller pass another installation ID to the injected driver. The new store regression uses a real `node:sqlite` connection with an in-memory test database. The separate host-composition test persists through the host's real SQLite file across close/reopen, but its OS/package driver remains injected/fake. This is a partition-consistency fix, not authenticated-record tamper protection, an MSI/MSIX installer, a native Windows service driver or physical-PC validation.
