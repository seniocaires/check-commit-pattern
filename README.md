# Check Commit Pattern

Verifica se as mensagens de commit dos repositórios estão seguindo um padrão.

Envia o relatório por e-mail.

#### Configuração

Crie um arquivo configuration.json de acordo com o modelo config/configuration-sample.json

Inicie um container

```
docker run -d --restart=always -v $(pwd)/config:/app/config --name check-commit-pattern seniocaires/check-commit-pattern
```
