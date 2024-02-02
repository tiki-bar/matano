ARG BUILDKIT_SBOM_SCAN_CONTEXT=true
ARG BUILDKIT_SBOM_SCAN_STAGE=true
ARG RUSTUP_TOOLCHAIN=1.63

FROM ubuntu:22.04 AS build-base

ARG BUILDKIT_SBOM_SCAN_CONTEXT
ARG BUILDKIT_SBOM_SCAN_STAGE
ARG RUSTUP_TOOLCHAIN
ENV RUSTUP_TOOLCHAIN=${RUSTUP_TOOLCHAIN}

# Install common deps and language frameworks
RUN apt-get -q update && \
    apt-get -q install -y \
        apt-transport-https \
        build-essential \
        curl \
        gnupg \
        python3 \
        python3-pip \
        python3-venv \
    && \
    update-alternatives --install /usr/bin/python python /usr/bin/python3 1 && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key \
        | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_16.x jammy main" \
        > /etc/apt/sources.list.d/nodesource.list && \
    echo "deb-src [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_16.x jammy main" \
        >> /etc/apt/sources.list.d/nodesource.list && \
    curl -fsSL https://apt.corretto.aws/corretto.key \
        | gpg --dearmor -o /usr/share/keyrings/corretto-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/corretto-keyring.gpg] https://apt.corretto.aws stable main" \
        > /etc/apt/sources.list.d/corretto.list && \
    curl -fsSL https://sh.rustup.rs | sh -s -- -y && \
    apt-get -q update && \
    apt-get -q install -y \
        java-11-amazon-corretto-jdk \
        nodejs \
    && \
    rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

# Add Cargo to path
ENV PATH="/root/.cargo/bin:${PATH}"

RUN mkdir /opt/matano
WORKDIR /opt/matano
RUN pip install --no-cache-dir cargo-lambda

# Copy and build the Matano codebase
FROM build-base AS build
ARG BUILDKIT_SBOM_SCAN_CONTEXT
ARG BUILDKIT_SBOM_SCAN_STAGE
COPY . .
RUN make build-cli
RUN make build-infra
RUN make build-python
RUN make build-rust
RUN make build-jvm
RUN make package

# Final image with the Matano CLI
