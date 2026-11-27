# Runtime image: the prebuilt static site served by static-web-server (Rust, one ~7 MB binary, no shell).
# Build the site first (`make build` -> ./dist), then from the repository root:
#   docker build -f docker/Dockerfile -t icd-search .
# Run it hardened:
#   docker run --rm -p 8080:8080 --read-only --cap-drop ALL --security-opt no-new-privileges icd-search
FROM ghcr.io/static-web-server/static-web-server:2.44.3

COPY dist/ /public/
COPY docker/sws.toml /etc/sws.toml

ENV SERVER_CONFIG_FILE=/etc/sws.toml
# Unprivileged, fixed uid so Kubernetes can set runAsNonRoot / readOnlyRootFilesystem without surprises.
USER 10001:10001
EXPOSE 8080
