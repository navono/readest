FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS dependencies
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV HTTP_PROXY="http://127.0.0.1:18899"
ENV HTTPS_PROXY="http://127.0.0.1:18899"
RUN npm config set proxy http://127.0.0.1:18899 \
    && npm config set https-proxy http://127.0.0.1:18899 \
    && corepack enable
RUN npm install -g pnpm@11.1.1 --force
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/readest-app/package.json ./apps/readest-app/
COPY patches/ ./patches/
COPY packages/ ./packages/
RUN --mount=type=cache,id=pnpm,sharing=locked,target=/pnpm/store pnpm config set proxy http://127.0.0.1:18899 \
    && pnpm config set https-proxy http://127.0.0.1:18899 \
    && pnpm install --frozen-lockfile
RUN test -f packages/foliate-js/vendor/pdfjs/annotation_layer_builder.css \
    && test -d packages/simplecc-wasm/dist/web \
    || { printf '\nERROR: Required git submodules are not initialized in the source directory.\nEnsure submodules are initialized before running docker build.\nRun: git submodule update --init packages/foliate-js packages/simplecc-wasm\n\n'; exit 1; }
RUN pnpm --filter @readest/readest-app setup-vendors

FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS development-stage
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV HTTP_PROXY="http://127.0.0.1:18899"
ENV HTTPS_PROXY="http://127.0.0.1:18899"
RUN npm config set proxy http://127.0.0.1:18899 \
    && npm config set https-proxy http://127.0.0.1:18899 \
    && corepack enable
RUN npm install -g pnpm@11.1.1 --force
WORKDIR /app
COPY --from=dependencies /app /app
COPY . .
WORKDIR /app/apps/readest-app
EXPOSE 3000
ENTRYPOINT ["pnpm", "dev-web", "-H", "0.0.0.0"]

FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV HTTP_PROXY="http://127.0.0.1:18899"
ENV HTTPS_PROXY="http://127.0.0.1:18899"
# Per-process V8 heap cap. The Next 16 type-check phase legitimately needs
# ~3-4 GB for this app's 200+ transitive type dependencies. The total RSS
# is kept in check by `experimental.cpus: 2` in next.config.mjs and the
# `mem_limit: 12g` on the compose service.
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm config set proxy http://127.0.0.1:18899 \
    && npm config set https-proxy http://127.0.0.1:18899 \
    && corepack enable
RUN npm install -g pnpm@11.1.1 --force
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_PLATFORM
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_OBJECT_STORAGE_TYPE
ARG NEXT_PUBLIC_STORAGE_FIXED_QUOTA
ARG NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/apps/readest-app/node_modules /app/apps/readest-app/node_modules
COPY --from=dependencies /app/apps/readest-app/public/vendor /app/apps/readest-app/public/vendor
COPY --from=dependencies /app/packages/foliate-js/node_modules /app/packages/foliate-js/node_modules
COPY . .
WORKDIR /app/apps/readest-app
RUN pnpm config set proxy http://127.0.0.1:18899 \
    && pnpm config set https-proxy http://127.0.0.1:18899 \
    && pnpm build-web

FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS production-stage
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV HTTP_PROXY="http://127.0.0.1:18899"
ENV HTTPS_PROXY="http://127.0.0.1:18899"
RUN npm config set proxy http://127.0.0.1:18899 \
    && npm config set https-proxy http://127.0.0.1:18899 \
    && corepack enable
RUN npm install -g pnpm@11.1.1 --force
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/readest-app
ENTRYPOINT ["pnpm", "start-web", "-H", "0.0.0.0"]
EXPOSE 3000
