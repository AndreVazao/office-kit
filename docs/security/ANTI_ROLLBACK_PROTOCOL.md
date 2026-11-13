# Protocolo anti-rollback do diário de incidentes

Estado em 13 de novembro de 2026: contrato genérico de provider, coordenador crash-consistent, journal SQLite, lock de operações do host Windows e primitive de append atómico estão integrados. **Não existe ainda provider TPM 2.0 de produção. Nenhuma proteção anti-rollback está ativa ou declarada.**

## Objetivo e limite de segurança

A cadeia SHA-256 + HMAC deteta alteração de eventos e perda de chaves. Não deteta isoladamente a restauração de uma cópia antiga e internamente válida da base SQLite. A proteção contra rollback exige uma âncora monotónica externa, autenticada e resistente a rollback dentro do modelo de ameaça.

CNG Software KSP, Registry, ficheiros locais, timestamps e outra base SQLite no mesmo volume não satisfazem este requisito. Não confundir uma chave não exportável com um contador monotónico.

## Modelo de ameaça

Pretende-se detetar:
- Restauro de backup SQLite antigo, incluindo prefixo válido da cadeia HMAC.
- Truncagem de eventos autenticados.
- Reposição de ficheiros locais de estado/metadata juntamente com SQLite.
- Interrupção do processo entre o prepare durável, avanço da âncora e finalização SQLite.

Não se promete proteção contra:
- Administrador/kernel comprometido enquanto o dispositivo está operacional.
- Extração física ou substituição do TPM, clear/reprovision sem recuperação autorizada.
- Rollback coordenado de todo o dispositivo/firmware/TPM além das garantias do hardware.
- Perda definitiva da âncora ou das chaves sem recuperação aprovada pelo proprietário.

## Contrato de provider

O core não contém chamadas nativas:
- `MonotonicAnchorProvider.read()`: estado, identidade e checkpoint atual.
- `MonotonicAnchorProvider.advance(expected, next)`: compare-and-advance atómico; rejeita predecessor divergente, repetição inválida e recuo.
- `MonotonicAnchorProvider.capabilities()`: declara durabilidade, atomicidade, escopo, suporte hardware e resistência a rollback.
- Estados explícitos: `protected`, `unsupported`, `unprovisioned`, `unavailable`, `mismatch`, `recovery_required`.

O core só aceita `protected` quando todas as capacidades obrigatórias são explícitas e o checkpoint pertence à instalação esperada. A declaração do provider continua a ser uma fronteira de confiança; só um provider nativo auditado e validado pode suportar uma afirmação de hardware.

## Protocolo implementado

A unidade de compromisso é um checkpoint com `installationId`, geração, sequência do evento, hash do evento, MAC do evento e versão do protocolo.

1. Adquirir o lock exclusivo partilhado pelo host e verificar a cadeia SHA-256/HMAC completa.
2. Ler a âncora e reconciliar o checkpoint local e qualquer prepare pendente.
3. Construir um payload imutável para o append, com snapshot, evento canónico, hash, key ID, MAC anterior e HMAC.
4. Persistir o prepare e o payload limitado numa transação SQLite durável. Nesta fase ainda não inserir o evento no journal.
5. Executar compare-and-advance na âncora externa.
6. Finalizar numa única transação SQLite: revalidar o payload; inserir snapshot, evento e HMAC; atualizar a cabeça da cadeia e o checkpoint; remover o prepare.
7. Confirmar que o checkpoint local final corresponde ao checkpoint confirmado pela âncora antes de devolver sucesso.

A finalização do payload é síncrona porque decorre dentro da transação SQLite. Se falhar, a transação reverte snapshot, evento, HMAC, cabeça e checkpoint em conjunto.

## Recuperação

- Sem prepare e checkpoint local igual à âncora: estado consistente.
- Prepare presente e âncora igual ao sucessor: finalizar o prepare.
- Prepare presente e âncora igual ao predecessor: descartar o prepare não comprometido. Se o avanço anterior devolveu erro ambíguo, o coordenador relê a âncora antes de decidir.
- Âncora indisponível ou resultado indeterminado: preservar o prepare e falhar fechado.
- Âncora e estado local/preparado divergentes: preservar evidência e devolver mismatch/recovery-required; não reparar nem sobrescrever automaticamente.
- Âncora mais avançada sem prepare recuperável, ou SQLite abaixo da âncora: tratar como rollback/truncagem.
- Âncora ausente, limpa, inacessível ou reconfigurada numa instalação previamente protegida: nunca criar silenciosamente uma âncora nova.

