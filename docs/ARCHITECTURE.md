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

## Instalação independente, propriedade e privacidade

O Office Kit é um produto instalável/licenciável para utilização independente. Cada instalação pertence ao respetivo proprietário/cliente e mantém o seu próprio espaço privado: configuração do escritório, edifícios, pisos, departamentos, salas, avatares, assets, preferências e dados locais. Não existe partilha, sincronização, diretório central de utilizadores ou ligação entre instalações por omissão. Uma instalação deve funcionar integralmente em modo local, sem conta central, backend externo ou ligação à Internet, salvo funcionalidades opcionais que dependam explicitamente de serviços externos.

A ligação a um backend é uma decisão explícita do proprietário e é configurada separadamente da seleção de adaptador. Não há descoberta, emparelhamento, telemetria ou conexão automática. Cada integração externa exige identificação do destino, autenticação/autorização própria e consentimento do proprietário. Dados de uma instalação nunca são enviados para outra instalação ou para o fornecedor do Office Kit por defeito. Exportações, cópias de segurança e sincronização futura são ações explícitas e controladas pelo proprietário. A arquitetura comercial deve suportar licenças/cópias independentes sem transformar o fornecedor do Office Kit num operador obrigatório da infraestrutura do cliente.

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



## Avatar Studio — arquitetura e requisitos

O Avatar Studio é uma camada de autoria visual independente do backend e do renderer específico. Cada Avatar é uma entidade de configuração com identidade estável, nome apresentado, função, departamento, perfil visual, assets e preferências de animação. O avatar não é o agente de backend: a associação entre Avatar visual e Agent/runtime é explícita, opcional e substituível sem perder a identidade visual.

### Tipos e apresentação
O catálogo inicial deve incluir apresentação humana masculina, humana feminina, robótica masculina, robótica feminina e robótica/neutra personalizável. A classificação é uma escolha de apresentação visual, não uma regra sobre voz, função, competências ou comportamento. Deve ser possível criar estilos adicionais sem alterar o contrato base.

### Personalização
As propriedades configuráveis incluem, conforme suportado pelo modelo/renderer: cabelo (corte, comprimento, penteado e cor), olhos (cor e formato), rosto, sobrancelhas, barba/bigode, tom de pele, corpo/proporções, roupa, calçado, acessórios, materiais, paleta e animações. Os controlos devem adaptar-se ao tipo de avatar; opções indisponíveis não devem aparecer como se fossem suportadas.

### Fotografia de referência
O utilizador pode opcionalmente fornecer uma fotografia para criar uma representação visual semelhante. O fluxo deve permitir escolher estilo (realista, 3D, ilustração, futurista/robotizado), gerar uma proposta, ajustar traços e aprovar antes de guardar. A fotografia é dado privado: consentimento explícito, processamento através de fornecedor/serviço opcional e claramente identificado, sem envio automático a backends de agentes; retenção da fotografia original desligada por omissão; opção para apagar original e derivados. O Office Kit não deve prometer semelhança perfeita nem exigir fotografia para criar um avatar. A funcionalidade depende de um pipeline de geração/edição de imagem que ainda terá de ser selecionado e integrado.

### Assets, portabilidade e segurança
Guardar no documento de configuração apenas referências/IDs de assets e propriedades; assets podem ser empacotados no bundle exportado ou referenciados por biblioteca autorizada. Validar formato, tamanho, dimensões e conteúdo dos ficheiros importados; não executar conteúdo ativo. Exportação deve permitir incluir os assets necessários, respeitando licenças. Deve ser possível substituir o modelo/renderer mantendo o perfil lógico do avatar e recorrer a um placeholder acessível quando um asset não está disponível.

### Separação e desempenho
O avatar visual não é prova de identidade real nem de atividade operacional. Estados de trabalho vêm exclusivamente do runtime verificado; animações locais continuam marcadas como simulação. Modelos detalhados devem ter níveis de detalhe e fallback para dispositivos modestos. O Avatar Studio deve funcionar offline para edição de modelos e presets que já estejam instalados; geração a partir de fotografia pode exigir serviço externo opcional.

