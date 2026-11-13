#!/bin/sh
set -eu
MYSQL_PWD=$(cat "${MYSQL_PASSWORD_FILE:?MYSQL_PASSWORD_FILE is required}")
export MYSQL_PWD
exec mysql --protocol=TCP --host=127.0.0.1 \
  --user="${MYSQL_USER:?MYSQL_USER is required}" \
  --database="${MYSQL_DATABASE:?MYSQL_DATABASE is required}" \
  --batch --skip-column-names --execute='SELECT 1'
