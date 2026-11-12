# Protocolo anti-rollback do diário de incidentes

Estado: contrato neutro e testes de conformidade implementados na branch de trabalho; protocolo crash-consistent, integração SQLite, provider TPM nativo e validação física continuam por implementar. Nenhuma proteção anti-rollback é declarada nesta fase.

## Objetivo e limite de segurança

A cadeia SHA-256 + HMAC deteta alteração de eventos e a perda de chaves. Não deteta, isoladamente, a restauração de uma cópia antiga e internamente válida da base SQLite. O objetivo é detetar que o estado persistido recuou relativamente a um estado autenticado previamente confirmado por uma âncora que não recua juntamente com o ficheiro SQLite.

A proteção só pode ser declarada quando a instalação tem uma âncora monotónica externa, autenticada e resistente ao rollback dentro do modelo de ameaça. CNG Software KSP, Registry, ficheiros locais, timestamps e outra base SQLite no mesmo volume não satisfazem este requisito.

## Modelo de ameaça

Pretende-se detetar:
- Restauro de backup SQLite antigo, incluindo prefixo válido da cadeia HMAC.
- Truncagem de eventos autenticados.
- Reposição de ficheiros locais de estado/metadata juntamente com SQLite.
- Interrupção do processo entre persistência do evento e atualização da âncora.

Não se promete proteção contra:
- Administrador/kernel comprometido enquanto o dispositivo está operacional.
- Extração física ou substituição do TPM, limpeza/reprovisionamento do TPM ou reinstalação sem recuperação da identidade.
- Rollback coordenado de todo o dispositivo/firmware/TPM por um atacante com capacidades superiores às garantias do hardware.
- Perda definitiva da âncora ou das chaves sem recuperação aprovada pelo proprietário.

## Arquitetura por providers

Contrato neutro no core, sem chamadas nativas:
- `MonotonicAnchorProvider.read()`: devolve contador/geração, digest comprometido, identidade da âncora e estado de confiança.
- `MonotonicAnchorProvider.advance(expected, next)`: compare-and-advance atómico; rejeita valores inesperados ou recuo.
- `MonotonicAnchorProvider.capabilities()`: declara durabilidade, atomicidade, escopo e resistência a rollback, sem inferir proteção.
- Estados explícitos: `protected`, `unsupported`, `unprovisioned`, `unavailable`, `mismatch`, `recovery_required`.

O provider Windows TPM deverá usar TPM 2.0 NV index/counter com autorização e atributos definidos durante provisioning consentido. A implementação nativa terá de validar presença/capacidades TPM, disponibilidade do índice, autorização, erros de clear/reprovision e comportamento entre reinícios. TBS/TPM API é uma fronteira nativa; não assumir que o Windows Software KSP implementa contador monotónico.

Um provider cloud pode ser considerado futuramente como opção separada, com serviço externo que forneça compare-and-advance autenticado. Nunca é obrigatório, nunca substitui automaticamente o TPM e a indisponibilidade de rede não deve degradar silenciosamente um estado protegido para não protegido.

## Protocolo crash-consistent

A unidade de compromisso é um checkpoint de journal: `installationId`, sequência final, hash do último evento, MAC final, geração da âncora e versão do protocolo.

1. Ler e verificar a cadeia HMAC completa; validar identidade/escopo da âncora.
2. Ler a âncora e comparar o checkpoint SQLite com o checkpoint ancorado.
3. Preparar o próximo checkpoint de forma determinística.
4. Persistir no SQLite o checkpoint preparado e os eventos correspondentes numa transação durável.
5. Avançar a âncora por compare-and-advance, ligando a geração seguinte ao digest do checkpoint preparado.
6. Marcar o checkpoint SQLite como confirmado numa segunda transação durável.
7. Só depois declarar o novo estado confirmado ao chamador.

Recuperação no arranque:
- SQLite confirmado e âncora igual: estado consistente.
- SQLite preparado e âncora ainda no checkpoint anterior: repetir advance idempotente, apenas se o predecessor corresponder exatamente.
- SQLite preparado e âncora já no novo checkpoint: finalizar a confirmação local.
- Âncora mais avançada do que qualquer checkpoint local recuperável: fail-closed, `recovery_required`.
- SQLite mais antigo do que a âncora ou digest divergente: rollback/truncagem detetado; não reparar nem sobrescrever automaticamente.
- Âncora ausente, limpa, inacessível ou reconfigurada: nunca criar silenciosamente uma âncora nova para uma instalação previamente protegida.

O provider precisa de garantir atomicidade compare-and-advance. Se o hardware só permitir contador sem digest, o protocolo deve armazenar um compromisso criptográfico autenticado associado à geração e provar que o contador não pode avançar sem registo recuperável. Não aceitar uma implementação que apenas incremente o contador depois de gravar, sem estado preparado e recuperação determinística.

## Provisioning, backup e recuperação

- Provisioning exige consentimento explícito do proprietário e regista a identidade/capacidades da âncora.
- Backup deve incluir instruções e material recuperável permitido, mas nunca exportar chaves privadas não exportáveis nem alegar que SQLite isolado basta.
- Restore de SQLite para a mesma âncora deve ser validado e normalmente detetado como rollback se estiver abaixo do checkpoint.
- Migração para novo hardware/TPM exige fluxo de transferência explícito, autenticação do proprietário e registo de desativação da âncora anterior quando possível.
- Perda/clear do TPM exige estado `recovery_required`; nunca reset automático.
- Retenção de histórico e rotação de chaves MAC permanecem independentes da geração monotónica.

## Gates obrigatórios

1. Testes unitários do contrato neutro e transições de estado.
2. Fault injection em cada fronteira de persistência/advance, incluindo crash antes/depois de cada operação.
3. Testes de concorrência e compare-and-advance; duas instâncias não podem confirmar a mesma geração.
4. Testes de rollback para prefixo HMAC válido, truncagem, backup antigo e mismatch de installation ID.
5. Windows CI com provider fake determinístico; não confundir com hardware.
6. Windows runner com TPM virtual/emulado, se disponível, apenas como evidência de integração API, não de segurança física.
7. Teste em TPM 2.0 físico com reinício, clear/reprovision, falhas de energia e recuperação de backup.
8. CI Linux/Windows e regressão visual no mesmo HEAD antes de merge.

## Critério de declaração

- Sem provider monotónico validado: `integrity=authenticated_only`, `rollbackProtection=unsupported|unavailable`.
- Com provider provisionado e verificado: `rollbackProtection=protected`.
- Em divergência ou perda da âncora: `rollbackProtection=recovery_required`; bloquear exportação/ações que dependam de integridade até resolução autorizada.

Nenhum teste fake, runner genérico ou CNG Software KSP pode ser apresentado como validação de TPM físico.
