
clean: clean-infra clean-cli clean-lib
	rm -rf scripts/packaging/node_modules

clean-infra:
	cd infra && npm run clean && rm -rf cdk.out

clean-cli:
	cd cli && npm run clean

clean-lib:
	rm -rf lib/rust/target
	rm -rf lib/rust/detection_lib/.venv

build-infra:
	cd infra && npm ci && npm run build

build-cli:
	cd cli && npm ci && npm run build

build-nodejs:
	cd lib/nodejs && npm ci && npm run release -ws

build-python-rust:
	cd lib/rust/detection_lib && $(MAKE) release

build-python: build-python-rust
	rm -rf local-assets/MatanoDetectionsCommonLayer && cd lib/python/matano_detection && $(MAKE) release

build-rust:
	cd lib/rust && PYO3_CROSS_PYTHON_VERSION=3.9 cargo lambda build --release --workspace && \
	mkdir -p ${CURDIR}/local-assets && \
	cp -a target/lambda/* ${CURDIR}/local-assets

build-jvm:
	cd lib/java/matano && ./gradlew release

build-assets: build-python build-rust build-jvm

build-all: build-cli build-infra build-assets

package: build-all
	cd scripts/packaging && npm install && cd ${CURDIR} && node scripts/packaging/build.js

local-install: build-cli
	cd cli && npm run full-install

build-docker: clean
	docker buildx build \
		--tag=matano:latest \
		--builder=container \
		--attest=type=sbom \
		--output type=local,dest=out \
		.
