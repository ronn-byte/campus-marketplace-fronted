# MUT Market

MUT Market is a React application served by a Fastify API. Vite provides the frontend development server; in production, Fastify serves the built frontend and API from the same origin.

## Setup

Install dependencies from the repository root:

```sh
npm install
```

Configure the existing backend environment in `backend/.env` using `backend/.env.example`, then generate the Prisma client:

```sh
npm run prisma:generate --prefix backend
```

The backend requires its existing environment settings and database configuration. See [backend/README.md](./backend/README.md) for details.

## Development

From the repository root:

```sh
npm run dev
```

This starts Vite with React hot reload and the Fastify backend together. Vite proxies `/api/v1` to Fastify at `http://localhost:5000`; set `BACKEND_URL` if the backend listens elsewhere. Browser requests use the same-origin `/api/v1` path, and `VITE_API_URL` can optionally set the development proxy target when `BACKEND_URL` is not set.

## Production

Build the frontend and backend from the repository root:

```sh
npm run build
```

The frontend is written to the root `dist/` directory; backend JavaScript is written to `backend/dist/`. Start the production Fastify server with:

```sh
npm start
```

Fastify serves frontend assets and React Router routes from `dist/`, while API routes remain under `/api/v1`.

## Validation

Backend commands are available from the root with npm's `--prefix backend` option, for example:

```sh
npm run typecheck --prefix backend
npm test --prefix backend
```
