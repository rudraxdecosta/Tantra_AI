# Tantra AI 

> **Personal AI Teaching & Examination-Preparation Platform for College Students**

Tantra is an intelligent, adaptive educational assistant designed specifically for university students (B.Tech Semester 1 foundation courses including Mathematics, Chemistry, Engineering Graphics, EVS, Mechanics, Workshop, ECE, and Labs — extensible to any branch/semester). 

It breaks down complex academic syllabus into simple, conversational **Hinglish** explanations from absolute zero, accompanied by ASCII/SVG diagrams, exam-oriented notes, and practice problems.

---

## 🌟 Key Features

- **Teach From Zero**: Explains fundamental intuition, everyday analogies, and physical meaning before introducing formulas or technical jargon.
- **Adaptive Difficulty Engine (Levels 1–5)**:
  - **Level 1**: Absolute Beginner (Intuition & simple analogies)
  - **Level 2**: Basic (Formal definitions, terminology & basic formulas)
  - **Level 3**: University Standard (Complete syllabus-level derivations & exam questions)
  - **Level 4**: Advanced Application (Multi-step numericals & complex proofs)
  - **Level 5**: Expert Mastery (Theoretical relationships & independent problem solving)
- **Multi-Modal Material Upload**: Attach PPTs, PDFs, lecture notes, textbook pages, or lab manual photos (up to 15MB) for targeted step-by-step tutoring.
- **Visual Learning & Diagrams**: Labelled ASCII schematics and companion visual maps for mechanical systems, circuits, and technical graphics.
- **Exam Preparation Mode**:
  - Concise 2-mark definitions
  - Structured 5-mark & 10-mark long answers
  - University difference tables
  - Step-by-step numerical calculations & MCQs
- **Interactive Study Planner**: Generates realistic time-bound study roadmaps based on available study hours.
- **Quick Study Commands**: One-click actions for `NEXT`, `REVISE`, `TEST ME`, `EXPLAIN AGAIN`, `SHORT NOTES`, `NUMERICALS`, and `IMPORTANT QUESTIONS`.

---

## 🛠️ Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons
- **Backend / Serverless**: Supabase Edge Functions (Deno Runtime)
- **Database & Auth**: Supabase PostgreSQL, Row Level Security (RLS), Supabase Auth
- **AI Core**: Google Gemini API via server-side Edge Functions

---

## 📁 Project Structure

```
├── src/
│   ├── components/
│   │   ├── TeacherChat.tsx     # Main conversational classroom interface
│   │   ├── StudyDashboard.tsx  # Course modules, roadmap & progress
│   │   ├── AuthPanel.tsx       # Student registration & login
│   │   └── AdminPortal.tsx     # Administration & moderation controls
│   ├── lib/
│   │   ├── teacher.ts          # API client for teacher Edge Function & chat persistence
│   │   ├── study.ts            # Course intelligence & progress tracking
│   │   ├── access.ts           # Access control & admin verification
│   │   └── supabase.ts         # Supabase client initialization
│   ├── App.tsx                 # Root application controller
│   └── index.css               # Modern dark-mode styling & aura animations
├── supabase/
│   ├── functions/
│   │   ├── teacher/            # Teacher AI Edge Function
│   │   └── _shared/            # Shared HTTP & CORS helpers
│   └── migrations/             # SQL schemas, RLS policies, & service secrets
├── package.json
└── vite.config.ts
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or pnpm
- A free [Supabase](https://supabase.com) project
- A [Google AI Studio](https://aistudio.google.com) API Key (Gemini)

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/tantra-ai.git
cd tantra-ai
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment Configuration

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 4. Supabase Database & Edge Functions Setup

1. In your Supabase project's **SQL Editor**, run the database migrations located in `supabase/migrations/` to set up tables (`chat_messages`, `tantra_service_secrets`, etc.).
2. Insert your Google Gemini API key into `tantra_service_secrets`:
   ```sql
   INSERT INTO tantra_service_secrets (name, value)
   VALUES ('GEMINI_API_KEY', 'YOUR_GEMINI_API_KEY')
   ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
   ```
3. Deploy the Edge Function using Supabase CLI:
   ```bash
   npx supabase functions deploy teacher --remote=YOUR_PROJECT_REF
   ```

### 5. Run Development Server

```bash
npm run dev
```

The application will be live at `http://localhost:5173`.

---

## 📦 Production Build

To build the optimized production assets:

```bash
npm run build
```

Preview the build locally:

```bash
npm run preview
```

---

## 🔒 Security & Privacy

- All third-party AI keys are stored server-side in protected database vaults with Row Level Security (RLS) enabled and zero client access.
- User authentication and data isolation are strictly enforced through Supabase RLS policies.
