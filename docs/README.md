# Documentação canónica do Office Kit

Ler nesta ordem:

1. [Contrato do produto](PRODUCT_CONTRACT.md) — missão, requisitos não negociáveis e critérios de aceitação.
2. [Arquitetura](ARCHITECTURE.md) — separação entre configuração, adaptadores, runtime, simulação, cena e renderizadores.
3. [Contrato do motor de cena](SCENE_ENGINE.md) — layout lógico, escala, orientação e posições.
4. [Perfis gráficos adaptáveis](QUALITY_PROFILES.md) — níveis de qualidade e adaptação.
5. [Roteiro](ROADMAP.md) — ordem de execução e gates de conclusão.
6. [Descoberta assistida de backends](BACKEND_DISCOVERY.md) — requisito futuro de pesquisa segura de pontos de integração.
7. [Adaptação do Diorama](DIORAMA_ADAPTATION.md) — estudo da referência e proveniência/licenças.
8. [Revisão de referência Deskforce](REFERENCE_DESKFORCE.md) — coordenação multiagente, aprovações, custos, proveniência e limites de reutilização.\n9. [Auditoria inicial do Diorama](DIORAMA_AUDIT.md) — achados verificados e trabalho ainda por auditar.
10. [Estado de implementação](IMPLEMENTATION_STATUS.md) — código existente versus trabalho planeado e evidência de testes.

## Regra de autoridade

- O contrato define o produto.
- A arquitetura define fronteiras técnicas.
- O motor de cena define o layout lógico comum.
- Os perfis gráficos definem políticas e custos pretendidos, não garantias de desempenho.
- O roteiro define a ordem de desenvolvimento.
- A descoberta de backends é requisito futuro, não funcionalidade já disponível.
- O estado de implementação regista apenas o que existe e foi efetivamente verificado.

Quando uma implementação ou conversa futura divergir destes documentos, propor uma alteração explícita antes de mudar o rumo.
