#!/usr/bin/env bash
# Render build for the store backend (render.yaml runs this from commerce/).
#
# Render's FREE web services cannot run a pre-deploy command and have no Shell,
# so everything that needs the database happens here, at the end of the build:
# Render's own guides run migrations from the build for the same reason, and
# the build reaches the database over its internal address. Migrations, the
# store setup and the catalogue import are all safe to run again, so every
# deploy runs them: new products in api/_catalog-data.json reach the store on
# the next deploy and existing ones are left alone. This works unchanged on a
# paid plan too.
set -euo pipefail

corepack enable
yarn install
yarn build

npx medusa db:migrate
yarn setup            # prints "Publishable key for Web: pk_..." in the log
yarn import:catalog

# The first admin login, without a Shell and without a password in any config:
# Medusa creates a one-time invite and prints its token in this build log. Open
#   https://legal-leaf-commerce.onrender.com/app/invite?token=<token>
# and choose your own password there. Remove ADMIN_INVITE_EMAIL from the
# service's environment afterwards so later deploys stop making new invites.
if [ -n "${ADMIN_INVITE_EMAIL:-}" ]; then
  npx medusa user -e "$ADMIN_INVITE_EMAIL" --invite \
    || echo "No new admin invite (one may already exist for $ADMIN_INVITE_EMAIL)."
fi

# Medusa's production build lives in .medusa/server and needs its own
# node_modules. Medusa's docs install them with npm: this folder sits inside
# the Yarn 4 project but is not one of its workspaces, and Yarn 4's install has
# no --production flag, so the old "yarn install --production" here would fail.
cd .medusa/server
npm install --omit=dev
