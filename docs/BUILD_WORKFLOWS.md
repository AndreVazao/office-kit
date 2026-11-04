# Workflows de build por edição

## Objetivo

O Office Kit tem um core comum e três perfis de distribuição: Universal, DGM-MAT e VST. Cada pipeline valida o mesmo core, aplica o perfil correspondente e produz um pacote de código-fonte acompanhado do manifesto da edição.

## Workflows manuais

| Workflow | Edição | Ficheiro | Execução |
|---|---|---|---|
| Build — Universal | `universal` | `.github/workflows/build-universal.yml` | Apenas manual |
| Build — DGM-MAT | `dgmat` | `.github/workflows/build-dgmat.yml` | Apenas manual |
| Build — VST | `vst` | `.github/workflows/build-vst.yml` | Apenas manual |

Os três usam exclusivamente o evento `workflow_dispatch`. Não executam em push, pull request, schedule ou publicação. A concorrência de cada edição é serializada e não cancela um build em curso.

## Conteúdo do build

1. Checkout do commit selecionado.
2. Node.js 20.
3. `npm run check` para validar sintaxe e executar a suite completa.
4. `node scripts/build-edition.mjs <edition>`.
5. Geração de `dist/<edition>/edition-manifest.json`.
6. `npm pack` para criar o pacote de distribuição de código-fonte.
7. Upload dos dois ficheiros como artifact GitHub Actions, com retenção de 14 dias.

O manifesto identifica a edição e a allowlist de adaptadores. IDs de instalação e namespaces reais são criados na primeira execução/instalação, não no build. Nenhum segredo ou credencial é incluído.

## Isolamento das edições

- Universal não inclui nem depende dos adaptadores pessoais DGM-MAT/VST.
- DGM-MAT declara apenas o adaptador `dgm-mat`.
- VST declara apenas o adaptador `vazao-sovereign-trader`.
- As três edições usam o mesmo core e o mesmo conjunto de testes.
- Ligações automáticas, telemetria e sincronização entre instalações permanecem desativadas por omissão.

## Política de execução controlada

Os builds de edição são deliberadamente manuais. Para executar: GitHub → Actions → escolher o workflow da edição → Run workflow → selecionar branch/commit. Executar apenas em pontos estratégicos: após concluir uma fatia de implementação, antes de integrar uma edição ou quando for necessário gerar um artifact para teste.

Os workflows gerais existentes de CI e regressão visual continuam separados e mantêm as suas regras atuais; esta política manual aplica-se aos três novos builds de produto.

## Limite de distribuição atual

O artifact é um **pacote de código-fonte perfilado**, não um instalador Windows/Android, executável autónomo nem integração funcional com o backend. Os adaptadores DGM-MAT e VST, keystore de produção, launcher e instaladores continuam etapas próprias. Não considerar um build verde como prova de ligação real ao DGM-MAT/VST.
