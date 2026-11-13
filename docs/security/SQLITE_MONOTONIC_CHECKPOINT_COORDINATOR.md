# SQLite monotonic checkpoint coordinator

Status em 13 de novembro de 2026: o coordenador e o journal SQLite foram integrados por PRs #83/#84; o lock partilhado do host Windows por PR #85; a ligação atómica do payload de incident append ao checkpoint por PR #86. **Ainda não existe provider TPM 2.0 nem proteção anti-rollback de produção.**

## Adapter contract

`SqliteMonotonicCheckpointJournal` implementa:
- `withExclusiveLock(operation)`: delega num lock provider obrigatório. O provider tem de serializar todos os processos suportados que escrevem na base.
- `readCheckpoint()`: lê o checkpoint final por instalação.
- `readPreparedCheckpoint()`: lê o prepare durável ou devolve null.
- `prepareCheckpoint({ expected, next, payload })`: valida e persiste o prepare em `BEGIN IMMEDIATE`.
- `finalizeCheckpoint(record)`: finaliza o checkpoint e remove o prepare numa transação; finalização repetida é idempotente.
- `discardPreparedCheckpoint(id)`: remove apenas o prepare correspondente, depois de o coordenador provar que a âncora continua no predecessor.

Quando configurado com `applyPreparedPayload`, o journal aceita os payloads reconhecidos de incident append e update e executa o applier síncrono dentro da transação de finalização. Nessa composição, qualquer avanço de sequência exige um desses payloads e a sequência tem de avançar exatamente uma posição; o payload persistido é revalidado antes de ser aplicado. Sem applier, o journal mantém o contrato genérico metadata-only e não pode ser apresentado como âncora de eventos.

## Commit sequence

1. Adquirir o lock exclusivo.
2. Reconciliar o provider com o checkpoint local e qualquer prepare.
3. Construir e persistir o prepare; ler novamente para confirmar a persistência.
4. Executar compare-and-advance no provider externo.
5. Finalizar o payload de incidente, os MACs, a cabeça da cadeia e o checkpoint na mesma transação SQLite.
6. Ler de volta o checkpoint e confirmar que não existe prepare pendente.

## Recovery rules

- Âncora igual ao alvo preparado: finalizar.
- Âncora igual ao predecessor preparado: descartar o prepare não comprometido.
- Âncora indisponível/resultado indeterminado: preservar o prepare.
- Âncora e estado local/preparado divergentes: falhar fechado e preservar evidência.
- Provider não protegido e sem prepare: reportar o estado real, nunca `protected`.

## Incident append payload

O payload `office-kit.monotonic-incident-append.v1` inclui installation ID, sequência, snapshot, event JSON canónico, hash SHA-256, key ID, MAC anterior e HMAC. A aplicação:
- valida o checkpoint contra sequência/hash/MAC;
- valida o snapshot e o evento canónico;
- verifica a cadeia e a cabeça anterior;
- recalcula hash e HMAC com o keyring disponível;
- insere snapshot, evento e MAC;
- atualiza a cabeça da cadeia;
- volta a verificar a integridade antes de a transação concluir.

O applier é síncrono e decorre dentro da transação SQLite de finalização. Se falhar, a transação reverte todas as alterações. Um prepare com payload removido ou alterado não pode avançar a sequência quando o applier está configurado.

## Anchored incident writer — core boundary

`MonotonicIncidentWriter` encaminha `append()` e `update()` através de `SqliteMonotonicCheckpointCoordinator.commit()`. O writer constrói o payload dentro do lock exclusivo do coordenador e só devolve o ID depois de confirmar que o checkpoint final corresponde ao evento.

O payload de update contém a revisão anterior e SHA-256 do snapshot predecessor. A finalização exige que a revisão e o digest atuais coincidam, além de revalidar event JSON, sequência, hash, HMAC e cabeça da cadeia. Isto impede que um prepare de update antigo sobrescreva uma revisão mais recente.

O writer exige que incident store e checkpoint journal partilhem a mesma base SQLite e o mesmo lock de operações. Se o provider não reportar estado `protected`, o coordenador rejeita a escrita; não existe fallback automático para escrita não ancorada.

**Limite desta implementação:** o writer está disponível no core, mas ainda não foi instalado como fachada de escrita do Windows host. As chamadas diretas `incidentStore.append()` e `update()` continuam a ser o caminho não ancorado até à integração do host. Não apresentar esta API nem os testes com provider fake como TPM ou anti-rollback de produção.

## Windows host boundary

O Windows host configura o applier para chamar `SqliteOfficeIncidentStore.applyPreparedMonotonicPayload`, que despacha append e update, e partilha o lock de operações entre incident writes e checkpoint operations. O host singleton lock serializa as instâncias suportadas do Office Kit e a recuperação de stale owner usa um recovery gate. Isto não impede processos arbitrários que ignorem o host e abram SQLite diretamente.

**Limite atual:** o host não fornece provider TPM de produção nem ativa `MonotonicIncidentWriter` como writer predefinido; as chamadas normais `incidentStore.append()`/`update()` continuam não ancoradas. Não misturar writes não ancorados com uma história apresentada como protegida. A integração fail-closed do writer no host e o provider TPM são gates seguintes.

## Evidence

- PR #85 merge: `988c78f7e876f862356f657285b5938bad1ceabb`; final PR HEAD `8700f3e27862387eaf0d4bb96989136d82cd9cfa`; CI #559 e visual #479 passaram nesse HEAD.
- PR #86 merge: `edb7bd3c79051078141d54424bfcaccf249156c5`; final PR HEAD `8a98567d53e8f65ce351745047c46da18b691c11`; CI #571 e visual #491 passaram nesse HEAD.
- Os testes usam engine SQLite real em ficheiro temporário, WAL, `synchronous=FULL`, `BEGIN IMMEDIATE` e close/reopen.
- Os providers de âncora usados nos testes são fakes; as suas capabilities são fixtures, não evidência de hardware.
- A matriz CI executou Linux e Windows em Node 22 e Node 26.13.1; o Windows executou também CNG nativo, vault DGM-MAT, vault VST, journal CNG e bundle E2E.

## Remaining gates

1. Integrar `MonotonicIncidentWriter` no Windows host como fachada única de escrita, bloquear mutações diretas quando a instalação estiver em modo protegido e definir recuperação/saída explícita para modo não ancorado.
2. Implementar provider TPM 2.0 nativo com provisioning consentido e compare-and-advance atómico verificável.
3. Fault injection e concorrência multi-processo em cada fronteira de commit.
4. Power-loss, backup/restore e TPM clear/reprovision em hardware físico.
5. Providers de keystore/âncora para Linux, macOS e Android.

Não inferir `protected` a partir de SQLite, HMAC, CNG Software KSP, provider fake ou runner CI.
