# Protocolo anti-rollback do diário de incidentes

Estado em 15 de novembro de 2026: contrato genérico, coordenador crash-consistent, journal SQLite, writer append/update, integração no Windows host, recuperação após terminação de processo e exclusão entre processos estão integrados. **Ainda não existe provider TPM 2.0 de produção; o build normal não declara proteção anti-rollback.** O Windows host mantém agora dois níveis explícitos: `authenticated_only` permite persistência SHA-256 + HMAC sem proteção contra rollback; `protected` exige uma âncora monotónica validada. Uma instalação que já esteve em `protected` não pode degradar automaticamente para `authenticated_only`: um marcador persistente no CNG vault força `recovery_required` se a âncora desaparecer.

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


## Deteção preliminar do TPM no Windows — sem provisioning

O helper Windows expõe o comando interno `tpm-info`, baseado em `Tbsi_GetDeviceInfo`. A chamada reserva uma estrutura de quatro campos `UINT32` (16 bytes) e só interpreta o resultado depois de `TBS_SUCCESS`. O schema de saída atualmente aceite é `structVersion=1`; os campos reservados não participam em decisões de segurança.

Estados possíveis: `detected_tpm_2_0`, `detected_tpm_1_2`, `not_present`, `unsupported_schema`, `unsupported_tpm_version` e `unavailable`. Um resultado TPM 2.0 significa apenas que a API reportou essa versão. Não demonstra que o TPM é físico, que um NV index está disponível, que comandos NV são permitidos, nem que existe uma âncora monotónica.

A operação não cria contextos TBS, não submete comandos TPM através de `Tbsip_Submit_Command`, não provisiona índices e nunca altera o estado de proteção do diário. A ausência de TBS, um erro da API ou um schema desconhecido não pode ser interpretado como TPM ausente nem como autorização para provisioning. Nenhum campo de saída é usado quando a chamada falha.

A documentação Microsoft identifica `Tbsi_GetDeviceInfo` como consulta da versão TPM e exige espaço para quatro valores de 32 bits. A referência de `TPM_DEVICE_INFO` descreve os quatro campos e os dois valores TPM suportados; a interpretação do primeiro campo como schema de saída versão 1 é sustentada pela documentação técnica Microsoft adicional, não pela descrição ambígua atualmente publicada na página da estrutura. O helper rejeita schemas desconhecidos e não infere compatibilidade futura.

Esta chamada não fornece contrato publicado sobre cache/frescura, arranque implícito de serviços, atividade física do TPM, duração máxima ou cancelamento. Por isso, a deteção é apenas informativa e não é usada como health check com garantias temporais nem como gate de segurança.

Referências:
- Microsoft `Tbsi_GetDeviceInfo`: https://learn.microsoft.com/en-us/windows/win32/api/tbs/nf-tbs-tbsi_getdeviceinfo
- Microsoft `TPM_DEVICE_INFO`: https://learn.microsoft.com/en-us/windows/win32/api/tbs/ns-tbs-tpm_device_info
- Microsoft TBS API overview: https://learn.microsoft.com/en-us/windows/win32/api/_tbs/

## Consulta nativa de capacidades NV — fase read-only

O helper Windows acrescenta o comando explícito `tpm-capabilities`. Só cria um contexto TBS TPM 2.0 depois de confirmar `Tbsi_GetDeviceInfo` com schema conhecido e versão 2.0. Envia exclusivamente `TPM2_GetCapability(TPM_CAP_COMMANDS)`, uma consulta sem autorização e sem mutação de estado NV.

A resposta é validada em duas camadas: código de retorno TBS e cabeçalho/código de resposta TPM. O parser valida tag, tamanho declarado, capability devolvida, contagem e comprimento exato da lista antes de interpretar os command codes. O contexto TBS é fechado em `finally`, incluindo respostas de erro.

O resultado enumera se o TPM anuncia os command codes NV_DefineSpace, NV_UndefineSpace, NV_Increment, NV_Read, NV_ReadPublic e NV_Write. **Anúncio não significa permissão**: não confirma que o filtro TBS do Windows permite o comando ao processo, que a autorização NV é conhecida, que o índice existe, nem que compare-and-advance seja atomicamente seguro. Por isso, `tbsCommandPermissionVerified=false`, `nvProvisioningPerformed=false`, `monotonicAnchorAvailable=false` e `protectionPromotionAllowed=false` em todos os resultados.

Esta fase não define, incrementa, lê, escreve ou elimina índices NV. Também não recolhe nem exporta owner/platform authorization. O próximo passo é desenhar o protocolo de provisioning e a associação autenticada entre contador e digest do checkpoint; não se deve usar um contador NV isolado como se guardasse o checkpoint completo.

Referências Microsoft:
- `Tbsi_Context_Create`: https://learn.microsoft.com/en-us/windows/win32/api/tbs/nf-tbs-tbsi_context_create
- `TBS_CONTEXT_PARAMS2`: https://learn.microsoft.com/en-us/windows/win32/api/tbs/ns-tbs-tbs_context_params2
- `Tbsip_Submit_Command`: https://learn.microsoft.com/en-us/windows/win32/api/tbs/nf-tbs-tbsip_submit_command
- `TPM Base Services`: https://learn.microsoft.com/en-us/windows/win32/api/_tbs/

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

