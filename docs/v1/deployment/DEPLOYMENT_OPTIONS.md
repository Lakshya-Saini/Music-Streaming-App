# AWS Deployment Options

The app is three moving pieces — a static SPA behind Nginx, a NestJS API that shells out to `ffmpeg`/`ffprobe`/`yt-dlp`, and MongoDB — plus an S3 bucket it already depends on regardless of where it's hosted. This doc compares realistic ways to run that on AWS 24/7, and recommends one for minimal ongoing cost.

## What the hosting choice actually needs to support

- A **long-lived process** that can spawn `ffmpeg`/`ffprobe`/`yt-dlp` child processes and write to local disk temporarily (`server/temp/<trackId>/`) during transcoding — rules out pure request/response FaaS (Lambda) cleanly, since transcoding a multi-minute WAV into 4 renditions can exceed typical function time/disk limits and pay-per-invocation pricing would be worse than a small always-on box for a "runs 24/7" workload.
- **Persistent storage for MongoDB** — either self-hosted (needs a durable disk) or an external managed service.
- **HTTP range request support end-to-end** (client → reverse proxy → API → S3) — already implemented in `nginx.conf` and `TracksService.createStreamingResponse`; any hosting choice just needs to not break `Range`/`Content-Range` passthrough.
- **24/7 availability** at the lowest realistic monthly cost — this repo has no autoscaling requirement (no announced traffic spikes), so paying for elasticity you won't use is pure waste.

## Options considered

| Option | How it'd run this app | Approx. cost (24/7, always-on) | Pros | Cons |
|---|---|---|---|---|
| **EC2 (single instance) + Docker Compose** — *recommended* | The existing `docker-compose.yml` runs almost unchanged on one small VM | **~$16–19/month** (compute + disk; see cost breakdown below) | Cheapest 24/7 compute AWS offers; runs the repo's existing Docker Compose setup with minimal changes; full control over the box; free Elastic IP while attached | You manage OS patching, Docker updates, and backups yourself; single point of failure unless paired with instance recovery (see guide) |
| **AWS Lightsail** | A Lightsail instance bundle running the same Docker Compose stack | ~$10–20/month (fixed bundle price, includes a static IP + data transfer allowance) | Simpler console, predictable flat pricing, static IP included free | Less flexible than raw EC2 (fixed bundles), no meaningful cost advantage over EC2 at this scale, still self-managed |
| **ECS Fargate** (1 task running the containers) | Same containers, no EC2 host to patch — AWS manages the underlying compute | ~$25–40/month (per-vCPU/GB-hour billing has no idle discount; typically also needs an Application Load Balancer at ~$16/month minimum to get a stable public endpoint) | No OS/host maintenance; easy to scale later | Meaningfully more expensive than a single EC2 instance for a constantly-on, low-traffic workload; still needs a persistent volume story for Mongo (EFS) or an external Mongo service, adding more moving parts |
| **AWS App Runner** | The API and client would need to be separate App Runner services; MongoDB can't run inside App Runner at all | ~$25–50+/month once you add a managed Mongo (Atlas) and can't easily co-locate `ffmpeg`/`yt-dlp` binaries with default runtimes without a custom image anyway | Fully managed, auto-TLS, simplest App Runner-native config for a *stateless single container* | Doesn't fit this app's shape well — needs the Docker Compose stack split into multiple managed services plus an external database, more expensive and more complex than it looks for what is a small always-on app |
| **Elastic Beanstalk (multi-container Docker)** | Beanstalk-managed EC2 + ALB running the Docker Compose-like config | ~$30–45/month (Beanstalk provisions an ALB and, by default, wants more than one instance for "production" environments) | Managed deploys/rollbacks, health checks, some AWS glue built in | Real cost and complexity overhead (ALB, multi-AZ defaults) for an app that doesn't need them yet |
| **EKS (Kubernetes)** | The stack as a set of Kubernetes manifests | $73/month **before any compute** (control plane fee alone), plus node cost | Industry-standard if you're already running Kubernetes elsewhere | Wildly disproportionate for a single-service app at this scale — ruled out |

## Recommendation

**A single EC2 instance running the existing `docker-compose.yml`, paired with MongoDB Atlas's free tier (M0) instead of self-hosting Mongo in a container, with all runtime configuration pulled from AWS Secrets Manager rather than a `.env` file.**

Why this combination specifically, not just "EC2":

1. **EC2 with Docker Compose is the cheapest way to keep something running 24/7 on AWS.** There's no per-request billing, no load balancer tax, and no control-plane fee — you pay for exactly one small VM, which is also the smallest possible blast radius to reason about and reuses the repo's existing `docker-compose.yml` almost as-is.
2. **Offloading MongoDB to Atlas's M0 tier costs $0/month** and removes the one genuinely stateful, backup-sensitive piece of the stack from the box you're managing yourself. Atlas handles patching and backups for that tier at no cost, and it frees up the instance's RAM for what actually needs it here — `ffmpeg` encoding, which is the app's real CPU/memory spike. This means you can run on a smaller instance than you'd need if Mongo were also competing for RAM on the same box.
3. **S3 stays exactly as it is today** — it's already a dependency of the app regardless of compute choice, and it's already the cheapest possible place to keep audio/image bytes.
4. Every other option on the list either costs meaningfully more for an always-on single-service app, or adds infrastructure (load balancers, managed multi-container orchestration, Kubernetes control planes) this app has no current need for.

### Estimated monthly cost (recommended setup)

| Item | Estimated cost |
|---|---|
| EC2 `t3.small` (2 GiB RAM, x86_64, on-demand) | ~$15/month (check the [EC2 pricing page](https://aws.amazon.com/ec2/pricing/on-demand/) for current rates and your region; a 1-year Savings Plan brings this down further; a Graviton `t4g.small` on an arm64 AMI runs the same setup for somewhat less) |
| EBS `gp3` 20 GB root volume | ~$1.60/month |
| Elastic IP | $0 while attached to a running instance |
| Data transfer out | First 100 GB/month is AWS's account-wide free allowance; $0.09/GB after that |
| S3 (Standard storage + requests, small catalog) | ~$1–3/month at a few hundred tracks |
| Secrets Manager (1 secret) | ~$0.40/month + negligible API call cost |
| MongoDB Atlas M0 | $0 (free tier) |
| Domain + DNS hosting (optional, only if using a custom domain) | Varies by registrar/provider — typically ~$0–1/month + annual registration |
| TLS certificate (Let's Encrypt) | $0 |
| **Total** | **≈ $15–22/month**, depending on whether you use a custom domain |

**Do not use `t3.micro` (1 GiB RAM)** even though it's cheaper — building both Docker images (`npm ci`/`tsc` for the server, `npm ci`/Vite for the client, plus installing `ffmpeg`/`yt-dlp`) is memory-hungry enough to stall for a very long time or thrash on swap at 1 GiB, and the same box needs headroom at runtime for `ffmpeg` transcoding. `t3.small`/`t4g.small` is the practical minimum, not just a comfort margin.

See [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for step-by-step setup instructions for this recommended option.
