# Price Capital Deal Flow Backend

Backend API for Price Capital's deal flow management system.

## Features
- Supabase authentication
- Deal management (CRUD)
- Google Form webhook integration
- Email outreach
- User management

## Tech Stack
- Node.js + Express
- Supabase (PostgreSQL + Auth)
- Nodemailer (Email)

## Deployment
Deployed on Railway with automatic deployments from GitHub.

## Environment Variables
Required in Railway:
- `PORT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `NODE_ENV`
