#!/bin/sh
set -e

# Run strict environment variable validation prior to starting backend service
if [ -f "tools/validate-env.js" ]; then
  node tools/validate-env.js
elif [ -f "../tools/validate-env.js" ]; then
  node ../tools/validate-env.js
fi

exec "$@"
