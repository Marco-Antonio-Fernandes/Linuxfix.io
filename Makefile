.PHONY: dev build build-linux install test

dev:
	npm run dev

build:
	npm run build:linux

build-linux:
	npm run build:linux

install:
	bash scripts/install-linux.sh

test:
	npm test
