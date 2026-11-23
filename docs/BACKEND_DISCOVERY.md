# Descoberta assistida de backends — requisito futuro

**Estado:** contrato neutro v1 implementado; pesquisa de fontes, health-check de rede e assistente de ativação continuam por implementar. O objetivo é ajudar o utilizador a encontrar e avaliar pontos de integração sem tornar o Office Kit dependente de um backend nem ligar serviços silenciosamente.

## Experiência pretendida
Uma ação explícita, por exemplo “Procurar integrações”, abre um assistente de descoberta. Reúne candidatos a partir de fontes autorizadas e selecionadas pelo utilizador. Não é um scanner genérico de rede.

## Fontes possíveis
- Endpoints, URLs, ficheiros de configuração ou documentação fornecidos pelo utilizador.
- Catálogo de adaptadores/conectores conhecidos e versionados.
- Plugins/conectores externos ligados explicitamente pelo utilizador.
- Serviços locais anunciados por mecanismos documentados, apenas se essa fonte for ativada.
- Repositórios/documentação que o utilizador seleciona e tem autorização para consultar.

Começar com fontes explícitas e determinísticas. Pesquisa documental, catálogo de conectores e descoberta de serviços locais são capacidades distintas e ativáveis separadamente.

## Resultado por candidato
- Nome e tipo provável de backend.
- Origem exata e data de consulta.
- Endpoint apresentado de forma segura, sem tokens.
- Evidência observada e confiança; nunca alegar compatibilidade não testada.
- Adaptador e versão compatível, se houver.
- Capacidades declaradas: leitura, eventos, heartbeat, diagnóstico ou comandos.
- Autenticação/permissões necessárias.
- Estado: não testado, acessível, autenticação necessária, incompatível, timeout ou validado.
- Ações de validação que serão executadas.

## Limites de segurança
- Não pesquisar redes indiscriminadamente, contornar autenticação ou explorar endpoints.
- Nunca tentar credenciais nem guardar passwords, tokens, cookies ou API keys em resultados/logs/configuração visual.
- Não executar comandos ou operações de escrita durante descoberta.
- Health-check com alvo e escopo visíveis, timeout limitado e consentimento quando contactar sistema externo.
- Distinguir “endpoint responde”, “autenticação válida”, “adaptador compatível” e “estado operacional sincronizado”.
- A descoberta nunca ativa uma integração automaticamente; o utilizador escolhe e autoriza a ligação.
- Comandos exigem capacidades declaradas e autorização pelo backend anfitrião.

## Ordem de implementação
1. Definir contratos neutros para candidato, fonte, evidência, resultado de validação e capacidades.
2. Implementar pesquisa manual por endpoint/documentação fornecidos, sem varrimento de rede.
3. Criar catálogo local versionado de adaptadores e correspondência por protocolo.
4. Adicionar health-check de leitura com consentimento, timeout e resultados explícitos.
5. Integrar fontes de plugins/conectores após validar permissões.
6. Considerar descoberta local apenas com opt-in, escopo limitado e testes de segurança.
7. Criar assistente para configurar/ativar o adaptador escolhido.

## Testes de aceitação
- Candidato encontrado não significa integração validada.
- Nenhuma escrita/comando durante descoberta.
- Endpoint inválido, timeout, autenticação ausente e permissões insuficientes falham de forma segura.
- Segredos nunca aparecem em logs/resultados.
- Nenhuma ligação é ativada sem escolha explícita.
- Office Kit funciona sem fontes de descoberta, conectores ou backend.


## Primeiro incremento executável — contrato neutro v1

O módulo `packages/scene-engine/src/backend-discovery.mjs` normaliza candidatos provenientes de fontes explicitamente selecionadas e combina resultados de validação independentes. Não executa pesquisa de rede, pedidos HTTP, importação dinâmica, autenticação nem ativação.

- Fontes permitidas são enumeradas; um tipo de fonte arbitrário (por exemplo, varrimento genérico) é recusado.
- URLs rejeitam credenciais embutidas, query strings e fragments; HTTP só é aceite para loopback e endpoints remotos exigem HTTPS. WebSocket não faz parte deste contrato v1.
- `sourceReference` é um identificador opaco e `evidence` usa códigos enumerados; campos arbitrários de credenciais são recusados.
- Capacidades são limitadas a um vocabulário neutro e desconhecidas são recusadas. São declarações não confiáveis, nunca permissões concedidas.
- Reachability, autenticação, compatibilidade do adaptador e snapshot são verificações independentes.
- Um endpoint público de health pode provar apenas reachability; nunca prova autenticação nem compatibilidade.
- O estado `validated` só é atribuído quando as quatro verificações passam.
- Descoberta não executa comandos, não guarda credenciais e não ativa uma ligação.
- O modo inicial do adaptador permanece `read-only`; `send_commands`, quando declarado pelo backend, não é autorização nem capacidade concedida.
- Resultados de validação inválidos, timeouts, falhas de reachability, autenticação e snapshot permanecem estados distintos.

O módulo é uma base de dados/contrato puro. Os conectores reais de fontes, probes consentidos e a interface de escolha humana serão incrementos separados.
