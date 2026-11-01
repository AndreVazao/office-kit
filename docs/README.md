# Documentação canónica do Office Kit

Ler nesta ordem:

1. [Contrato do produto](PRODUCT_CONTRACT.md) — missão, requisitos não negociáveis, comportamento social, enfermaria e critérios de aceitação.
2. [Arquitetura](ARCHITECTURE.md) — fronteiras entre configuração, adaptadores, runtime, simulação social, cena e renderizadores.
3. [Roteiro](ROADMAP.md) — fases, prioridades e condições de conclusão.
4. [Adaptação do Diorama](DIORAMA_ADAPTATION.md) — como estudar a referência, adaptar módulos e preservar proveniência/licenças.
5. [Auditoria inicial do Diorama](DIORAMA_AUDIT.md) — achados verificados, decisões de adaptação e itens ainda por auditar.
6. [Estado de implementação](IMPLEMENTATION_STATUS.md) — separar código existente, trabalho planeado e evidência de testes.

## Regra de autoridade

- O contrato define o que estamos a construir.
- A arquitetura define como as responsabilidades são separadas.
- O roteiro define em que ordem avançar.
- Os documentos Diorama definem como usar a referência visual sem tornar o Office Kit dependente dela.
- O estado de implementação regista o que realmente existe e o que foi efetivamente testado.

Quando uma implementação ou conversa futura divergir destes documentos, propor uma alteração explícita antes de mudar o rumo.
