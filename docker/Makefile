# Readest Docker Management
# ─────────────────────────────
# Usage: make <target>
#
# Common targets:
#   make up          — start all services (production, pull image)
#   make dev         — start with local source mount + hot reload
#   make build       — build client image from source, then start
#   make down         — stop and remove containers
#   make logs         — tail all logs
#   make status       — show container status and resource usage
#   make init         — first-time setup (.env + secrets)
#   make help         — show this help

COMPOSE   = docker compose
COMPOSE_F = -f compose.yaml
DEV_F     = -f compose.yaml -f compose.dev.yaml
BUILD_F   = -f compose.yaml -f compose.build.yaml
ENV_FILE  = .env

# ── Lifecycle ──────────────────────────────────────────────────

.PHONY: up
up: ## Start all services (production, pull pre-built image)
	$(COMPOSE) $(COMPOSE_F) up -d

.PHONY: dev
dev: ## Start with local source mount for development (hot reload)
	$(COMPOSE) $(DEV_F) up --build -d

.PHONY: build
build: ## Build client image from local source, then start
	$(COMPOSE) $(BUILD_F) up --build -d

.PHONY: rebuild
rebuild:
	$(COMPOSE) $(BUILD_F) build client --no-cache

.PHONY: recreate
recreate:
	$(COMPOSE) $(COMPOSE_F) up -d --force-recreate client

.PHONY: down
down: ## Stop and remove all containers (keep data)
	$(COMPOSE) $(COMPOSE_F) down

.PHONY: restart
restart: ## Restart all services (no rebuild)
	$(COMPOSE) $(COMPOSE_F) restart

.PHONY: pull
pull: ## Pull latest images
	$(COMPOSE) $(COMPOSE_F) pull

# ── First-time setup ──────────────────────────────────────────

.PHONY: init
init: ## First-time setup: create .env and generate secrets
	@test -f $(ENV_FILE) && echo "$(ENV_FILE) already exists, skipping." || { \
		cp .env.example $(ENV_FILE); \
		echo "Created $(ENV_FILE) from .env.example"; \
	}
	@echo ""
	@echo "Now edit $(ENV_FILE) — at minimum change these 5 values:"
	@echo "  POSTGRES_PASSWORD   (random 32+ chars)"
	@echo "  JWT_SECRET          (random 32+ chars)"
	@echo "  ANON_KEY            (HS256 JWT with {\"role\":\"anon\"} signed by JWT_SECRET)"
	@echo "  SERVICE_ROLE_KEY    (HS256 JWT with {\"role\":\"service_role\"} signed by JWT_SECRET)"
	@echo "  MINIO_ROOT_PASSWORD (strong password)"
	@echo ""
	@echo "Quick way to generate secrets:"
	@echo "  make gen-secret     — print a random 64-char hex string"
	@echo "  make gen-jwt        — generate ANON_KEY and SERVICE_ROLE_KEY"
	@echo ""
	@echo "After editing .env, run:  make up"

.PHONY: gen-secret
gen-secret: ## Generate a random 64-char hex string (for passwords / JWT secret)
	@openssl rand -hex 32

