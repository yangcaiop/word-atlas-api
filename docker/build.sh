#!/bin/sh
set -eu

docker_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_directory=$(CDPATH= cd -- "$docker_directory/.." && pwd)

docker build --pull --file "$docker_directory/api/Dockerfile" \
  --tag word-atlas-api:latest "$project_directory"
docker build --pull --file "$docker_directory/mysql/Dockerfile" \
  --tag word-atlas-mysql:8.4 "$project_directory"
