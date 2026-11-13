FROM mysql:8.4
ENV TZ=UTC
COPY docker/mysql/word-atlas.cnf /etc/mysql/conf.d/word-atlas.cnf
COPY --chmod=0755 docker/mysql/healthcheck.sh /usr/local/bin/word-atlas-mysql-healthcheck
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=12 CMD ["word-atlas-mysql-healthcheck"]
