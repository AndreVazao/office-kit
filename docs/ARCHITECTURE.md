# Office Kit — arquitetura canónica

Este documento define as fronteiras técnicas. É intencionalmente agnóstico quanto ao framework final até que um protótipo seja medido em dispositivos reais.

## 1. Regra de independência

O backend anfitrião é o sistema autoritativo e corre no seu próprio ciclo de vida. O Office Kit é um consumidor de eventos/estados e um emissor opcional de comandos explicitamente autorizados. O backend deve funcionar se o Office Kit nunca for instalado.

**Direção de dependências:**

```
Backend do projeto ──> contrato/adaptador ──> modelo de estado visual ──> cena/renderizador
                                            ↑
Configuração do escritório ──> modelo de cena ┘
Editor visual ──> configuração validada ──> modelo de cena
Simulação social local ──> animações ambientais (sem autoridade operacional)
```

O renderer não importa módulos internos de VST ou de qualquer projeto. Um adaptador traduz o protocolo do projeto anfitrião para o contrato público do Office Kit.

## 2. Camadas

### A. Contratos e modelo de domínio
Tipos versionados e neutros para projetos: Office, Building, Floor, Department, Room, Agent, Avatar, Furniture, Waypoint, Theme, ViewPreset, BackendConnection, AgentStatus, TaskSummary, DiagnosticEvent e Capability.

O modelo de domínio não deve depender de Three.js, DOM, Android, Electron/Tauri ou de uma API de backend específica.

### B. Configuração
Formato declarativo versionado (JSON como primeira opção), com schema e migrações explícitas. Guarda composição, nomes, posições, avatares, mobília, temas, opções sociais e preferências de visualização. Não guarda segredos nem tokens de autenticação.

A configuração é validada antes de entrar na cena. Configurações desconhecidas/incompatíveis devem produzir erros compreensíveis e nunca substituir silenciosamente o último ficheiro válido.

### C. Adaptadores de backend
Cada integração implementa um contrato comum de ligação, eventos, snapshot, heartbeat/idade do estado, capacidades e comandos opcionais. O adaptador:
- identifica o projeto e a instância a que está ligado;
- traduz estados de agentes/tarefas para tipos neutros;
- expõe quando o estado é atual, atrasado ou desconhecido;
- declara explicitamente quais as capacidades de comando disponíveis;
- trata autenticação e permissões no sistema anfitrião, sem expor segredos à cena;
- não permite que o renderer fale diretamente com endpoints específicos do projeto.

O primeiro adaptador de referência pode ser VST, mas os testes do core devem funcionar com um backend fictício e com zero backend.

### D. Estado de runtime
Mantém o último snapshot, timestamp, ligação, estado de cada agente e eventos visuais. Distingue estado confirmado, desatualizado e desconhecido. A reconexão requer snapshot/resincronização antes de voltar a representar trabalho como confirmado.

### E. Simulação social
Motor local e independente que gera intenção visual: ir ao café, conversar, sentar, caminhar, olhar o relógio, ir à varanda e regressar ao posto. Opera apenas com dados de composição e regras visuais. Não tem API para criar tarefas, mudar estados reais ou executar comandos.

A simulação cede a prioridade a estados operacionais confirmados quando isso for necessário para legibilidade; nunca falsifica conclusão, progresso ou disponibilidade.

### F. Scene engine e renderers
O Scene Engine converte configuração e estado neutro numa cena lógica com zonas, caminhos, pontos de interesse, estações e posições. Renderers convertem essa cena em modos visuais distintos: painel/chat, 2D, pixel diorama, 2.5D/isométrico e 3D.

A cena lógica não deve ser acoplada ao estilo gráfico. O modo pixel diorama pode adotar o enquadramento e a linguagem visual do Diorama, mas deve preservar o modelo de configuração genérico.

### G. Editor
Interface orientada a objetos e propriedades, não a parâmetros gráficos internos. Operações comuns: adicionar, duplicar, renomear, mover, apagar, organizar e pré-visualizar. Avançado: dimensões, caminhos, regras sociais, limites de renderização e metadados.

O editor grava configuração versionada; não edita código-fonte nem controla diretamente a lógica do backend.

### H. Runtime/plataformas
A lógica central deve ser reutilizável em browser/desktop/mobile. A decisão final entre browser, PWA, Tauri, Capacitor ou outra embalagem depende de um protótipo medido e não deve contaminar o core. A experiência web responsiva deve ser a referência inicial até existir evidência contrária.

## 3. Contrato mínimo de backend

O contrato deve suportar, conceptualmente:

- `connect()` / `disconnect()`;
- `getSnapshot()` para sincronização inicial e após reconexão;
- fluxo de eventos de ligação, heartbeat, agente, tarefa e diagnóstico;
- timestamp e origem para cada snapshot/evento;
- indicador de estado desatualizado e razão de desconexão;
- declaração de capacidades;
- `sendCommand()` opcional, sujeito a capability, autorização, confirmação e resposta explícita;
- encerramento limpo de listeners e recursos.

