# Descoberta assistida de backends — requisito futuro

**Estado:** requisito documentado; não implementado. O objetivo é ajudar o utilizador a encontrar e avaliar pontos de integração sem tornar o Office Kit dependente de um backend nem ligar serviços silenciosamente.

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