## Distribuição gráfica adaptativa e catálogo universal de avatares

O Office Kit deve distribuir os modos visuais em camadas independentes e progressivas. A escala de referência vai de interface/chat e representação 2D leve, passando por diorama/pixel art e 2.5D/isométrico, até 3D avançado e apresentação realista/cinemática. A camada de domínio, a configuração do escritório e a identidade dos avatares não dependem de um renderer específico.

Na instalação/primeira execução, um avaliador de capacidades verifica plataforma, sistema operativo, arquitetura, memória disponível, GPU/API gráfica, suporte a aceleração, armazenamento e limites térmicos/performance quando mensuráveis. Com base num manifesto de compatibilidade versionado, o instalador instala apenas os runtimes, renderers e pacotes de assets que a máquina suporta. Deve instalar todos os níveis compatíveis, não apenas o nível máximo detetado. A avaliação não pode prometer desempenho com base apenas no nome/modelo do dispositivo: deve combinar capacidades declaradas, testes curtos e limites conservadores.

A seleção automática escolhe inicialmente o nível mais alto que passe os critérios de compatibilidade e desempenho. O utilizador pode sempre descer manualmente para qualquer nível inferior instalado e voltar a ativar o automático. Não se tenta carregar um renderer incompatível; a transição para fallback deve preservar a sessão, a composição do escritório e a identidade dos avatares. O sistema pode recomendar a instalação de um nível adicional quando necessário, mas a instalação de componentes opcionais deve ser transparente e autorizada pelo proprietário.

O catálogo lógico de avatares é universal entre modos. Um Avatar mantém o mesmo ID, nome, perfil, associação a Agent e histórico visual, podendo disponibilizar variantes de asset/LOD para diferentes renderers. Se a variante 3D não estiver instalada, usa-se a variante 2D/placeholder compatível; não se remove o avatar do catálogo. Os tipos humano, robótico, neutro e personalizados devem estar disponíveis em todos os modos na medida em que existam assets compatíveis. Os assets de maior qualidade são instalados apenas quando o dispositivo os suporta e o pacote foi selecionado/validado.

O manifesto de pacotes deve declarar dependências, plataformas, APIs gráficas, memória mínima recomendada, tamanho, versão, hash, licença e níveis de fallback. Atualizações e remoções não podem apagar perfis/configurações do utilizador. A falta de um pacote nunca deve impedir o arranque do modo mais simples.

## Rede privada de escritórios e organização multi-computador

Uma instalação isolada é o modo padrão e deve funcionar sem comunicar para fora. Porém, instalações pertencentes ao mesmo proprietário/organização podem ser agrupadas numa rede privada explícita, por exemplo numa LAN doméstica ou empresarial. Privacidade significa ausência de comunicação externa e de partilha com terceiros por omissão; não significa proibir comunicação entre nós que o proprietário autorizou dentro do seu próprio domínio de confiança.

Cada computador pode executar o seu próprio Office Kit e representar o departamento, edifício, unidade ou conjunto de agentes local. Um Office Kit central/unificado pode agregar as representações de vários nós autorizados e apresentar uma cidade/campus com vários edifícios. Os escritórios locais continuam operacionais e autónomos; a vista unificada é uma projeção agregada, não uma autoridade que substitui os backends locais.

A federação é opcional, explicitamente configurada e limitada a pares/nós aprovados. Não existe descoberta pública, emparelhamento automático com organizações desconhecidas, relay central obrigatório, cloud account obrigatória ou comunicação para fora por omissão. O onboarding de cada nó exige identidade de instalação, confiança mútua, autenticação forte, autorização por organização/departamento/capacidade e revogação. A identidade de instalação não deve ser confundida com sourceId estrutural dos eventos. Credenciais e chaves ficam fora da configuração exportável e nunca são enviadas ao renderer.

