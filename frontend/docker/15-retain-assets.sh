#!/bin/sh
# Keep hashed files from older releases usable by already-open browser tabs.
set -eu
source_dir=${1:-/opt/teenteched-assets}
cache_dir=${2:-/usr/share/nginx/html/assets}
mkdir -p "$cache_dir"
cp -R "$source_dir/." "$cache_dir/"
# Current files were refreshed above; prune only files absent from recent releases.
find "$cache_dir" -type f -mtime +30 -delete
