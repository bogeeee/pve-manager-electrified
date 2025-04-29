include ../defines.mk

clean:
	npm run clean

build:
	npm prune --ignore-scripts
	npm run build

.PHONY: install
install: build
	find . -type f ! -path "*/node_modules/*" ! -name ".gitignore" ! -name ".npmignore" -exec install -m 0644 -D "{}" "$(NODEJSSERVERDIR)/{}" \;