O protocolo entre nós deve transportar apenas os dados necessários à visualização e coordenação autorizada: identidade estável do nó, catálogo de departamentos/edifícios, avatares e respetivas associações, estados operacionais verificados, eventos com sequência/timestamp, heartbeat e capacidades. Comandos ou ações operacionais não são implicitamente permitidos pela federação visual; exigem autorização explícita do backend anfitrião e confirmação do resultado. Em falha de rede, o nó local continua a funcionar e a vista agregada marca os dados remotos como atrasados/desconectados, sem inventar atividade atual.

A cidade virtual pode representar deslocações e encontros entre edifícios, mas estas animações são apenas visuais. A transferência real de agentes/tarefas entre departamentos ou computadores só pode ser mostrada como confirmada quando o sistema operacional autoritativo a confirmar. A simulação social nunca cria migrações, tarefas ou comunicações reais.

A separação de dados deve ser por organização e por nó. Um utilizador pode ter vários escritórios pessoais isolados ou criar uma organização privada com vários nós autorizados; estes cenários não devem misturar dados. Exportação, backup, migração, sincronização e federação são operações/configurações explícitas, controladas pelo proprietário.

## Descoberta automática e conectividade privada entre nós

A federação de escritórios deve abstrair descoberta, autenticação e transporte em providers independentes. O utilizador escolhe uma organização e aprova o emparelhamento; não deve introduzir IPs, portas, DNS ou comandos de rede. “Automático” significa descoberta e reconexão depois de uma autorização inicial explícita — nunca aceitar automaticamente qualquer máquina que encontre.

### Estratégia de ligação por níveis

1. **LAN local (provider mDNS/serviço local):** procurar anúncios Office Kit na rede local, limitados a metadados mínimos. A descoberta apenas apresenta candidatos; não concede acesso. Confirmar a identidade criptográfica do nó e exigir aprovação do proprietário/administrador antes de aceitar a associação.
2. **Overlay privado existente (provider Tailscale):** detetar de forma opcional se o cliente Tailscale está instalado e ligado. Usar nomes MagicDNS/identidade de dispositivo quando disponíveis, sem pedir ao utilizador para copiar IPs. O Office Kit não deve incluir credenciais administrativas Tailscale, gerar auth keys com segredos embutidos, nem alterar o tailnet sem consentimento. Se não estiver configurado, apresentar um fluxo assistido que abre o login/consentimento oficial; não alegar que consegue configurar silenciosamente a conta do utilizador.
3. **Rendezvous hospedado pela organização (provider opcional):** um serviço HTTPS com slug/nome próprio da organização regista leases temporárias de presença e troca apenas metadados de descoberta, chaves públicas, capacidades autorizadas e informação de conectividade necessária. Clientes fazem ligações de saída; não requer IP público fixo nem portas de entrada. O serviço não recebe snapshots completos, prompts, histórico de agentes ou dados do escritório.
4. **Transporte entre nós:** preferir overlay privado aprovado (Tailscale ou equivalente); caso exista um transporte P2P seguro suportado, tentar ligação direta; usar relay apenas se explicitamente habilitado e com política/retensão claras. Um rendezvous por si só não transporta tráfego entre máquinas atrás de NAT.
5. **Modo local degradado:** se não houver transporte disponível, manter o nó operacional localmente e marcar os outros nós como disconnected/stale. Não fingir sincronização nem enfileirar comandos perigosos para execução posterior sem política explícita.

### Vercel e hosting

Vercel pode alojar o portal de onboarding, o diretório/rendezvous HTTPS e APIs curtas de registo/heartbeat. WebSockets estão atualmente disponíveis em Vercel Functions, mas as ligações têm limites de duração e o estado não é partilhado automaticamente entre instâncias; persistência/coordenação distribuída requer armazenamento externo apropriado. Por isso, Vercel não deve ser tratado como túnel privado, VPN ou relay de tráfego bruto. Se for necessário relay contínuo, usar um serviço de relay dedicado e documentar custo, região, limites e modelo de privacidade. O deploy pode ser gerado para a conta/infraestrutura do cliente, ou fornecido como serviço opcional; nenhum dos dois pode ser obrigatório para o modo standalone.

### UX de onboarding sem conhecimento técnico

