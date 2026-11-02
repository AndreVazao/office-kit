# Referência técnica — Deskforce

## Estado da inspeção

Inspeção inicial do repositório público [husseinzayat3/Deskforce](https://github.com/husseinzayat3/Deskforce), branch `main`, consultado em 1 de novembro de 2026. Esta é uma avaliação documental inicial; não equivale a auditoria integral do código, segurança, dependências ou execução local.

- Stack declarada: TypeScript, Next.js/React, SQLite, Electron, integração com fornecedores de modelos e ferramentas Git.
- Licença declarada no repositório: MIT. Antes de reutilizar código ou assets, confirmar a licença no commit exato e as licenças de dependências/recursos incluídos.
- O projeto oferece uma aplicação de escritório de agentes com planeamento pelo CEO, delegação, aprovação humana, limites de custo, execução de tarefas, commits Git e integrações com modelos diferentes.
- O README descreve uma aplicação desktop e um modo Docker. Não se assume que a arquitetura, o modelo de segurança ou o empacotamento sejam diretamente compatíveis com o Office Kit.

## O que podemos aprender

1. **Planeamento e aprovação:** separar plano proposto, autorização humana, execução e revisão.
2. **Custos e limites:** apresentar estimativa antes da execução e impor limites no backend autoritativo, não apenas na interface.
3. **Proveniência do trabalho:** ligar tarefas, resultados e alterações verificáveis a um agente e a uma execução.
4. **Agentes multi-modelo:** estudar a abstração de fornecedores sem acoplar o modelo de cena a um fornecedor.
5. **Visibilidade da execução:** relacionar a atividade mostrada no escritório com eventos/snapshots reais, mantendo estados simulados claramente distintos.
6. **Recuperação:** estudar o histórico e a reversão de alterações, reconhecendo que um revert Git não desfaz efeitos externos ou transações.

## O que não importar diretamente

- Não substituir a arquitetura neutra do Office Kit pela aplicação Deskforce.
- Não tratar a UI do escritório como autoridade para permissões, custos, execução ou estado de tarefas.
- Não expor agentes com acesso a ficheiros, comandos ou ferramentas sem autenticação, autorização, isolamento e registo adequados.
- Não importar código, assets ou dependências antes de verificar origem, licença, superfície de ataque e compatibilidade.
- Não assumir que suporte a vários modelos equivale a compatibilidade com os protocolos de runtime de VST ou DGM-MAT.

## Decisões para o Office Kit

- O Office Kit continua a ser uma camada de cena e integração independente do backend.
- A simulação local não confirma trabalho operacional.
- Estados de trabalho só serão apresentados como confirmados após snapshot/evento válido de um adaptador autorizado; estados antigos ou sem ligação devem ser mostrados como desatualizados/desconhecidos.
- Aprovação de tarefas, limites de risco, execução e operações financeiras pertencem ao backend anfitrião. O Office Kit pode apresentar estados e recolher pedidos autorizados, mas não substitui os controlos do anfitrião.
- A primeira implementação inspirada nesta revisão é de proveniência visual explícita: cada personagem da pré-visualização recebe a etiqueta “Simulado” e o cabeçalho declara que não há estado operacional verificado. Isto não implementa ainda adaptador, execução real ou aprovação de tarefas.

## Próxima auditoria

Antes de reutilização de código, inspecionar os módulos concretos de planeamento, execução de ferramentas, autorização, gestão de custos, persistência e UI; rever testes e dependências; confirmar o conteúdo integral da licença e qualquer licença de assets; registar os caminhos/commits exatos que eventualmente forem adaptados. Até essa revisão, Deskforce é referência de arquitetura e comportamento, não dependência do Office Kit.

## Referência

- Repositório: https://github.com/husseinzayat3/Deskforce
- README e arquitetura publicada no repositório: consultar o commit atual antes de qualquer implementação derivada.
