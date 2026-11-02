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

O Office Kit não tem backend obrigatório nem ligação fixa a VST, DGM-MAT ou outro produto. A integração futura deve ser um adaptador instalável/selecionável, com contrato versionado e descoberta assistida; não se deve inferir nem ligar automaticamente a um backend só por estar disponível na rede.

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

## 4. Simulador genérico de runtime
`packages/scene-engine/src/runtime-simulator.mjs` fornece um backend fictício executável sobre `RuntimeSession`. Emite snapshots neutros e regista eventos sequenciados para testes de ligação, sincronização, heartbeat, perda de comunicação, erro e reconexão. Não abre sockets, não descobre endpoints, não guarda credenciais e não executa comandos.

IDs de snapshot duplicados são ignorados pelo simulador. Snapshots antigos continuam sujeitos à validação de frescura do contrato; não podem restaurar estado operacional confirmado. O simulador serve para testar o Office Kit isoladamente e não constitui um adaptador de produção nem uma implementação de descoberta plug-and-play.