- Primeiro arranque: opção recomendada **“Ligar computadores da minha organização”**, com explicação simples do alcance e dos dados partilhados.
- Deteção automática: procurar primeiro LAN e instalações Tailscale existentes; mostrar estado e próximo passo em linguagem simples.
- Se ainda não existir rede privada entre locais: oferecer “Usar Tailscale” (abrir instalação/login oficial) ou “Criar diretório privado da organização” (deploy guiado de rendezvous). Não pedir tokens, chaves de API ou IPs manualmente em fluxos normais.
- Mostrar claramente o proprietário/organização, o nó que pede acesso, as permissões pedidas e os departamentos/capacidades a expor. A associação remota exige aprovação explícita; revogação deve ser simples.
- Não armazenar credenciais administrativas de fornecedores no cliente. Segredos de deploy ficam no ambiente seguro do provider/conta do cliente. Nunca colocar segredos no bundle desktop/mobile, no repositório ou na configuração exportada.

### Identidade, autorização e frescura

Cada instalação cria uma identidade criptográfica de nó e uma identidade de organização. O rendezvous emite apenas convites/leases limitados; a confiança final é estabelecida por prova criptográfica e aprovação. Usar credenciais de curta duração, rotação/revogação, autorização granular por nó, departamento e capacidade, sequência monotónica de eventos, timestamps, heartbeats e limites contra replay. Não usar nome de máquina, slug ou sourceId como prova de identidade. O serviço de descoberta não pode autorizar comandos: o backend anfitrião continua a validar toda a ação.

### Providers e testes

O core expõe interfaces neutras para `DiscoveryProvider`, `PrivateTransportProvider` e `OrganizationDirectoryProvider`. Providers LAN, Tailscale e rendezvous/cloud são opcionais e intercambiáveis; nenhuma dependência de VST, DGM-MAT, Vercel ou Tailscale entra no core. Testar descoberta com nomes/IPs dinâmicos, colisões, nós não confiáveis, replay, expiração, revogação, perda de Internet, NAT/relay, reinício de nós, organização errada e isolamento total entre tenants.
 
## Primeiro incremento executável da federação — contratos v1

O módulo `packages/scene-engine/src/federation-contract.mjs` fornece validadores puros e interfaces abstratas para descoberta, transporte privado e diretório de organização. O contrato valida descriptors públicos de nó (incluindo fingerprint SHA-256), capabilities, hints LAN/Tailscale/HTTPS/relay, leases temporárias limitadas e envelopes de evento schema v1 com sessão e sequência. Não executa I/O nem concede confiança ou autorização. A validade do fingerprint só se torna prova de identidade quando um futuro handshake criptográfico demonstrar posse da chave correspondente; neste incremento é apenas metadado validado. Nenhum provider concreto ou conectividade de rede foi implementado.


## Identidade criptográfica de nó — fronteira inicial

`packages/scene-engine/src/node-identity.mjs` introduz `NodeIdentityManager` e a interface `NodeKeyStoreProvider`. Cada nó tem escopo de organização/identificador, algoritmo explícito (`Ed25519` ou `ECDSA-P256-SHA256`), chave pública codificada e fingerprint SHA-256. A prova de posse assina um desafio com nonce aleatório, audiência e janela temporal curta (máximo 60 segundos); a verificação usa a chave pública e o algoritmo declarado, sem downgrade implícito. Rotação cria uma nova geração e revogação remove a chave privada através do provider. O armazenamento da chave privada e dos metadados é injetado, não acoplado ao core.

`EphemeralEd25519KeyStore` e `EphemeralP256KeyStore` são providers efémeros de referência para testes: não persistem chaves entre reinícios e não devem ser usados em produção. `WindowsCngP256KeyStore` usa um helper .NET nativo para criar chaves ECDSA P-256 persistentes e não exportáveis no Microsoft Software Key Storage Provider, com nomes opacos delimitados pelo installation ID. A proteção é OS/software-backed; o provider declara explicitamente `hardwareBacked=false` e não afirma TPM. A integração real é executada no runner Windows CI; instalador, desinstalador e PC físico continuam por validar. Os providers de macOS, Linux, Android e browser continuam por implementar. A existência de uma prova válida demonstra posse da chave para aquele desafio, mas não substitui aprovação do proprietário nem autorização por organização/capacidade. Este módulo não faz rede, descoberta ou sincronização.