Os nomes concretos e tipos serão definidos na implementação TypeScript; este documento fixa os comportamentos exigidos, não uma API prematuramente rígida.

## 4. Máquina de estados de ligação

Estados mínimos:
- `disconnected`: nenhuma ligação ativa;
- `connecting`: tentativa em curso;
- `connected`: transporte estabelecido;
- `synchronizing`: ligação reaberta, snapshot ainda não validado;
- `live`: snapshot/eventos válidos dentro do prazo de frescura configurado;
- `stale`: existe último estado, mas excedeu o prazo;
- `error`: falha conhecida com informação útil para diagnóstico.

A UI pode usar termos mais amigáveis, mas não deve fundir estados distintos. “Connected” por si só não significa que os dados operacionais estão sincronizados.

## 5. Regras de reconexão e estado desatualizado

1. Marcar o estado como desatualizado quando expira o TTL/heartbeat configurado.
2. Parar indicadores que possam ser interpretados como progresso operacional atual.
3. Permitir animação social local, com distinção visual discreta do estado real.
4. Após reconectar, entrar em `synchronizing` e obter snapshot antes de declarar o estado `live`.
5. Não inferir eventos ocorridos durante a desconexão.
6. Se o projeto suportar replay/event log, o adaptador pode recuperar eventos; caso contrário, mostrar que o histórico é incompleto.
7. Só uma capacidade de diagnóstico autorizada pode executar ações reais; a enfermaria visual é, por omissão, apenas uma representação.

## 6. Política da enfermaria/triagem

A política é configuração de projeto/adaptador, não uma regra universal codificada no renderer. Campos conceptuais: limiar de aviso, limiar de triagem, razão, confiança, origem e ação permitida. A ausência de heartbeat pode acionar um estado visual de triagem após o tempo definido; não autoriza automaticamente reiniciar processos, mover serviços ou isolar máquinas.

Se a ligação total estiver perdida, a UI pode apresentar “sem comunicação — diagnóstico pendente”. A recuperação real precisa de confirmação do backend.

## 7. Separação de threads e recursos

- O render loop nunca executa operações de rede bloqueantes.
- O adaptador usa operações assíncronas e timeout.
- Eventos recebidos são normalizados antes de entrar no estado visual.
- O renderer pode ser reiniciado sem perder a fonte autoritativa; após reiniciar, recarrega configuração e snapshot.
- A simulação social deve ter orçamento de CPU e poder reduzir taxa de atualização/animações.
- Falhas de asset/modelo substituem-se por placeholder acessível, sem crash global.
- A observabilidade do Office Kit não deve ser confundida com telemetria do backend.

## 8. Segurança

- Nenhum segredo em JSON de escritório, logs visuais, URL de asset ou exportação.
- Não executar código incluído em configuração.
- Validar e limitar assets importados; preferir formatos e fontes explicitamente autorizados.
- Comandos perigosos exigem capacidade declarada e autorização pelo anfitrião; a UI confirma o resultado real.
- CORS, autenticação, armazenamento e transporte são responsabilidade do adaptador/host, não de hacks no renderer.

## 9. Versionamento e compatibilidade

- Configurações possuem `schemaVersion`.
- Migrações são puras, testadas e não destrutivas.
- Eventos e adaptadores são versionados separadamente da cena quando necessário.
- Mudanças incompatíveis têm migração e nota de release.
- Um renderer antigo pode recusar um schema futuro com erro claro em vez de o reinterpretar silenciosamente.

## 10. Testabilidade

A arquitetura exige testes para:
- configuração válida/inválida e migrações;
- execução com backend ausente;
- perda de ligação, TTL e reconexão;
- evento duplicado/fora de ordem;
- simulação social sem chamadas operacionais;
- isolamento de erro do renderer;
- capacidades e comandos não autorizados;
- enquadramento em retrato/paisagem e ecrãs estreitos;
- acessibilidade de rótulos, foco e navegação;
- custo de CPU/memória com elenco e mobília crescentes.


## 11. Contrato de estado runtime (v1 — implementação inicial)

O módulo `packages/scene-engine/src/runtime-state.mjs` normaliza snapshots neutros sem dependências de renderer ou de backend específico. O snapshot exige `schemaVersion: 1`, `sourceId`, `snapshotId`, `generatedAt`, `connectionState`, `synchronized`, listas de agentes e tarefas. Os estados de agente e tarefa são limitados a vocabulários explícitos; valores desconhecidos são rejeitados em vez de reinterpretados.

