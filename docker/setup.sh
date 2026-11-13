#!/bin/sh
set -eu
umask 077

docker_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for service in api mysql; do
  if [ ! -e "$docker_directory/$service/$service.env" ]; then
    cp "$docker_directory/$service/$service.env.example" \
      "$docker_directory/$service/$service.env"
  fi
done

mkdir -p "$docker_directory/secrets"
chmod 700 "$docker_directory/secrets"
for name in mysql_password mysql_root_password; do
  secret_file="$docker_directory/secrets/$name"
  if [ ! -e "$secret_file" ]; then
    openssl rand -hex 32 > "$secret_file"
  fi
  if [ ! -f "$secret_file" ] || [ ! -s "$secret_file" ]; then
    echo "Missing or empty secret file: $secret_file" >&2
    exit 1
  fi
  # The private parent directory protects host access. Containers mount each file
  # read-only; the API runs as the node user and must be able to read its secret.
  chmod 644 "$secret_file"
done
printf '%s\n' 'Docker configuration is ready. Set CORS_ORIGINS in docker/api/api.env before starting.'