## Edições de produto e instalações pessoais

O produto mantém um único core e três perfis de distribuição/configuração: **Universal** (público, sem dependências de backend), **DGM-MAT** (pessoal, adaptador permitido `dgm-mat`) e **VST** (pessoal, adaptador permitido `vazao-sovereign-trader`). As edições pessoais não são forks do core: são perfis privados que podem incluir adaptadores fornecidos separadamente.

Cada instalação recebe `installationId` e `storageNamespace` próprios. O utilizador pode instalar DGM-MAT e VST na mesma máquina, mantendo configuração, credenciais, dados, memória, avatares e logs isolados. A versão Universal não inclui nem depende dos adaptadores pessoais. Os adaptadores continuam sujeitos ao contrato público, autenticação do anfitrião, consentimento explícito e permissões concedidas.

Os perfis não estabelecem ligações automaticamente. O estado inicial é não configurado; a ligação requer ação explícita do proprietário. O modo inicial dos adaptadores é leitura. A existência do perfil DGM-MAT/VST não significa que o respetivo adaptador ou protocolo de integração já esteja implementado.


### Entrypoints por plataforma
O entrypoint genérico `packages/scene-engine/src/index.mjs` é browser-safe e não deve importar módulos que dependam de APIs Node ou de sistema operativo. Providers nativos são expostos por entrypoints específicos, como `packages/scene-engine/src/windows.mjs`; aplicações web e a edição Universal não devem importar esse entrypoint. O host de cada plataforma injeta explicitamente o provider adequado. Esta separação evita que dependências nativas contaminem o runtime visual/browser.


## Gateway de runtime — sequencia e sincronização fail-closed
`AdapterGateway` recebe apenas o adaptador explicitamente selecionado pelo host. A subscrição é instalada antes da leitura do snapshot inicial e os eventos iniciais são guardados numa fila limitada; só são processados depois do snapshot. A bridge fixa a identidade da origem ao `metadata.id` do adaptador e mantém uma única sessão de eventos até desconexão/religação. Lacunas de sequência, mudança de sessão sem reconnect, overflow da fila e eventos incrementais agent/task ainda sem contrato de patch retiram a autoridade do runtime (fail-closed). Heartbeats não elevam um estado não sincronizado a live. Autenticação, autorização, credenciais e transporte continuam responsabilidade do host; não há descoberta nem dispatch de comandos.


## 13. Windows node identity runtime boundary

The Windows-only entry point `packages/scene-engine/src/windows.mjs` exposes `createWindowsNodeIdentityRuntime`. It composes the native `WindowsCngP256KeyStore` with SQLite-backed public identity metadata and one-time challenge replay storage. The browser-neutral entry point must not import this module or its Node/.NET dependencies.

The factory receives a host-owned SQLite adapter, installation ID and published CNG helper path. It does not open or secure the database file, create Windows ACLs, encrypt or back up the database, install/update/remove the helper, or manage process lifecycle. The host must provide these controls and must preserve the same installation scope when reopening the runtime. Private keys remain in the Windows CNG provider; SQLite stores public metadata and opaque handles only. Microsoft Software KSP is OS-protected and software-backed, not TPM/hardware-backed.

PR #46 validated create/prove, SQLite close/reopen, manager recreation, identity persistence, challenge replay rejection and revocation on a Windows CI runner. The separate PR #44 CNG test validates key persistence across helper processes. Neither test is a full host-process/system restart or physical-PC installation test. Until the native host and installer exist, this factory is a platform integration component, not an installable Office Kit product.

