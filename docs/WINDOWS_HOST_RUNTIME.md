# Windows host runtime — primeira composição local

## Implementação

O pacote `packages/windows-host` acrescenta uma composição local Windows-only que:
- resolve e valida a pasta privada por instalação;
- aplica ACLs restritivas ao diretório de dados e aos ficheiros de identidade/lock;
- cria e preserva um `installationId` estável;
- impede duas instâncias simultâneas através de lock de processo;
- exige um helper CNG com assinatura Authenticode válida antes de abrir a base de dados;
- abre SQLite local com WAL, synchronous FULL, foreign keys e busy timeout;
- compõe `createWindowsNodeIdentityRuntime` e reconcilia a identidade antes de expor health;
- encerra SQLite e liberta o lock em `close()`.

O host não inicia rede, descoberta, telemetria, federation, backend adapter, enrollment ou comandos remotos. O CLI só cria/roda/revoga identidade quando o utilizador pede explicitamente.

## Uso de desenvolvimento

Requer Windows, Node.js 22.5+ com `node:sqlite`, helper CNG publicado e assinado por um certificado confiável no computador. O publisher é fixado por `OFFICE_KIT_CNG_SIGNER_THUMBPRINT` (thumbprint SHA-1 de 40 caracteres):

```powershell
$env:OFFICE_KIT_CNG_HOST_PATH = "C:\Program Files\Office Kit\OfficeKit.CngHost.exe"
$env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = "<40-character trusted publisher certificate thumbprint>"
node packages/windows-host/src/cli.mjs health
node packages/windows-host/src/cli.mjs create-identity --organization-id=andre-vazao --node-id=office-pc-01
node packages/windows-host/src/cli.mjs rotate-identity
node packages/windows-host/src/cli.mjs revoke-identity
```

A criação de identidade é sempre explícita. `health` num primeiro arranque apresenta `identityStatus: empty`; não cria automaticamente uma identidade.

## Limites e validação

- A integração de assinatura é real: o CLI usa `Get-AuthenticodeSignature` e rejeita qualquer helper cujo estado não seja `Valid` ou cujo thumbprint não corresponda ao publisher configurado.
- Os testes automatizados injetam o verificador de assinatura e as operações ACL; validam a composição, isolamento do processo, persistência do installation ID, health e rejeição de helper não confiável. Isto não valida as ACLs ou a cadeia de certificados de uma instalação física.
- O helper CNG atualmente publicado no CI não é assinado por um certificado de distribuição. Portanto, o CLI de produção não arranca com esse artefacto até existir assinatura e trust chain válidas.
- Ainda não existe instalador MSI/MSIX, assinatura de release, serviço Windows, UI, atualização/rollback, backup/restore ou teste num PC físico.
- O módulo usa `node:sqlite`; a execução do host exige Node.js 22.5 ou superior. O core genérico e a preview não importam este pacote.
- A autenticação do utilizador Windows e as ACLs do sistema protegem o armazenamento local; não há autenticação remota nem exposição de porta local.

Este incremento é um host de runtime local executável, não uma release instalável/comercial.

## Validação Windows real acrescentada
A suite `windows-host.windows.integration.test.mjs` executa no runner Windows:
- resolve o SID real do utilizador com `whoami.exe`;
- executa `icacls.exe` no diretório da instalação, diretório de dados, metadados de instalação e base SQLite;
- exporta as ACLs com `icacls /save` em formato SDDL e confirma explicitamente o SID do utilizador e SYSTEM em cada entrada;
- confirma que o verificador Authenticode rejeita um helper sem assinatura.

O teste injeta apenas a aceitação do helper no cenário de ACL para isolar a validação de permissões. O cenário separado usa o verificador real e um ficheiro sem assinatura. Isto é validação no runner Windows, não substitui teste no PC físico nem uma cadeia de assinatura de release.
