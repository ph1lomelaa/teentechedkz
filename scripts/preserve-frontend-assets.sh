#!/bin/bash
# Seed the persistent cache BEFORE replacing the existing frontend container.
set -euo pipefail
asset_volume=tte_frontend_assets
docker volume create "$asset_volume" >/dev/null
if docker inspect tte_frontend_prod >/dev/null 2>&1; then
    mounted_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/usr/share/nginx/html/assets"}}{{.Name}}{{end}}{{end}}' tte_frontend_prod)
    # Already migrated: the named volume survives container replacement itself.
    if [ "$mounted_volume" = "$asset_volume" ]; then exit 0; fi
    previous_image=$(docker inspect --format '{{.Image}}' tte_frontend_prod)
    # Read the container's actual files, including recovered legacy chunks.
    docker exec tte_frontend_prod tar -C /usr/share/nginx/html/assets -cf - . |
        docker run --rm -i --network none --entrypoint /bin/sh \
            --mount "type=volume,source=$asset_volume,target=/retained" \
            "$previous_image" -c 'tar -xf - -C /retained'
fi
