# Payment Flow CRM

CRM SaaS complet pour la gestion des leads commerciaux — Payment Flow.

## Stack

| Couche   | Technologie                          |
|----------|--------------------------------------|
| Frontend | Next.js 14 App Router + TypeScript   |
| UI       | Tailwind CSS · Recharts · dnd-kit    |
| State    | Zustand + TanStack Query v5          |
| Backend  | Node.js + Express                    |
| DB       | PostgreSQL 15                        |
| Auth     | JWT (jsonwebtoken + bcryptjs)        |
| Infra    | Docker + docker-compose              |

## Démarrage rapide

### Base de données

```bash
docker run --name pf-postgres \
  -e POSTGRES_DB=payment_flow_crm \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 -d postgres:15-alpine

psql postgresql://postgres:password@localhost:5432/payment_flow_crm -f database/schema.sql
psql postgresql://postgres:password@localhost:5432/payment_flow_crm -f database/seed.sql
```

### Backend

```bash
cd backend && cp .env.example .env && npm install && npm run dev
# → http://localhost:4000
```

### Frontend

```bash
cd frontend && cp .env.example .env && npm install && npm run dev
# → http://localhost:3000
```

### Tout avec Docker

```bash
docker-compose up --build
```

## Comptes de démo

| Rôle   | Email                         | Mot de passe |
|--------|-------------------------------|--------------|
| Admin  | admin@paymentflow.fr          | Admin123!    |
| Setter | alice.martin@paymentflow.fr   | Setter123!   |
| Setter | bob.dupont@paymentflow.fr     | Setter123!   |
| Setter | claire.bernard@paymentflow.fr | Setter123!   |

## Fonctionnalités

- Authentification JWT (admin + setter)
- CRUD leads complet avec historique
- Import CSV mapping automatique FR/EN
- Attribution round-robin ou manuelle
- Dashboard analytique (KPIs, graphiques, leaderboard)
- Pipeline Kanban drag & drop
- Gestion d'équipe + stats de performance
- Filtrage avancé multi-critères
- Système de tags colorés
- Responsive mobile + Docker ready