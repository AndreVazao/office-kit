# Diorama — referência técnica e plano de adaptação

## 1. Papel do projeto-base

O projeto [sloemo01/diorama](https://github.com/sloemo01/diorama) é a referência principal para investigar e adaptar a camada de cena pixel-diorama. O objetivo é aprender com a sua estrutura real — não inventar uma implementação visual sem a estudar.

A referência descreve um diorama em miniatura com câmara fixa em três quartos, figuras com animação articulada, paleta limitada, contorno e dithering, props detalhados e uma pipeline de captura/QA. Estes elementos podem servir o modo **Pixel Diorama** do Office Kit.

O Office Kit, no entanto, é mais geral: deve suportar vários projetos, diferentes domínios, configurações editáveis e modos visuais alternativos. Não se deve transformar o Office Kit num fork rígido de uma única cena do Diorama.

## 2. Inspeção antes de adaptar

Antes de copiar/adaptar qualquer ficheiro, ler e registar:
- `SKILL.md`;
- `templates/DESIGN.md`;
- `templates/SOURCES.md`;
- `templates/CREDITS.md`;
- `templates/qa/README.md`;
- cabeçalhos e interfaces dos módulos em `templates/`;
- exemplos de cenas;
- scripts de captura e auditoria;
- dependências, versões, comandos e limitações de execução.

O resultado da inspeção deve ser resumido num inventário de módulos: propósito, dependências, licença/proveniência, o que pode ser reutilizado, o que tem de ser abstraído e o que não serve o produto.

Não declarar que a referência foi integralmente auditada enquanto cada um destes pontos não tiver sido verificado.

## 3. Estratégia de adaptação

### Preservar como subsistema visual
- câmara e enquadramento de três quartos quando apropriados;
- paleta, pixel snapping, dithering e contorno como opções de estilo;
- rig e animações articuladas reutilizáveis;
- gramática de movimento e coreografia social;
- ferramentas de captura, congelamento de tempo e auditoria visual.

### Abstrair para o Office Kit
- edifício, pisos, departamentos, salas e caminhos passam a ser dados/configuração;
- personagens e props tornam-se assets selecionáveis;
- câmara, paleta, densidade e efeitos tornam-se presets;
- rotinas sociais são separadas de qualquer lógica de domínio;
- pipeline de captura é reutilizada/adaptada para testar presets e layouts;
- conteúdo de mercado, cozinha ou qualquer cena demonstrativa passa a ser exemplo/preset, não código fixo do core.

### Não importar sem revisão
- assets com licença ambígua;
- conteúdo de terceiros sem registo de origem;
- dependências ou scripts de conveniência que não se adaptem a CI;
- decisões de cena que impeçam zoom, layouts diferentes ou múltiplos pisos;
- código que misture estado visual com operações de domínio.

## 4. Licença e proveniência

A referência indica licença MIT no seu ficheiro de skill. Antes de incorporar código, confirmar o ficheiro de licença efetivo da versão/commit escolhido e conservar os avisos de copyright e licença exigidos. Registar os ficheiros adaptados e o commit de origem. A licença do repositório Office Kit não substitui automaticamente a licença dos assets incorporados.

Assets externos devem ter origem, licença e atribuição verificadas. Não usar assets extraídos de jogos ou conteúdo sem permissão clara. Se não for possível confirmar os direitos, usar um placeholder original e registar a decisão.

## 5. Qualidade e verificação

A pipeline visual deve incluir, adaptando os scripts disponíveis:
- captura de uma frame determinística;
- captura em retrato e paisagem;
- conjunto de imagens de comparação;
- auditoria de erros de consola e geometria inválida;
- verificação de limites, escala e sobreposição;
- teste de performance com número crescente de personagens e props.

O resultado visual é um artefacto de revisão, não uma alegação textual. Uma alteração não fica validada só porque o build terminou.

## 6. Primeiro experimento

A primeira experiência deve ser uma única cena pequena e determinística: edifício compacto, 2–3 departamentos, algumas salas, poucos personagens e mobília essencial. Deve carregar de configuração e renderizar sem backend. Antes de acrescentar detalhes, confirmar:
1. a câmara e escala são legíveis num telefone;
2. o resize não deforma a cena;
3. personagens e etiquetas não se sobrepõem de forma crítica;
4. a animação pode ser congelada para testes;
5. o renderizador pode falhar/reiniciar sem afetar qualquer backend;
6. a estrutura de dados suporta adicionar outro departamento sem alterar o código da cena.

Só depois deste experimento se deve escalar o edifício e o número de agentes.
