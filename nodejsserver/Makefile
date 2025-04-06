include ../defines.mk
build:
	npm prune --ignore-scripts
	npm run build

.PHONY: install
install: build
	find . -type f ! -path "*/node_modules/*" -exec	install -D "{}" "$(NODEJSSERVERDIR)/{}" \;