## 14. Windows local host composition root
O pacote `packages/windows-host` fornece o primeiro host local executável para Windows. É separado do core e do entrypoint browser-neutral. O host cria um diretório por instalação, restringe ACLs ao utilizador atual e SYSTEM, guarda um installation ID estável, impede instâncias concorrentes, abre SQLite local e compõe o runtime CNG já existente.

O helper só é aceite quando a assinatura Authenticode é válida. O host reconcilia a identidade antes de reportar health e encerra a base de dados/lock de forma explícita. O arranque não cria identidade, não inicia listeners, não descobre backends e não executa comandos remotos. As operações de identidade são ações locais explícitas.

O CLI depende de Windows e Node.js 22.5+ (`node:sqlite`). A implementação não inclui ainda instalador, certificado de release, serviço Windows, UI, atualização/rollback ou backup/restore. O helper gerado no CI ainda não tem assinatura confiável; por isso, os testes injetam o verificador e não alegam que o artefacto CI pode ser executado pelo host de produção.
## Office Health & Recovery, Social Simulation and Adaptive Rendering

The architecture separates five authorities:
- SocialSimulationEngine owns local, non-operational avatar behavior when no confirmed backend work is available.
- BackendActivityEngine owns only fresh snapshots/events/progress supplied by the selected adapter.
- OfficeHealthRecoveryEngine currently provides host-injected layered diagnostic probes, evidence classification, redaction and a bounded per-call runner for explicitly supplied local recovery actions. Durable incident persistence is delegated to a host-supplied IncidentStore; the bundled InMemoryIncidentStore is reference/test-only.
- AdaptiveRenderingEngine is the target authority for rendering a shared scene/behavior model through advanced 3D, low-poly, pixel or minimal renderers. The current increment adds a resource-policy module, not production renderers, device telemetry or host integration.
- OfficeStateManager is currently a pure state-arbitration module that prevents simulated activity from being represented as backend work; host/UI integration remains pending.

### Failure attribution and recovery
Diagnostics are host-injected and may probe the Office Kit runtime, adapter, transport/network and backend only through explicitly authorized read-only checks. Results carry evidence, timestamps, confidence and classification. In the current implementation, deterministic probe failures are classified as probable; timeouts, thrown probe errors and invalid results remain indeterminate. There is not yet a probe contract that can establish a positively confirmed root cause. A timeout or missing response alone never proves which party failed. The incident-store interface supports append/update, but the included InMemoryIncidentStore is ephemeral and reference/test-only: durable SQLite persistence, tamper resistance and support-export integration remain pending. Recovery actions are injected by the host, restricted to named local scopes and capped per invocation; cross-invocation rate limiting and idempotency are not yet implemented. The engine requires a fresh, consistent snapshot before it reports recovery, but concrete configuration validation, endpoint rediscovery, adapter restart and session renewal are not yet integrated. It cannot rotate user credentials, bypass authentication, issue backend writes or restart external services without explicit authorization.

### Simulation/rendering separation
Social simulation uses variable pseudo-random decisions and durations, route/interaction constraints and optional seeded randomness for reproducible tests. It runs independently from the render loop and backend transport. A low frame rate must not freeze behavior decisions. Renderer tiers alter visual fidelity and resource cost only; they do not remove semantic actions. Runtime profiling uses hysteresis and a manual override, with independent renderer/backend resource budgets. Simulated state remains visibly labelled and is never used as evidence of task execution or completion.

## Universal portable Windows bundle module boundary

The portable Windows bundle is a Universal host artifact. Its builder copies an explicit allowlist of backend-neutral scene-engine modules (`windows.mjs`, `windows-node-identity-runtime.mjs`, `node-identity.mjs`, `sqlite-node-identity-metadata-store.mjs`, `node-identity-challenge-store.mjs`, `windows-cng-p256-keystore.mjs`, `resource-policy.mjs`, `sqlite-office-incident-store.mjs`, `office-health.mjs`) and the Windows-host modules (`cli.mjs`, `hardware-capabilities.mjs`, `installation-lifecycle.mjs`, `sqlite-installation-lifecycle-store.mjs`, `secret-vault.mjs`, `index.mjs`). It does not copy the generic `scene-engine/src/index.mjs`, the DGM-MAT adapter/session provider or VST modules. The bundle manifest records this list and the E2E test asserts exact file-set equality.

