# Contributing to freeframed

freeframed is a NAS-first fork of [FreeFrame](https://github.com/Techiebutler/freeframe)
for individual creators and small teams self-hosting on one box. Contributions that
improve the single-box, low-ops creator workflow belong here; work aimed at SaaS,
multi-tenant, or production-house deployments belongs upstream in mainline FreeFrame.

See the full guides:

- **[Development Setup & Contributing Guide](docs/contributing.md)** — prerequisites, dev environment, coding standards
- **[Architecture Overview](docs/architecture.md)** — system design, tech stack, data flow
- **[Deployment Guide](docs/deployment.md)** — NAS all-in-one setup, Docker, environment variables

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/freeframed.git
cd freeframed
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
# Open http://localhost:3000
```

## Pull Request Process

1. Fork and create a branch: `git checkout -b feat/my-feature`
2. Make your changes and write tests
3. Ensure CI passes: `python -m pytest apps/api/tests/ -v` and `pnpm --filter web build`
4. Open a PR against `main`

## Reporting Issues

- **Bugs & features**: open an issue on [neyako/freeframed](https://github.com/neyako/freeframed/issues)
- **Upstream FreeFrame issues**: [Techiebutler/freeframe](https://github.com/Techiebutler/freeframe/issues)
- **Security**: See [SECURITY.md](SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
