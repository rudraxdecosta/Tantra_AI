# Tantra

A web-based learning and exam preparation platform designed for college students. It provides conversational explanations in Hinglish, step-by-step concept breakdowns from fundamentals, ASCII diagrams, and structured notes for university examinations.

Primary focus: B.Tech Semester 1 subjects (Engineering Graphics, Mechanics, Chemistry, Mathematics, ECE, EVS, and Labs), extensible to other coursework.

## Features

- Concept explanations from absolute zero using simple language and practical analogies.
- Visual schematics and text diagrams for mechanical and circuit concepts.
- Material uploads supporting PDFs, PPTs, and images for targeted doubt-solving.
- Exam-oriented formats including 2-mark, 5-mark, and 10-mark structured answers.
- Study planner based on available student study hours.
- Quick navigation shortcuts: NEXT, REVISE, TEST ME, EXPLAIN AGAIN, SHORT NOTES, NUMERICALS, and IMPORTANT QUESTIONS.

## Tech Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, Lucide React
- Backend: Supabase Edge Functions (Deno)
- Database & Auth: Supabase (PostgreSQL with Row Level Security)
- LLM Provider: Google Gemini API (called securely server-side)

## Project Structure

```
├── src/
│   ├── components/
│   │   ├── TeacherChat.tsx     # Chat interface
│   │   ├── StudyDashboard.tsx  # Course modules and progress
│   │   ├── AuthPanel.tsx       # Authentication
│   │   └── AdminPortal.tsx     # Admin panel
│   ├── lib/
│   │   ├── teacher.ts          # Edge function API calls and message handling
│   │   ├── study.ts            # Course intelligence utilities
│   │   ├── access.ts           # Role-based access logic
│   │   └── supabase.ts         # Supabase client setup
│   ├── App.tsx                 # Root component
│   └── index.css               # Styling
├── supabase/
│   ├── functions/
│   │   ├── teacher/            # Edge function calling Gemini API
│   │   └── _shared/            # Shared HTTP and CORS headers
│   └── migrations/             # Database schema migrations
├── package.json
├── vercel.json
└── vite.config.ts
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm
- A Supabase account and project
- A Google Gemini API key

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/rudraxdecosta/Tantra_AI.git
   cd Tantra_AI
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Copy `.env.example` to `.env` and fill in your Supabase credentials:
   ```bash
   cp .env.example .env
   ```

   ```env
   VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
   ```

### Database & Backend Setup

1. Run the database migrations in `supabase/migrations/` using the Supabase CLI or SQL Editor in the dashboard:
   ```bash
   npx supabase db push --remote=<your-project-id>
   ```

2. Save your Gemini API key in the server-side secrets table:
   ```sql
   INSERT INTO tantra_service_secrets (name, value)
   VALUES ('GEMINI_API_KEY', '<your-gemini-api-key>')
   ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
   ```

3. Deploy the Edge Function:
   ```bash
   npx supabase functions deploy teacher --remote=<your-project-id>
   ```

### Running Locally

Start the local development server:
```bash
npm run dev
```

Build for production:
```bash
npm run build
```

Preview production build:
```bash
npm run preview
```

## Deployment

The project is configured for deployment on Vercel. `vercel.json` includes client-side routing rewrites. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your Vercel project environment variables before building.