The portable bundle and the three edition tarballs now have independent explicit allowlists and file-set tests. `packages/scene-engine/src/index.mjs` remains backend-neutral. DGM-MAT adapter/session/Windows composition is included only by the DGM-MAT allowlist and its `./windows-host/dgmat` export; Universal and VST exclude those DGM-specific modules. The generic `packages/windows-host/src/secret-vault.mjs` is included in all editions because it provides a backend-neutral OS-keystore primitive and contains no backend routes or DGM/VST credential semantics. These are source-package and portable-bundle boundaries, not OS installers or proof of production readiness.

## Edition packaging boundary — PR #56 implementation

The generic `packages/scene-engine/src/index.mjs` is backend-neutral and must not re-export personal backend adapters. DGM-MAT has dedicated `dgmat.mjs` and `dgmat-windows-host.mjs` entrypoints, included only in the DGM-MAT package allowlist. VST has dedicated `vst.mjs` and `vst-windows-host.mjs` entrypoints, included only in the VST package allowlist. Universal excludes both personal adapters; DGM-MAT excludes VST; VST excludes DGM-MAT. The VST adapter status is `read_only_preview`: source implementation and package isolation do not establish live backend compatibility or production readiness.

`build-edition.mjs` stages a per-edition allowlist in a temporary directory before `npm pack`, and tests inspect the produced tarballs. PR #77 was merged on 2026-11-12 as `d0bcd59055202e7a845bb2b103cf91c72597a1b2`. Its final PR HEAD `fe811f4d8b44ae81b4294bd2e108065212176bde` passed CI run #43226023576: Node 22 and Node 26.13.1 on Linux/Windows, all three isolated source-package builds, Windows native CNG/persistence/identity checks and portable bundle E2E. Visual regression run #43226023574 passed on Node 26.13.1. The visual and manual edition workflows now use Node 26.13.1. All packages retain the `>=22.5.0` engine floor; `node:sqlite` remains Experimental on Node 22 and Stability 1.2 — Release Candidate on Node 26, so API maturity and a future engine-floor decision remain open. These are source packages and CI validations, not OS installers or physical-device validation.

### SQLite incident update concurrency
The Windows host injects an installation-scoped SqliteOfficeIncidentStore. Read/modify/write updates require a transaction provider exposing BEGIN IMMEDIATE, and each incident carries a monotonic revision used for compare-and-set consistency. Revision is concurrency control only, not tamper evidence. Append-only history, keystore-backed MAC/signature chain, chain verification, crash/power-loss recovery and owner-consent export remain separate requirements.


## DGM-MAT Windows host composition and bootstrap secret boundary — 2026-11-11

The generic Windows host exposes `createSecretStore(namespace)`; it does not know DGM-MAT routes or credentials. The underlying `WindowsCngSecretVault` stores only an authenticated ciphertext envelope in the installation SQLite database. A random AES-256-GCM data key encrypts each value; RSA-OAEP-SHA256 wraps that data key with a separate, installation-and-namespace-scoped, non-exportable CNG private key. Associated data binds the envelope to installation ID, namespace and secret name. The node-identity ECDSA key is never reused.

The CNG private key is user-scoped Microsoft Software KSP, reports `os-protected` and `hardwareBacked=false`, and is not claimed to be TPM-backed. The helper checks the RSA algorithm and `ExportPolicy.None` before exposing the public key or decrypting a wrapped data key. The native helper remains subject to the host's Authenticode publisher pin.

`createWindowsDgmMatHost` is a DGM-MAT-only entrypoint, included only in the DGM-MAT edition. Provisioning/removal requires explicit owner consent; connecting is an explicit call; the adapter remains GET-only/read-only. The host reports backend operational state as `unverified` because the source timestamp is mutation-time evidence, not a heartbeat. Universal and VST contain the generic vault primitive but not the DGM-MAT composition or bootstrap credential flow. Windows CI native integration and live/physical validation remain separate gates.

