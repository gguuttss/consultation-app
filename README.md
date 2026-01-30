# TanStack Start + Neon Postgres Template

A full-stack TanStack Start template with **one-command deployment** to Vercel, Cloudflare Workers, or Netlify.

## Features

- **One command to deploy**: `pnpm ship` handles everything
- **Auto-provisioned database**: Neon Postgres is automatically created on first run
- **Type-safe database**: Drizzle ORM with full TypeScript support
- **Platform flexible**: Deploy to Vercel, Cloudflare Workers, or Netlify

## Prerequisites

You need **pnpm** installed. If you don't have it:

**Windows** (PowerShell as Admin):
```powershell
iwr https://get.pnpm.io/install.ps1 -useb | iex
```

**macOS**:
```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

**Linux**:
```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

After installing, restart your terminal.

> **Note**: pnpm requires Node.js. If you don't have Node.js, pnpm will prompt you to install it, or you can get it from [nodejs.org](https://nodejs.org).

## Deploy This App

To put your app live on the internet, open a terminal in this folder and run:

```bash
pnpm ship
```

This single command takes care of everything needed to host your app online:

1. **Installs dependencies** - Downloads all the code libraries your app needs
2. **Creates a database** - Sets up a free Postgres database to store your data
3. **Prepares the database** - Creates the tables and adds starter data
4. **Deploys your app** - Uploads and hosts your app on Netlify (you'll get a live URL)
5. **Connects everything** - Links your hosted app to your database automatically

When it's done, you'll have a working website with a real database. No need for a server setup, and no configuration files to edit.

> [!IMPORTANT]
> **Claim Your Database!** At the end of `pnpm ship`, you'll see a link to claim your database. **You must click this link and create a Neon account within 72 hours**, or your database will be deleted and your app will stop working. Once claimed, the database is yours forever on Neon's free tier.

## Run Locally (Optional)

If you want to test changes on your own computer before deploying:

```bash
pnpm dev
```

This starts a local version at `http://localhost:3000`.

> [!IMPORTANT]
> **Claim Your Database!** The first time you run `pnpm dev`, a database is created for you. **You must claim it within 72 hours** by clicking the link shown in the terminal, or it will be deleted.

## Available Scripts

- `pnpm dev` - Start development server (port 3000)
- `pnpm build` - Build for production
- `pnpm ship` - Deploy to Vercel, Cloudflare, or Netlify
- `pnpm db:push` - Push schema changes to database
- `pnpm db:studio` - Open Drizzle Studio to browse your database

## Project Structure

```
src/
├── db/
│   ├── index.ts      # Database connection
│   ├── schema.ts     # Drizzle schema definitions
│   └── seed.sql      # Seed data
├── routes/
│   ├── __root.tsx    # Root layout
│   └── index.tsx     # Home page with todo example
└── styles/
    └── main.css      # Global styles
```

## Tech Stack

- [TanStack Start](https://tanstack.com/start) - Full-stack React framework
- [Neon Postgres](https://neon.tech) - Serverless Postgres
- [Drizzle ORM](https://orm.drizzle.team) - Type-safe database toolkit
- [Nitro](https://nitro.unjs.io) - Server toolkit (handles deployment presets)

## Learn More

- [TanStack Start Docs](https://tanstack.com/start/latest/docs)
- [Drizzle ORM Docs](https://orm.drizzle.team/docs/overview)
- [Neon Docs](https://neon.tech/docs)
