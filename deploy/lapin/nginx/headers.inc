# Repeated in every location: nginx drops the server's add_header lines in a
# location that has its own. Without COOP / COEP the WASM threads (and
# SharedArrayBuffer) do not start.
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "credentialless" always;
add_header X-Frame-Options "SAMEORIGIN" always;