.PHONY: gen-jwt
gen-jwt: ## Generate ANON_KEY and SERVICE_ROLE_KEY from JWT_SECRET in .env
	@bash -c '\
		test -f $(ENV_FILE) || { echo "Run make init first."; exit 1; }; \
		SECRET=$$(grep "^JWT_SECRET=" $(ENV_FILE) | cut -d= -f2-); \
		test -n "$$SECRET" || { echo "JWT_SECRET is empty in $(ENV_FILE)"; exit 1; }; \
		echo "Generating JWTs from JWT_SECRET in $(ENV_FILE) ..."; \
		echo ""; \
		encode_jwt() { \
			python3 -c "import json,hmac,hashlib,base64; \
				def b(d):return base64.urlsafe_b64encode(d).rstrip(b\"=\").decode(); \
				h=b(json.dumps({\"alg\":\"HS256\",\"typ\":\"JWT\"}).encode()); \
				p=b(json.dumps({\"role\":\"$$1\"}).encode()); \
				s=b(hmac.new(\"$$SECRET\".encode(),f\"{h}.{p}\".encode(),hashlib.sha256).digest()); \
				print(f\"{h}.{p}.{s}\")" 2>/dev/null || \
			node -e " \
				const c=require(\"crypto\"); \
				function b(d){return Buffer.from(d).toString(\"base64url\")} \
				const h=b(JSON.stringify({alg:\"HS256\",typ:\"JWT\"})); \
				const p=b(JSON.stringify({role:\"$$1\"})); \
				const s=b(c.createHmac(\"sha256\",\"$$SECRET\").update(h+\".\"+p).digest()); \
				console.log(h+\".\"+p+\".\"+s)" 2>/dev/null || \
			echo "  ERROR: need python3 or node to generate JWTs. Use https://jwt.io instead."; \
		}; \
		echo "ANON_KEY:";   encode_jwt "anon"; \
		echo ""; \
		echo "SERVICE_ROLE_KEY:"; encode_jwt "service_role"; \
	'

# ── Monitoring ────────────────────────────────────────────────

.PHONY: status
status: ## Show container status and resource usage
	@$(COMPOSE) $(COMPOSE_F) ps
	@echo ""
	@echo "Resource usage:"
	@docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" \
		$$(docker compose $(COMPOSE_F) ps -q 2>/dev/null) 2>/dev/null || true

.PHONY: logs
logs: ## Tail logs from all services (Ctrl+C to stop)
	$(COMPOSE) $(COMPOSE_F) logs -f

.PHONY: logs-client
logs-client: ## Tail client (Next.js) logs only
	$(COMPOSE) $(COMPOSE_F) logs -f client

.PHONY: logs-db
logs-db: ## Tail PostgreSQL logs only
	$(COMPOSE) $(COMPOSE_F) logs -f db

.PHONY: logs-auth
logs-auth: ## Tail GoTrue auth logs only
	$(COMPOSE) $(COMPOSE_F) logs -f auth

# ── Data management ──────────────────────────────────────────

.PHONY: backup-db
backup-db: ## Dump PostgreSQL to backup.sql.gz
	docker exec supabase-db pg_dump -U supabase_admin -d postgres | gzip > backup.sql.gz
	@echo "Database backed up to backup.sql.gz ($$(du -h backup.sql.gz | cut -f1))"

.PHONY: restore-db
restore-db: ## Restore PostgreSQL from backup.sql.gz (stops client first)
	$(COMPOSE) $(COMPOSE_F) stop client rest auth
	gunzip -c backup.sql.gz | docker exec -i supabase-db psql -U supabase_admin -d postgres
	$(COMPOSE) $(COMPOSE_F) start rest auth client
	@echo "Database restored from backup.sql.gz"

.PHONY: shell-db
shell-db: ## Open a PostgreSQL shell
	docker exec -it supabase-db psql -U supabase_admin -d postgres

.PHONY: shell-minio
shell-minio: ## Open MinIO management shell (mc CLI)
	docker exec -it readest-minio mc alias set local http://localhost:9000 $$(grep '^MINIO_ROOT_USER=' $(ENV_FILE) | cut -d= -f2) $$(grep '^MINIO_ROOT_PASSWORD=' $(ENV_FILE) | cut -d= -f2)
	docker exec -it readest-minio sh

# ── Cleanup ──────────────────────────────────────────────────

.PHONY: nuke
nuke: ## ⚠️  Remove all containers, volumes, and data (irreversible!)
	@echo "This will delete ALL data (database, files, config)."
	@echo -n "Type 'yes' to confirm: " && read ans && [ "$$ans" = "yes" ] || (echo "Aborted." && exit 1)
	$(COMPOSE) $(COMPOSE_F) down -v --rmi local
	@echo "All containers, volumes, and local images removed."

# ── Help ─────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
