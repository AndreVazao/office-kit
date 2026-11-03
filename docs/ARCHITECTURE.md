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