PR #89: `MonotonicIncidentWriter` encaminha append/update do core pelo coordenador; o update vincula a revisão e o hash do snapshot predecessor. O journal aceita apenas payloads reconhecidos e avanço de sequência unitário.

PR #90: o Windows host encaminha todas as mutações pela fachada monotónica e mantém o lock de processo. Escritas não ancoradas não podem contornar o writer quando a instalação está protegida.

PR #91: testes SQLite/WAL terminam um processo filho nas duas fronteiras críticas e comprovam recuperação após reopen. A âncora de teste é fake; não equivale a TPM ou power-loss físico.

PR #93: teste multiprocesso comprova que uma segunda instância do Windows host não consegue concorrer com a primeira durante o compromisso monotónico.

PR #95 (integrada por squash em 2026-11-15; merge `68be0150c8f5ecd5a59f28a99426110c0c9fed08`, final PR HEAD `514736e844a51da0d3b3e74f0485e6b535d14eb1`): permite `authenticated_only` apenas numa instalação nunca protegida, com provider explicitamente `unsupported`, sem prepare pendente e geração local zero. O CNG vault guarda um marcador persistente de enrollment; se uma instalação previamente protegida perder a âncora, passa a `recovery_required` e bloqueia escritas. CI `43710997821` e regressão visual Chromium `43710997810` passaram no mesmo HEAD. O teste específico usa SQLite/WAL real e secret vault fake; não é prova TPM nem validação física.

Gates ainda obrigatórios:
1. Provider TPM 2.0 nativo com provisioning consentido e compare-and-advance verificável.
2. Testes de rollback de prefixo HMAC, truncagem, backup antigo e mismatch de installation ID ligados ao provider real.
3. Windows runner com TPM virtual/emulado, se disponível, apenas como evidência de API.
4. TPM 2.0 físico com reinício, clear/reprovision, falhas de energia e restore.
5. Providers equivalentes para Linux, macOS e Android.
6. CI Linux/Windows e regressão visual no mesmo HEAD antes de merge.

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


## Resultado final da PR #95 — 2026-11-15

A PR #95 foi integrada por squash em `68be0150c8f5ecd5a59f28a99426110c0c9fed08`. O HEAD final da PR foi `514736e844a51da0d3b3e74f0485e6b535d14eb1`; CI `43710997821` e regressão visual Chromium `43710997810` concluíram com sucesso nesse mesmo SHA.

O modo `authenticated_only` mantém a cadeia SHA-256 + HMAC e permite incidentes numa instalação nova nunca protegida, sem fingir uma âncora externa. Declara sempre `rollbackProtection=unsupported` e `hardwareBacked=false`. O marcador CNG impede downgrade de uma instalação anteriormente protegida. Se a âncora desaparecer, a escrita fica bloqueada em `recovery_required`.

O teste específico de modo autenticado usa SQLite/WAL real, provider de âncora explicitamente unsupported e secret vault fake de teste. As verificações nativas Windows CNG do workflow são passos separados. Não foi executado comando TPM, provisionado hardware TPM nem validado PC físico. Os gates TPM, backup/restore, power-loss e providers multiplataforma continuam abertos.
## 2026-11-17 — read-only TPM NV command capability discovery

PR #102 was squash-merged as `5319c132386a6d619cafa13e0bf2669103623ce8` from final PR HEAD `707ad1c2f07347f3379df1293b9e82cc1b93642d`. CI run `44041193372` and Chromium visual run `44041192318` both passed on that exact PR HEAD. The Windows Node 22 and Node 26 jobs executed the native helper build, CNG integration suite, TPM helper integration test and portable bundle E2E; Linux jobs correctly skipped Windows-only native steps.

The helper's `tpm-capabilities` command checks TPM 2.0 metadata, creates a TBS context, and submits only `TPM2_GetCapability(TPM_CAP_COMMANDS)`. It does not define, increment, read, write or undefine NV indexes. TPM-advertised command codes do not prove that Windows TBS permits those commands to this process, that NV authorization is available, or that a durable atomic monotonic anchor can be implemented.

The integration test accepts explicit unavailable/not-present/rejected outcomes. A green CI result therefore proves the helper build and result handling, not that a physical TPM was present or returned a capability list. No physical TPM provisioning or monotonic protection was performed.

PR #103 was squash-merged as `51d5db49309e02f2e42594194ab778651e26d2ae` from final PR HEAD `dd6e74faf7d66b3f6459a397f3357b2bf759e5eb`; CI run `44095809628` and Chromium visual run `44095809554` passed on that exact SHA. The parser now requires the no-sessions response tag used by this request, validates exact framing and boolean `moreData`, rejects duplicate command codes, and reports absent commands as unknown when the response says more data remains. A deterministic .NET protocol harness covers valid, partial, malformed, duplicate and truncated frames. Synthetic protocol tests are not physical TPM evidence. This remains discovery-only and cannot promote the journal to `protected`.
