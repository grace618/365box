#!/usr/bin/env bash
set -e
npm install
npm install --prefix server
npm install --prefix web
echo "Done. Run: npm run dev"
