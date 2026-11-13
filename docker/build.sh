#!/bin/sh
set -eu

docker_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_directory=$(CDPATH= cd -- "$docker_directory/.." && pwd)

docker build --pull --file "$docker_directory/api/Dockerfile" \
  --build-arg "NODE_IMAGE=${NODE_IMAGE:-node:22-bookworm-slim}" \
  --build-arg "NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmjs.org/}" \
  --tag word-atlas-api:latest "$project_directory"
docker build --pull --file "$docker_directory/mysql/Dockerfile" \
  --build-arg "MYSQL_IMAGE=${MYSQL_IMAGE:-mysql:8.4}" \
  --tag word-atlas-mysql:8.4 "$project_directory"
