# Office Kit — roteiro canónico

O roteiro é faseado por risco e evidência. Uma fase só fica concluída quando os seus critérios são verificados; percentagens não substituem testes.

## Fase 0 — contrato e proveniência
- [x] Definir missão, princípios e fronteiras de produto.
- [x] Fixar arquitetura de alto nível e separação backend/frontend.
- [x] Definir o papel de Diorama como referência de implementação visual.
- [ ] Rever todos os ficheiros existentes e a licença do projeto-base antes de importar módulos.
- [ ] Definir convenções de commits, CI e testes do repositório.

**Saída:** decisões fundacionais escritas e versionadas.

## Fase 1 — núcleo neutro, sem renderer
- Definir tipos neutros para edifício, piso, departamento, sala, agente, avatar, mobília, estado e ligação.
- Definir schema versionado de configuração e validação.
- Implementar carga/guarda/importação/exportação.
- Criar testes com configuração vazia, padrão, grande e inválida.
- Criar backend fictício e modo sem backend.

**Saída:** um escritório configurável é válido e testável sem dependências gráficas nem backend real.

## Fase 2 — primeiro renderer funcional
- Criar uma cena pixel-diorama pequena baseada na estrutura estudada do Diorama.
- Mostrar edifício/salas, mobília e elenco com escala legível.
- Implementar câmara/enquadramento, zoom e resize retrato/paisagem.
- Evitar rótulos sobrepostos: seleção e painel de detalhes em ecrãs pequenos.
- Preparar capturas automáticas e auditoria de console/erros.
- Validar Android de baixa/média capacidade e desktop.

**Saída:** protótipo visual legível, repetível e com evidência de teste, não apenas uma imagem promocional.

## Fase 3 — animação e vida social local
- Rig/animações base: idle, caminhar, sentar/levantar, conversar, trabalhar visualmente, pausa.
- Rotinas ambientais: cafetaria, conversas, olhar relógio, varanda e regresso.
- Planeamento de caminhos e prevenção simples de sobreposição/colisão.
- Variação de tempo/rotina por personagem, com seed determinística para QA.
- Opções para reduzir/desligar animação em hardware fraco.
- Comportamento social sem backend e prova automática de que não envia comandos.

**Saída:** o escritório continua vivo sem backend e não sugere falsamente trabalho real.

## Fase 4 — runtime e adaptador de referência
- Definir interface pública de adaptador.
- Ligar backend fictício com snapshots, heartbeat, eventos e reconexão.
- Exibir estados confirmados, desatualizados e desconhecidos distintamente.
- Construir adaptador VST como primeiro exemplo, sem colocar dependências VST no core.
- Demonstrar que fechar/reiniciar o Office Kit não altera o ciclo de vida do backend.

**Saída:** integração de referência sem dependência circular.

## Fase 5 — editor plug-and-play
- Fluxo guiado para criar pisos, departamentos e salas.
- Adicionar/renomear/mover/remover agentes.
- Escolher avatares, mobília, posições e tema.
- Pré-visualizar, desfazer/refazer quando possível, validar e guardar.
- Biblioteca de presets: escritório genérico, trading floor, investigação, DevOps/laboratório.
- Presets são exemplos editáveis, nunca estruturas obrigatórias.

**Saída:** utilizador comum consegue montar um espaço sem editar JSON ou código.

## Fase 6 — diagnóstico/enfermaria
- Políticas configuráveis de heartbeat, estado stale e triagem.
- Mostrar motivo, duração e última comunicação conhecida.
- Separar “movido visualmente para triagem” de “isolado pelo backend”.
- Executar diagnósticos/comandos apenas via capacidades autorizadas e com confirmação.
- Testar desligamento total, reconexão, snapshots incompletos e falsos positivos.

**Saída:** perda de comunicação compreensível e segura, sem ações fictícias.

## Fase 7 — modos e desempenho
- Modo 2D leve.
- Refinar pixel diorama.
- Avaliar 2.5D/isométrico.
- Avaliar 3D e qualidade escalável.
- Autoqualidade baseada em medições; controlos manuais permanecem disponíveis.
- Comparar CPU, memória, FPS, consumo e legibilidade em aparelhos reais.

**Saída:** modos selecionáveis com custos e limites documentados.

## Fase 8 — robustez e distribuição
- CI para lint, tipos, testes, schema, auditoria de assets e build.
- Capturas e testes de layout em retrato/paisagem.
- Documentação de integração para novos projetos.
- Política de compatibilidade/migração de configurações.
- Testes de segurança, acessibilidade, recuperação e desempenho.
- Embalagem desktop/mobile escolhida com base em evidência.

**Saída:** versão distribuível com instruções reproduzíveis e limites conhecidos.

## Ordem de prioridade

1. Contrato e core neutro.
2. Protótipo Diorama verificável.
3. Responsividade/legibilidade.
4. Vida social local.
5. Adaptador e reconexão.
6. Editor plug-and-play.
7. Enfermaria/diagnóstico real seguro.
8. Outros modos, refinamento e distribuição.

Não iniciar uma grande implementação 3D antes de haver um contrato de dados, uma cena pequena testada e uma pipeline de capturas. Não parar no documento: cada fase deve produzir código executável e evidência.
