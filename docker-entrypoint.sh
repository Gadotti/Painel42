#!/bin/sh
set -e

# Porta HTTP — sobrescreve server-config.json se HTTP_PORT estiver definida
if [ -n "$HTTP_PORT" ]; then
    echo "{\"address\":\"0.0.0.0\",\"port\":${HTTP_PORT},\"python_cmd\":\"python\"}" \
        > /app/server-config.json
fi

# Endereço e porta WebSocket — sobrescreve websocket-config.json se WS_ADDRESS estiver definida
if [ -n "$WS_ADDRESS" ]; then
    echo "{\"address\":\"$WS_ADDRESS\",\"port\":${WS_PORT:-8123}}" \
        > /app/public/websocket-config.json
fi

# Cria o primeiro usuário admin se users.json ainda não existir
if [ ! -f /app/configs/users.json ] && [ -n "$ADMIN_USERNAME" ] && [ -n "$ADMIN_PASSWORD" ]; then
    mkdir -p /app/configs
    node -e "
const { hashPassword } = require('/app/src/auth');
const { salt, hash } = hashPassword(process.env.ADMIN_PASSWORD);
const users = [{ username: process.env.ADMIN_USERNAME, salt, hash, role: 'editor' }];
require('fs').writeFileSync('/app/configs/users.json', JSON.stringify(users, null, 2));
console.log('Usuário admin criado:', process.env.ADMIN_USERNAME);
"
fi

# Inicializa cards-list.json no primeiro run
[ -f /app/cards/cards-list.json ] || echo '[]' > /app/cards/cards-list.json

exec node server.js
