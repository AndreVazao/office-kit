# VST cockpit adapter — Fases 1, 2 e 3 (incremento de tarefas)

**Estado:** Fases 1 e 2 integradas (PRs #118 e #119); normalização de tarefas reais da Fase 3 em validação. E2E live com VST em execução continua pendente.  
**Âmbito:** apenas Office Kit. Este documento não altera nem estende o backend VST.

## Fronteira de autoridade

- VST continua a ser o único cérebro e autoridade operacional; continua a funcionar se o Office Kit fechar, for atualizado ou removido.
- O snapshot operacional é read-only. A única escrita permitida nesta fase é a rota fixa `POST /assistant/message`, limitada a conversa, consulta de estado e submissão de investigação.
- Office Kit não executa lógica de trading, não possui Risk Engine, não guarda credenciais de exchanges, não aprende nem persiste memória operacional e não controla o ciclo de vida do backend.
- O adaptador declara `read_state` e `assistant_message`; não expõe métodos HTTP, rotas, comandos ou payloads arbitrários.
- Os controlos PAPER, ações de intervenção humana e operações financeiras continuam bloqueados.
- Não são inventados agentes, tarefas, progresso ou estados. A lista `tasks` deriva exclusivamente dos pedidos devolvidos por `GET /research`; `QUEUED`/`PENDING` não significa trabalho concluído. `agents` permanece vazia porque o backend ainda não expõe um inventário autoritativo de agentes.

## Rotas VST verificadas

Os caminhos foram confirmados em VST `main` no commit `ac88989caeff86198339de38e241b3e52560e791`, em `PC_ENGINE/api/server.py` e `PC_ENGINE/api/assistant_gateway.py`.

| Área do cockpit | Método e rota | Âmbito |
|---|---|---|
| Liveness | `GET /health` | Público; não prova acesso privado |
| CEO / visão geral | `GET /status` | `read_private_state` |
| Central Memory | `GET /learning-memory/health`, `GET /learning-memory/runtime` | `read_private_state` |
| Recovery | `GET /diagnostics` | `read_private_state` |
| Radar | `GET /market-data-health` | `read_private_state` |
| Markets | `GET /venue-health` | `read_private_state` |
| Analysis / evidência | `GET /evidence-scorecard` | `read_private_state` |
| Audit | `GET /evidence-ledger/audit` | `read_private_state`; apenas resumo |
| PAPER Lab | `GET /paper-collector/resources` | `read_private_state` |
| Research | `GET /research` | `read_private_state` |
| Intervenção humana | `GET /human-interaction/pending` | `read_private_state` |
| CEO / conversa | `POST /assistant/message` | `read_private_state`; investigação requer também `submit_research` |

`GET /observer/summary` continua a ser a prova autenticada de ligação/sincronização. O endpoint `GET /evidence-ledger` não é consumido: a listagem atual não oferece paginação/limite e poderia transferir um histórico sem limite. A área Audit recebe apenas o resumo `/evidence-ledger/audit`.

## Transporte, autenticação e autorização

- Base URL fixa: `http://127.0.0.1:8765`. LAN/Tailscale não está habilitado nesta fase.
- As leituras usam apenas GET na allowlist fixa. A conversa usa apenas POST em `/assistant/message`, com body exato `{ message, department }`.
- Todas as chamadas usam `X-Token`, `cache: no-store`, `credentials: omit` e `redirect: error`.
- O token é fornecido pelo proprietário para a sessão ativa, guardado apenas em memória e limpo em disconnect, rejeição de autenticação e close. Não é escrito em CNG, SQLite, ficheiros, URLs, logs ou armazenamento visual. JavaScript não garante zeroização física de strings.
- HTTP 401 significa autenticação rejeitada: o token de sessão é limpo. HTTP 403 significa autorização/âmbito insuficiente: o token é preservado e a falha é exposta separadamente. Timeout, erro de rede ou resposta 5xx depois do envio produzem resultado `UNKNOWN`. Antes de permitir nova tentativa, o adaptador consulta uma vez `GET /research`: se encontrar o pedido, devolve o ID e o estado real; se não encontrar, só permite nova tentativa com confirmação explícita do proprietário; se a reconciliação falhar, mantém a tentativa bloqueada. Nunca existe retry automático.
- A ligação exige `read_private_state`. A submissão de investigação exige adicionalmente `submit_research`; falta desse âmbito é devolvida como recusa de autorização, não como token inválido.
- Departamentos conversacionais VST confirmados: `brain`, `markets`, `radar`, `research`, `paper`, `risk`, `recovery`, `audit` e `human`. O painel `analysis` é encaminhado de forma explícita para a fila `research`, com a marca `[Área do cockpit: Análise]`; o VST continua a ser o dono do pedido e não é apresentado um agente Analysis independente. `central_memory` não tem handler conversacional e continua read-only, devolvendo `NOT_CONNECTED` sem enviar pedido.
- Os comandos exatos PAPER de iniciar, pausar, retomar e parar são bloqueados localmente até à Fase 4. Não há rota alternativa de escrita.
- Mensagens com padrões comuns de credenciais (API key/secret, password, token, bearer) são recusadas localmente e não são enviadas ao VST. Não colar credenciais de exchange no cockpit.
- Pedidos REAL são enviados ao gateway existente e a recusa do VST é apresentada sem tentar contornar a decisão.
- `request_id` devolvido pelo backend é preservado. `QUEUED` significa aceite na fila, não execução nem conclusão. A conclusão só pode vir de estado posterior confirmado pelo backend.

## Fase 3 — estado real de tarefas

- O snapshot normaliza os pedidos do endpoint autenticado `GET /research` numa lista limitada de tarefas.
- Cada tarefa preserva o `request_id` do VST, a fila responsável (`research`), o departamento solicitado quando existe marca explícita no pedido, o estado real, timestamps, descrição, resultado e bloqueador quando o estado é `FAILED`.
- O progresso só é exposto se o backend enviar um valor numérico entre 0 e 100. A fila atual não fornece percentagem; portanto, nenhuma barra/progresso é calculada localmente.
- A lista é limitada aos 30 pedidos mais recentes fornecidos pelo VST. Estados desconhecidos e registos sem identificador válido são omitidos, sem serem convertidos em estados inventados.
- Se `/research` falhar ou devolver um formato inválido, `taskFeed.state` passa a `unavailable`/ `invalid`; lista vazia não significa fila vazia.
- `agents` continua `[]` e `agentState=not_exposed_by_backend`. O VST não oferece neste contrato uma lista de agentes individuais com identidade e estado de execução verificável.
- `departmentEvidence` expõe apenas disponibilidade das fontes reais associadas a cada área (por exemplo `/venue-health` para Markets e `/research` para Research). O campo `evidenceState` significa disponibilidade de dados, nunca que um agente/departamento está a executar trabalho.
- A área `analysis` é apenas contexto encaminhado para Research; não é apresentada como equipa independente.

## Redação e proteção de dados

- Todos os payloads passam por redator recursivo limitado: remove claim tokens, credenciais, identificadores privados, campos de caminhos, valores de formulários de intervenção humana e query/fragment/user-info de URLs; redige atribuições de tokens em texto.
- Profundidade, número de propriedades, tamanho de arrays e strings são limitados.
- O token de claim de `/human-interaction/pending` e valores de formulários são removidos; esta fase não reclama nem responde a pedidos humanos.
- O snapshot não é persistido pelo Office Kit. Não são enviados tokens ou dados privados para Vercel.

## Interface do host

Após consentimento explícito e autenticação, o host expõe `getCockpitSnapshot()` e `sendAssistantMessage({ message, department })`. O CLI aceita apenas os comandos fixos `authenticate`, `connect`, `cockpit-snapshot`, `assistant-message`, `disconnect` e `health`; o comando `assistant-message` é exclusivo da edição VST. Não existe entrada para rota, método ou comando arbitrário.

## Ainda não implementado

- Fase 3 restante: ciclo de vida de outras tarefas/departamentos, progresso verificável quando o backend o publicar e E2E de reconciliação contra uma instância VST real.
- Fase 4: controlos PAPER exclusivamente pelas rotas VST existentes e respetivas autorizações.
- Resposta/cancelamento de intervenções humanas.
- Ligação LAN/Tailscale e identidade remota.
- UI final dos painéis, Android e distribuição.
- Histórico completo do evidence ledger enquanto o backend não oferecer paginação/limites.
- E2E live contra uma instância VST e validação no PC físico.

## Próximos gates

1. Linux/Windows Node 22/26 e regressão visual Chromium no SHA exato da PR ativa.
2. Testes de 401 vs 403, falta de `submit_research`, recusa REAL, bloqueio PAPER e timeout com resultado desconhecido.
3. Teste E2E autenticado com instância VST real, sem alterar o repositório VST.
4. Manter o host Windows fail-closed até à política Authenticode autenticada pelo instalador; esta integração não contorna a issue #110.
5. Implementar estados de tarefas na Fase 3 e controlos PAPER na Fase 4, em PRs separadas.
