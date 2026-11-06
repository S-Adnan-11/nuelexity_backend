# Run the backend on Render

Deploy this repository as a Node web service. The checked-in [Render configuration](../render.yaml) is a deployment template. It names a release branch; confirm the branch and revision the service actually tracks before publishing an update.

| Field | Value |
| --- | --- |
| Build command | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Start command | `npm start` |
| Health check | `/health` |
| Node version | `22.23.2` |
| Build configuration | `SKIP_INSTALL_DEPS=true`, `NUELEXITY_ENV_FILE=none` |

The template selects a single Free instance and disables automatic deploys. Set production values from the [setup guide](SETUP.md) in Render. Use exact HTTPS frontend origins and the production Turnstile secret. Keep provider keys out of Git and out of Pages. For Render's managed ingress, use `CLIENT_IP_MODE=render` with `TRUST_PROXY_HOPS=0`. Do not enable Render IP handling in local development or on another host.

`/health` is process liveness; `/ready` verifies required configuration and storage access. A Free instance can sleep and take time to start. The frontend coordinates safe startup reads and leaves the draft editable while guest verification is pending. Do not put searches or guest token exchanges in an automatic wake-up retry loop.

After a release, confirm the intended backend revision, health/readiness, allowed and rejected origins, and guest verification on the frontend hostname. The [API contract](API.md) defines the expected stream and error behavior. Deploying the API does not apply SQL or deploy the frontend.

If a release fails, review its startup logs and restore the previous known-good Render deployment where available. Database changes require separate review; rolling back an API build does not revert schema or user data.