O journal rejeita avanço de sequência sem o payload de incident append quando o applier de incidentes está configurado. O payload persistido é revalidado durante a finalização; remover ou alterar o payload para `null` não pode avançar o checkpoint sem gravar o evento. Um journal genérico sem applier mantém o contrato metadata-only e não ancora incidentes.

## Provider Windows TPM 2.0 — ainda por implementar

O provider deverá usar TPM 2.0 NV index/counter com atributos, autorização e identidade definidos durante provisioning consentido. Deve demonstrar:
- Presença e versão/capacidades TPM verificadas por API nativa.
- Provisioning idempotente e explicitamente autorizado.
- Compare-and-advance realmente atómico para a geração e o compromisso do checkpoint.
- Deteção de clear, reprovision, índice perdido, autorização incorreta e mismatch de instalação.
- Persistência entre reinícios e comportamento definido perante timeout/erro ambíguo.
- Fallback fail-closed; nunca promover CNG Software KSP, registry ou ficheiro para hardware-backed.

TBS/TPM API é uma fronteira nativa. Não assumir que CNG Platform/Software KSP implementa contador monotónico. Um NV counter simples não basta se o digest do checkpoint não ficar autenticadamente associado à geração e recuperável após falha.

Um provider cloud pode ser opção futura separada, com compare-and-advance autenticado. Nunca é obrigatório nem substitui automaticamente o TPM; indisponibilidade de rede não pode degradar silenciosamente um estado protegido.

## Provisioning, backup e recuperação

- Provisioning exige consentimento explícito do proprietário e regista identidade/capacidades da âncora.
- Backup SQLite isolado não é suficiente para recuperar uma instalação protegida.
- Restore para a mesma âncora deve ser comparado com o checkpoint externo e normalmente detetar rollback se estiver abaixo dele.
- Migração para novo hardware exige transferência explícita, autenticação do proprietário e desativação da âncora anterior quando possível.
- Perda/clear do TPM exige `recovery_required`; nunca reset automático.
- Rotação das chaves MAC e retenção histórica permanecem separadas da geração monotónica.

## Evidência atual e gates

PR #85: lock de operações do host Windows integrado por squash em `988c78f7e876f862356f657285b5938bad1ceabb`.

PR #86: append atómico com payload e checkpoint integrado por squash em `edb7bd3c79051078141d54424bfcaccf249156c5`. O HEAD final da PR foi `8a98567d53e8f65ce351745047c46da18b691c11`; CI #571 e regressão visual #491 passaram nesse mesmo SHA. Os testes usam SQLite real em ficheiro temporário, WAL, `synchronous=FULL`, `BEGIN IMMEDIATE` e reopen. O provider de âncora é fake; isto não é validação TPM.

Gates ainda obrigatórios:
1. Provider TPM 2.0 nativo com provisioning consentido e compare-and-advance verificável.
2. Integrar todas as mutações de incidentes (append/update) com uma política de writer ancorado; não misturar mutações ancoradas e não ancoradas.
3. Fault injection em cada fronteira prepare/advance/finalize e testes de concorrência entre processos.
4. Rollback de prefixo HMAC, truncagem, backup antigo e mismatch de installation ID.
5. Windows runner com TPM virtual/emulado, se disponível, apenas como evidência de API.
6. TPM 2.0 físico com reinício, clear/reprovision, falhas de energia e restore.
7. Providers equivalentes para Linux, macOS e Android.
8. CI Linux/Windows e regressão visual no mesmo HEAD antes de merge.

Sem provider monotónico real e provisionado: `integrity=authenticated_only` e `rollbackProtection=unsupported|unavailable`. Só declarar `protected` depois de validar provider, instalação e checkpoint. Nenhum teste fake ou runner genérico é prova de TPM físico.
