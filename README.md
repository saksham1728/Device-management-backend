# Curvvtech Device Management Backend

A backend system for a simplified Smart Device Management Platform.

## Features
- User registration & authentication (JWT)
- Device CRUD & heartbeat
- Device logs & usage analytics
- Rate limiting (100 req/min/user)
- Background job: auto-deactivate inactive devices
- Validation (Joi)
- Dockerized
- MVC architecture

## Tech Stack
- Node.js (Express)
- MongoDB (Mongoose)
- JWT, Joi, express-rate-limit, node-cron

## Setup
1. Clone repo
2. `npm install`
3. Set up `.env` (see `.env` example)
4. `npm start` or `npm run dev`

## Docker
```
docker build -t device-mgmt .
docker run -p 5000:5000 --env-file .env device-mgmt
```

## API Endpoints
### Auth
- POST `/auth/signup` — Register
- POST `/auth/login` — Login

### Devices
- POST `/devices` — Register device
- GET `/devices` — List devices (filter: type, status)
- PATCH `/devices/:id` — Update device
- DELETE `/devices/:id` — Remove device
- POST `/devices/:id/heartbeat` — Update last_active_at

### Logs & Analytics
- POST `/devices/:id/logs` — Create log
- GET `/devices/:id/logs?limit=10` — Fetch logs
- GET `/devices/:id/usage?range=24h` — Aggregated usage

## Assumptions
- Only device owners can manage/view their devices/logs
- JWT required for all device/log endpoints
- Rate limit applies per user (by user id if logged in, else by IP)
- Device auto-deactivation runs hourly by cron

## Testing
- `npm test` (Jest)

## Postman
- See `postman_collection.json` for sample requests

## API Documentation (Postman)
- [View the published Postman documentation here](https://documenter.getpostman.com/view/42468215/2sB3BHmoma)
