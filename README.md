# Hillsgoods MongoDB Starter

This package starts the backend/API layer for the Hillsgoods website and includes the current frontend plus an API client starter.

## Architecture
- Frontend: Netlify or GitHub Pages
- Backend: Node.js + Express (Render-compatible)
- Database: MongoDB Atlas
- Auth: password hash + JWT; API routes require a valid bearer token

## Stage 1: Create Atlas
1. Create a project named `Hillsgoods` at https://www.mongodb.com/atlas.
2. Create a free-tier cluster if offered.
3. Under Database Access, create a database user with a strong password.
4. Under Network Access, add the backend's outbound IP if known. For initial Render setup, Atlas may require temporary `0.0.0.0/0`; if used, keep strong DB credentials and consider private networking or restricted IPs later.
5. Select Connect → Drivers → Node.js and copy the URI. Replace the password placeholder and set the database name to `hillsgoods`.
6. Do not put the URI in the frontend or commit it to GitHub.

## Stage 2: Run the backend locally
1. Install Node.js 20 or later.
2. Open a terminal in `backend/`.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Fill `MONGODB_URI`, `JWT_SECRET`, `SETUP_SECRET`, and `FRONTEND_ORIGIN`.
   - `JWT_SECRET` and `SETUP_SECRET` should be different, random values of 32+ characters.
   - Keep `.env` private; it is gitignored.
6. Run `npm run dev`.
7. Check `http://localhost:4000/api/health`.

## Stage 3: Create the first admin
Use an API client such as curl or Postman to send one POST request to `http://localhost:4000/api/setup`:
```json
{
  "setupSecret": "the same value as SETUP_SECRET in .env",
  "email": "your-login-email@example.com",
  "password": "use-a-unique-password-at-least-12-characters"
}
```
After the first admin is created, the setup endpoint refuses to create another user. Keep `SETUP_SECRET` private and rotate/remove it after setup. Do not send secrets to anyone.

Then sign in using `POST /api/login` with `{ "email": "...", "password": "..." }`. Use the returned token as `Authorization: Bearer <token>` for API calls.

## API routes
- `GET /api/health` — service/database health
- `POST /api/setup` — one-time initial admin setup
- `POST /api/login` — get JWT token
- `GET/POST /api/products`
- `PATCH/DELETE /api/products/:id`
- `GET/POST /api/transactions`
- `GET /api/summary`

Purchase transactions add quantity to stock; sales subtract quantity and are rejected if there is insufficient stock. Expenses are recorded without changing product stock.

## Stage 4: Deploy backend to Render
1. Push the `backend/` folder to a private GitHub repository (or a repo with backend as its root).
2. Create a Render Web Service connected to the repo.
3. Set root directory to `backend` if backend is inside a monorepo.
4. Build command: `npm install`
5. Start command: `npm start`
6. Add environment variables from `.env` in Render's Environment page. Do not upload `.env`.
7. Set `FRONTEND_ORIGIN` to your exact Netlify domain, plus localhost during local testing if needed.
8. Deploy and verify `https://YOUR-BACKEND.onrender.com/api/health`.

## Language and user accounts
- Every user has an independent `language` preference (`en` or `ml`).
- Products are stored once with optional `nameEn` and `nameMl`. The frontend displays the preferred-language name and falls back to the other language. Existing products that only have `name` continue to work as the English/legacy name.
- Sign in as the admin and open Settings → User management to create individual staff/admin accounts. Initial passwords must be at least 12 characters and are stored as bcrypt hashes; the API never returns password hashes.
- The initial admin still needs to be created through the one-time `/api/setup` route. Keep `SETUP_SECRET` private.

## Stage 5: Frontend integration
`frontend/api-client.js` is a starter client. Replace `https://YOUR-BACKEND.onrender.com` with the deployed backend URL, then connect the existing page forms to it. A login screen should be added before showing business records. Do not expose `MONGODB_URI`, `JWT_SECRET`, or `SETUP_SECRET` in frontend JavaScript.

## Important prototype limits
- The existing `frontend/index.html` still contains sample records and is not yet fully wired to the API. The API client is prepared, but we should connect the UI forms and replace sample arrays in the next implementation step.
- This starter uses JWT in the browser session for simplicity. For a production deployment, prefer secure, HttpOnly cookie sessions or additional hardening before storing sensitive business data.
- Profit reporting currently exposes sales-minus-purchases and expenses as a cash comparison, not final accounting profit. Accurate gross profit requires cost-of-goods-sold / stock valuation logic, and should be implemented before relying on P&L figures.
- Keep database backups enabled and test restoring them.
