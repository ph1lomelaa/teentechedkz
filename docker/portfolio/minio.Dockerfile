# Pinned official MinIO source; public prebuilt images are no longer available.
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git
ARG MINIO_VERSION=RELEASE.2025-09-07T16-13-09Z
RUN git clone --depth 1 --branch "$MINIO_VERSION" https://github.com/minio/minio.git /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -trimpath -o /minio .
FROM alpine:3.22
RUN apk add --no-cache ca-certificates curl
COPY --from=build /minio /usr/local/bin/minio
ENTRYPOINT ["minio"]
