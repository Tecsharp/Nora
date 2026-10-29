# El contexto de construcción es la raíz del repositorio (ver docker-compose.yml): hace falta agent/ para compilar el agente de Asistencia.
FROM rust:1-slim AS agent
RUN apt-get update && apt-get install -y --no-install-recommends gcc-mingw-w64-x86-64 libxkbcommon-dev pkg-config \
    && rm -rf /var/lib/apt/lists/* && rustup target add x86_64-pc-windows-gnu
WORKDIR /src
COPY agent/Cargo.toml agent/Cargo.lock ./
COPY agent/src ./src
ENV CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
# Si el agente no compila, Nora sigue arrancando (sin esas descargas) en vez de romper toda la construcción.
RUN mkdir /out && ( cargo build --release --target x86_64-pc-windows-gnu && cp target/x86_64-pc-windows-gnu/release/nora-agent.exe /out/nora-agent-windows.exe ; \
    cargo build --release && cp target/release/nora-agent /out/nora-agent-linux ; true )

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY gateway/nginx.conf /etc/nginx/nginx.conf
COPY gateway/proxy_api.conf /etc/nginx/proxy_api.conf
# Windows y Linux se compilan aquí; el de macOS no se puede compilar desde Linux: ./agent/build.sh en un Mac lo deja en agent/dist/
COPY --from=agent /out /srv/built/downloads
EXPOSE 8080
