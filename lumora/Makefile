.PHONY: setup dev build test test-server test-web test-e2e run clean

setup:            ## install all dependencies
	cd web && npm ci
	cd e2e && npm ci
	cd server && cargo fetch

build:            ## production build (frontend + release binary)
	cd web && npm run build
	cd server && cargo build --release

run: build        ## run the production build locally on :8080
	cd server && ./target/release/lumora

dev:              ## API on :8080 + Vite dev server on :5173 with hot reload
	(cd server && cargo run) & (cd web && npm run dev)

test: test-server test-web test-e2e   ## run every test suite

test-server:
	cd server && cargo test

test-web:
	cd web && npm run typecheck && npm test

test-e2e: build
	cd e2e && npx playwright test --trace off

clean:
	rm -rf server/target web/dist data
