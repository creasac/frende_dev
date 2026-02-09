#!/usr/bin/env bash
set -euo pipefail

echo "==> Lint"
npm run lint

echo "==> Unit + component tests"
npm run test

echo "==> E2E tests"
npm run test:e2e

echo "==> DB/RLS tests"
npm run test:db:local
