# Lapin on Hetzner

The static app behind the Cloudflare tunnel of the BubbleBIM server
(`23.88.107.11`, tunnel `c7dc4ca3-…`), beside BubbleBIM.

| | |
|---|---|
| URL | `https://lapin.ciuntucbimstudio.ro` |
| Server folder | `/opt/lapin` (`www/` is the build) |
| Container | `lapin-web` (nginx), `127.0.0.1:3461` |
| Tunnel route | `lapin.ciuntucbimstudio.ro` → `http://127.0.0.1:3461` |

```bash
./deploy/lapin/deploy.sh          # build the app, sync, reload
FULL=1 ./deploy/lapin/deploy.sh   # also rebuild WASM and the packages
```

No backend: the AI assistant is not deployed, and the Autodesk / cloud
sources are not proxied. Project location's coordinate systems (`/api/epsg`)
and bSDD (`/api/bsdd`) go through nginx as the Vercel rewrites did.
