# Protocolo anti-rollback do diário de incidentes

Estado em 14 de novembro de 2026: contrato genérico, coordenador crash-consistent, journal SQLite, writer append/update, fachada única de mutação do Windows host e testes de terminação de processo estão integrados. **Não existe ainda provider TPM 2.0 de produção. Nenhuma proteção anti-rollback está ativa ou declarada.**

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

O provider deverá usar TPM 2.0 NV index/counter com atributos, autorização e identidade definidos durante provisioning consentido. Deve demonstrar presença/capacidades por API nativa, provisioning consentido, compare-and-advance verificável, deteção de clear/reprovision/índice perdido e recuperação fail-closed. TBS/TPM API é uma fronteira nativa; não assumir que CNG Platform/Software KSP implementa contador monotónico. `TBS_SUCCESS` só confirma a submissão pela TBS; o código de resposta TPM também tem de ser analisado.
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

Incremento de core em validação: `MonotonicIncidentWriter` acrescenta encaminhamento de append e update pelo coordenador. O update vincula a revisão e o hash do snapshot predecessor. O journal aceita apenas payloads reconhecidos e avanço de sequência unitário. A API ainda não está ligada à fachada de escrita do Windows host; as chamadas diretas ao store continuam não ancoradas. Os testes com provider fake não validam hardware nem TPM.

Gates ainda obrigatórios:
1. Provider TPM 2.0 nativo com provisioning consentido e compare-and-advance verificável.
2. Integrar o writer de core no Windows host, encaminhar todas as mutações append/update e impedir mistura entre escritas ancoradas e não ancoradas.
3. Fault injection em cada fronteira prepare/advance/finalize e testes de concorrência entre processos.
4. Rollback de prefixo HMAC, truncagem, backup antigo e mismatch de installation ID.
5. Windows runner com TPM virtual/emulado, se disponível, apenas como evidência de API.
6. TPM 2.0 físico com reinício, clear/reprovision, falhas de energia e restore.
7. Providers equivalentes para Linux, macOS e Android.
8. CI Linux/Windows e regressão visual no mesmo HEAD antes de merge.

Sem provider monotónico real e provisionado: `integrity=authenticated_only` e `rollbackProtection=unsupported|unavailable`. Só declarar `protected` depois de validar provider, instalação e checkpoint. Nenhum teste fake ou runner genérico é prova de TPM físico.


## Evidência de crash recovery — PR #91 (2026-11-14)

PR #91 foi squash-merged como `419b45d4294509f1147b2d17375147cd15d1c0c9`. O HEAD final da PR `16256d4d6c01b0f652dd9694405a2d2cac23e944` passou CI `43601453827` e visual `43601453873`; pós-merge CI `43601790771` e visual `43601790788` passaram no merge commit.

Os testes terminam um processo Node filho:
- Depois do prepare SQLite durável e antes de avançar a âncora: recuperação descarta o prepare e não cria evento.
- Depois do avanço da âncora de teste e antes da finalização SQLite: recuperação finaliza o evento/checkpoint.

SQLite/WAL é real; a âncora é um provider fake baseado em ficheiro. Esta evidência não equivale a TPM, hardware, power-loss ou teste físico.

## Restrições específicas do Windows TBS/TPM (pesquisa de 2026-11-14)

- Microsoft documenta `Tbsip_Submit_Command` como fronteira para submeter comandos TPM. O Windows aplica command blocking; TPM 2.0 usa allow-list e, desde Windows 10 1809, a lista é fixa no driver e não pode ser alterada por registo.
- `TBS_SUCCESS` indica que TBS aceitou a submissão; o buffer de resposta ainda pode conter um erro TPM. O provider tem de validar ambos os resultados.
- Um NV counter TPM 2.0 é um valor de oito octetos modificado por `TPM2_NV_Increment`; a escrita NV pode ser rate-limited. Não usar increment como probe de permissões.
- CNG Platform Crypto Provider é um provider de armazenamento/uso de chaves apoiado pelo TPM, não uma API documentada de contador monotónico.
- Não existe aqui prova de que o opcode `TPM2_NV_Increment` esteja permitido para um utilizador não administrador no dispositivo-alvo. A capability do firmware não prova o filtro TBS nem a autorização do índice.
- Provisioning do índice e qualquer increment exigem consentimento explícito e teste no dispositivo físico. Sem isso, manter `unsupported`/fail-closed; nunca criar ou redefinir silenciosamente um índice perdido.

Referências:
- Microsoft TBS command submission: https://learn.microsoft.com/windows/win32/api/tbs/nf-tbs-tbsip_submit_command
- Microsoft TPM command blocking: https://learn.microsoft.com/en-us/windows/win32/tbs/command-blocking
- Microsoft Using TBS: https://learn.microsoft.com/en-us/windows/win32/tbs/using-tbs
- Microsoft CNG Key Storage Providers: https://learn.microsoft.com/en-us/windows/win32/seccertenroll/cng-key-storage-providers
- TPM 2.0 NV counter attributes: https://github.com/tpm2-software/tpm2-tools/blob/master/man/common/nv-attrs.md
