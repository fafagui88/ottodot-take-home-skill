#!/bin/bash
# Runs once, on first MySQL start (empty data dir).
# Creates a separate database for the integration tests so they never touch demo data.
set -e
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<-EOSQL
  CREATE DATABASE IF NOT EXISTS ottodot_test;
  GRANT ALL PRIVILEGES ON ottodot_test.* TO '$MYSQL_USER'@'%';
  FLUSH PRIVILEGES;
EOSQL