A função `normalizeRuntimeSnapshot(snapshot, { now, ttlMs })` deriva `live` apenas para um snapshot fresco, sincronizado e sem erro de ligação. Dados expirados ou com timestamp futuro são `stale`; após reconexão sem sincronização ficam `synchronizing`. Em qualquer estado não-live, os estados apresentados de agentes/tarefas tornam-se `unknown`, preservando o valor de origem apenas em `sourceStatus` para diagnóstico. `authoritativeStateVerified` é falso salvo em `live`.

**Limite de segurança:** o módulo valida estrutura e frescura, mas não autentica `sourceId` nem prova que a origem é confiável. O adaptador anfitrião tem de autenticar/autorizá-la antes de fornecer snapshots. Não existe ainda transporte, adaptador VST, heartbeat real ou execução de comandos.


## 12. Controlador de sessão runtime (incremento inicial)
`packages/scene-engine/src/runtime-session.mjs` fornece uma máquina de estados determinística para os adaptadores. O anfitrião chama `connect()`, `transportConnected()`, `receiveSnapshot()`, `heartbeat()`, `checkHealth()`, `disconnect()` ou `fail()`. O módulo não abre sockets nem executa comandos.

A sessão só declara `live` quando existe snapshot estruturalmente válido, sincronizado e dentro do TTL e quando o heartbeat permanece dentro do prazo. Perda de heartbeat, erro e desconexão ocultam estados operacionais confirmados. A reconexão regressa a `synchronizing` até chegar um novo snapshot fresco. O controlador não autentica a origem: isso é obrigatório no adaptador anfitrião antes de fornecer dados.


## Simulador genérico de runtime
`packages/scene-engine/src/runtime-simulator.mjs` fornece um backend fictício executável sobre `RuntimeSession`. Emite snapshots neutros e regista eventos sequenciados para testes de ligação, sincronização, heartbeat, perda de comunicação, erro e reconexão. Não abre sockets, não descobre endpoints, não guarda credenciais e não executa comandos.

IDs de snapshot duplicados são ignorados pelo simulador. Snapshots antigos continuam sujeitos à validação de frescura do contrato; não podem restaurar estado operacional confirmado. O simulador serve para testar o Office Kit isoladamente e não constitui um adaptador de produção nem uma implementação de descoberta plug-and-play. Office Kit não tem backend obrigatório: futuras integrações serão adaptadores opcionais selecionados explicitamente.


## Contrato público de adaptadores — versão inicial
`packages/scene-engine/src/adapter-contract.mjs` define API v1 neutra, valida métodos obrigatórios, metadados e capacidades permitidas. A capacidade padrão é apenas `read_state`; `send_commands` não é assumida nem ativada por omissão. O envelope de eventos exige origem, sessão, sequência, timestamp, tipo e payload. Eventos duplicados/fora de ordem e eventos expirados/futuros são recusados. A validação estrutural não autentica a origem nem substitui a autorização do anfitrião.


## Gateway de adaptadores
`packages/scene-engine/src/adapter-gateway.mjs` liga apenas um adaptador explicitamente fornecido à sessão neutra. Valida o contrato, liga o adaptador, obtém snapshot inicial, subscreve eventos, filtra eventos repetidos/fora de ordem/expirados e limpa a subscrição ao desligar. Não descobre adaptadores, não executa comandos e não autentica por si só; o anfitrião tem de estabelecer identidade e autorização antes de fornecer o adaptador.


## Catálogo explícito de adaptadores — incremento inicial
`packages/scene-engine/src/adapter-catalog.mjs` mantém em memória apenas adaptadores fornecidos explicitamente pelo anfitrião. Valida o contrato, rejeita IDs duplicados, permite listar/filtrar capacidades e selecionar um adaptador por ID com requisitos de capacidade. Não pesquisa rede/disco, não importa código e não liga adaptadores. A seleção devolve o objeto registado; a ligação continua a ser responsabilidade explícita do anfitrião através do gateway.

## 12. Adaptador genérico de demonstração (incremento de referência)

O módulo packages/scene-engine/src/generic-demo-adapter.mjs fornece uma implementação de referência do contrato v1 para testar o caminho catálogo → gateway → sessão. Mantém agentes/tarefas em memória, publica snapshots/eventos com sequência e timestamp determinísticos e permite simular heartbeat, alteração de estado e falha de transporte.

O adaptador não abre sockets, não descobre fontes, não importa código, não guarda credenciais e não executa comandos. Declara apenas read_state, read_agents e read_tasks.

A instanciação e o registo continuam a ser responsabilidade do host. O host deve autenticar a origem e autorizar explicitamente as capacidades antes de registar/selecionar/passar qualquer adaptador ao gateway. A identidade sourceId validada pelo gateway é uma verificação de consistência do envelope, não autenticação criptográfica.

O adaptador é uma ferramenta de demonstração/teste e não é um transporte de produção. Eventos de agente/tarefa são refletidos por snapshots completos, para que o RuntimeSession continue a consumir uma única representação autoritativa e validada.