The generic CNG vault is deliberately non-portable at the private-key layer: its wrapping key is scoped to the current Windows user profile, installation and namespace, and is non-exportable. Copying the SQLite database without that matching key cannot recover a secret; cross-profile restore must use explicit re-enrolment until a tested recovery design exists.

### Incident journal — keystore-backed event authentication
The SQLite incident journal keeps its SHA-256 event chain for ordering/corruption checks and adds a separate append-only HMAC-SHA-256 record per event. Each MAC covers a domain separator, installation ID, sequence, event hash and previous MAC. Verification fails closed if a MAC is missing, reordered, associated with another key ID, or invalid. MAC records have SQLite update/delete rejection triggers.

On Windows, the host requires the journal key before incident reads/writes. A random 256-bit key is provisioned in the incident.journal namespace through WindowsCngSecretVault and retrieved from the current-user Windows CNG Software KSP. SQLite stores only the existing encrypted secret envelope and event MACs. If a journal already has MAC records but the protected key is missing, startup fails closed; it must not silently create a replacement key.

Existing unkeyed SHA-256 journals are verified and then MACed during the first keyed activation. This establishes a baseline at activation time; it cannot prove the historical database was never modified before that point. The MAC key is profile-scoped and requires the same Windows user profile for recovery. There is no external monotonic anchor, so rollback/truncation to an older internally valid database state is not detected. The feature provides tamper evidence against database-only modification while the original key remains available, not absolute tamper resistance against a local administrator or compromised OS. PR #75 adds a bounded storage-layer keyring: each historical MAC is verified with the provider identified by its stored key ID, while new events use one explicitly selected active key and historical MAC rows are never rewritten. Host-managed CNG key provisioning/rotation, owner authorization, safe retirement of old keys, cross-profile recovery and an external monotonic anchor remain separate work.


## VST read-only adapter boundary — 2026-11-12

The VST edition exposes `VstReadOnlyAdapter` through `./scene-engine/vst` and the Windows composition `createWindowsVstHost` through `./windows-host/vst`. The adapter is deliberately restricted to authenticated loopback HTTP `GET /observer/summary` on port 8765, with the `X-Token` header, redirects rejected and no remote endpoint support. Its only capability is `read_state`; it does not expose commands, trading operations or backend writes.

The Windows host stores the owner-provided local API token in the generic CNG vault under the VST-only namespace `vst.local-api`. Provisioning and removal require explicit owner consent. Connection is manual; provisioning does not auto-connect. The token is fetched per request, is not cached between requests or exposed by status APIs, and exists transiently as a plaintext JavaScript string while a request is being made; JavaScript does not guarantee secure string zeroization. The vault uses the Windows CNG Software KSP and is OS-protected/software-backed, not TPM-backed; recovery still depends on the matching Windows user profile and installation.

The adapter accepts observer data only when the response envelope has `ok === true`, then maps only bounded fields. Failed or malformed observer envelopes suppress the supplied status/count/health values and remain synchronizing. Agent and task arrays remain empty because the observer contract does not establish individual agent/task activity. `REAL` is reported as a mode value only; `executionAuthorized` and `allowRiskBearingActions` remain false. `runtimeReadiness` remains `unverified`. The `updated_at_ms` field is treated as the last observer publication time, not proof of engine readiness. Stale, future or missing timestamps do not produce an authoritative synchronized snapshot.

Each connection has a fresh session UUID and generation. One bounded deadline covers token retrieval, fetch and JSON body parsing. Disconnect and a newer connection attempt abort the prior token-provider/fetch signal; late events from an old generation are discarded. This is cooperative cancellation: injected providers and transports must honor the AbortSignal.

Unit tests use injected token providers and fake fetch responses. Edition tarball tests verify that only the VST package contains the VST adapter/host composition. These tests do not replace a live E2E against an actual VST instance, Windows CNG validation specifically through the VST composition, or physical-PC provisioning/reconnect/restart tests. Until those gates pass, VST remains a read-only preview, not a production integration.
