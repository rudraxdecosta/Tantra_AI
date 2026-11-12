/*
# Create STUDY intelligence foundation

1. Purpose
- Establish the first persistent architecture for STUDY's student intelligence, subject intelligence, adaptive teaching, and exam evidence.
- Keep personal learning data private to the authenticated course owner.
- Preserve learning events as an append-only audit trail while allowing derived models to be rebuilt.

2. New tables
- `courses`: private study spaces owned by one authenticated user.
- `academic_concepts`: stable concept and skill identifiers within a course.
- `source_documents` and `source_fragments`: uploaded academic sources and their extractable sections.
- `subject_model_versions`: immutable published snapshots of the subject map.
- `subject_knowledge_nodes`: versioned subjects, topics, concepts, skills, objectives, methods, and question categories.
- `subject_knowledge_edges`: versioned prerequisite and academic relationships.
- `subject_concept_sources`: provenance linking knowledge nodes to source material.
- `exam_sources` and `exam_questions`: examination papers and their questions.
- `question_skill_mappings`: validated links between exam questions and academic concepts.
- `student_learning_profiles`: one evolving profile per student and course.
- `student_topic_mastery` and `student_skill_mastery`: interpretable evidence-based knowledge tracing records.
- `student_misconceptions`: recurring conceptual mistake records.
- `learning_events`: immutable student interaction and correction records.
- `learning_event_knowledge_links`: the concepts and skills involved in each learning event.
- `teaching_interventions` and `intervention_outcomes`: teaching approach evidence.
- `student_model_versions`: immutable snapshots of the computed student model.
- `adaptive_recommendations`: evidence-backed next learning activities.
- `model_update_jobs`: idempotent asynchronous processing work items.

3. Security
- Every table has row-level security enabled.
- Authenticated users can access only rows belonging to their own course or student profile.
- Computed mastery, recommendations, model versions, and learning events are read-only through the browser.
- Server-enforced functions record events, create profiles, and delete personal history.
- Anonymous users receive no access to private study data.

4. Versioning and processing
- Subject model versions and student model versions are immutable snapshots.
- Learning events use a client-provided idempotency key scoped to the authenticated user and course.
- Each event processor has one unique job per event, preventing duplicate evidence counting.
- Subject evidence stores source references and confidence so future model versions can be audited.
*/

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  subject_label text NOT NULL CHECK (char_length(subject_label) BETWEEN 1 AND 160),
  learning_mode text NOT NULL DEFAULT 'material_plus_prompt' CHECK (learning_mode IN ('material_only', 'prompt_only', 'material_plus_prompt')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS academic_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  canonical_key text NOT NULL CHECK (char_length(canonical_key) BETWEEN 1 AND 180),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 180),
  concept_type text NOT NULL CHECK (concept_type IN ('concept', 'skill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, canonical_key)
);

CREATE TABLE IF NOT EXISTS source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  source_type text NOT NULL CHECK (source_type IN ('study_material', 'syllabus', 'exam_paper', 'prompt')),
  storage_path text,
  extraction_status text NOT NULL DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'processing', 'ready', 'needs_review', 'failed')),
  provenance_note text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS source_fragments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  fragment_order integer NOT NULL CHECK (fragment_order >= 0),
  locator text,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, fragment_order)
);

CREATE TABLE IF NOT EXISTS subject_model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  change_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (course_id, version_number)
);

CREATE TABLE IF NOT EXISTS subject_knowledge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_model_version_id uuid NOT NULL REFERENCES subject_model_versions(id) ON DELETE CASCADE,
  academic_concept_id uuid REFERENCES academic_concepts(id) ON DELETE SET NULL,
  parent_node_id uuid REFERENCES subject_knowledge_nodes(id) ON DELETE SET NULL,
  node_type text NOT NULL CHECK (node_type IN ('subject', 'unit', 'chapter', 'topic', 'subtopic', 'concept', 'skill', 'objective', 'definition', 'formula', 'theory', 'method', 'question_category', 'misconception')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 240),
  description text,
  importance_score numeric(5, 4) CHECK (importance_score BETWEEN 0 AND 1),
  difficulty_level text CHECK (difficulty_level IN ('introductory', 'developing', 'intermediate', 'advanced')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subject_knowledge_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_model_version_id uuid NOT NULL REFERENCES subject_model_versions(id) ON DELETE CASCADE,
  from_node_id uuid NOT NULL REFERENCES subject_knowledge_nodes(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES subject_knowledge_nodes(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('contains', 'prerequisite', 'related', 'assessed_by', 'supports', 'commonly_confused_with')),
  confidence numeric(5, 4) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  source_basis text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  UNIQUE (subject_model_version_id, from_node_id, to_node_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS subject_concept_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_knowledge_node_id uuid NOT NULL REFERENCES subject_knowledge_nodes(id) ON DELETE CASCADE,
  source_document_id uuid NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  source_fragment_id uuid REFERENCES source_fragments(id) ON DELETE SET NULL,
  provenance_type text NOT NULL CHECK (provenance_type IN ('definition', 'relationship', 'formula', 'example', 'exam_mapping', 'syllabus_importance', 'misconception')),
  excerpt text,
  confidence numeric(5, 4) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_knowledge_node_id, source_document_id, source_fragment_id, provenance_type)
);

CREATE TABLE IF NOT EXISTS exam_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_document_id uuid REFERENCES source_documents(id) ON DELETE SET NULL,
  title text NOT NULL,
  exam_year integer CHECK (exam_year BETWEEN 1900 AND 2200),
  exam_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_source_id uuid NOT NULL REFERENCES exam_sources(id) ON DELETE CASCADE,
  question_number text NOT NULL,
  prompt text,
  question_category text,
  difficulty_level text CHECK (difficulty_level IN ('introductory', 'developing', 'intermediate', 'advanced')),
  marks numeric(8, 2) CHECK (marks >= 0),
  historical_weight numeric(8, 4) CHECK (historical_weight >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_source_id, question_number)
);

CREATE TABLE IF NOT EXISTS question_skill_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_question_id uuid NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  academic_concept_id uuid NOT NULL REFERENCES academic_concepts(id) ON DELETE CASCADE,
  mapping_confidence numeric(5, 4) NOT NULL DEFAULT 0.5 CHECK (mapping_confidence BETWEEN 0 AND 1),
  validated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_question_id, academic_concept_id)
);

CREATE TABLE IF NOT EXISTS student_learning_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  preferred_language text NOT NULL DEFAULT 'English',
  confidence_level text NOT NULL DEFAULT 'developing' CHECK (confidence_level IN ('uncertain', 'developing', 'confident')),
  profile_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_model_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  subject_model_version_id uuid REFERENCES subject_model_versions(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('answer_submitted', 'hint_used', 'explanation_requested', 'confidence_reported', 'intervention_completed', 'revision_completed', 'profile_correction', 'document_processed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS learning_event_knowledge_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_event_id uuid NOT NULL REFERENCES learning_events(id) ON DELETE CASCADE,
  subject_knowledge_node_id uuid NOT NULL REFERENCES subject_knowledge_nodes(id) ON DELETE CASCADE,
  relevance text NOT NULL DEFAULT 'primary' CHECK (relevance IN ('primary', 'supporting', 'prerequisite')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learning_event_id, subject_knowledge_node_id)
);

CREATE TABLE IF NOT EXISTS student_topic_mastery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES student_learning_profiles(id) ON DELETE CASCADE,
  subject_knowledge_node_id uuid NOT NULL REFERENCES subject_knowledge_nodes(id) ON DELETE CASCADE,
  mastery_estimate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (mastery_estimate BETWEEN 0 AND 1),
  confidence_estimate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (confidence_estimate BETWEEN 0 AND 1),
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  correct_attempts integer NOT NULL DEFAULT 0 CHECK (correct_attempts >= 0),
  incorrect_attempts integer NOT NULL DEFAULT 0 CHECK (incorrect_attempts >= 0),
  hint_usage integer NOT NULL DEFAULT 0 CHECK (hint_usage >= 0),
  independent_attempts integer NOT NULL DEFAULT 0 CHECK (independent_attempts >= 0),
  last_demonstrated_at timestamptz,
  recent_trend text NOT NULL DEFAULT 'not_enough_evidence' CHECK (recent_trend IN ('improving', 'steady', 'declining', 'not_enough_evidence')),
  next_practice_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, subject_knowledge_node_id)
);

CREATE TABLE IF NOT EXISTS student_skill_mastery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES student_learning_profiles(id) ON DELETE CASCADE,
  subject_knowledge_node_id uuid NOT NULL REFERENCES subject_knowledge_nodes(id) ON DELETE CASCADE,
  mastery_estimate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (mastery_estimate BETWEEN 0 AND 1),
  confidence_estimate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (confidence_estimate BETWEEN 0 AND 1),
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  correct_attempts integer NOT NULL DEFAULT 0 CHECK (correct_attempts >= 0),
  incorrect_attempts integer NOT NULL DEFAULT 0 CHECK (incorrect_attempts >= 0),
  hint_usage integer NOT NULL DEFAULT 0 CHECK (hint_usage >= 0),
  independent_attempts integer NOT NULL DEFAULT 0 CHECK (independent_attempts >= 0),
  last_demonstrated_at timestamptz,
  recent_trend text NOT NULL DEFAULT 'not_enough_evidence' CHECK (recent_trend IN ('improving', 'steady', 'declining', 'not_enough_evidence')),
  next_practice_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, subject_knowledge_node_id)
);

CREATE TABLE IF NOT EXISTS student_misconceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES student_learning_profiles(id) ON DELETE CASCADE,
  subject_knowledge_node_id uuid NOT NULL REFERENCES subject_knowledge_nodes(id) ON DELETE CASCADE,
  observed_mistake text NOT NULL,
  supporting_attempts integer NOT NULL DEFAULT 1 CHECK (supporting_attempts > 0),
  diagnosis_confidence numeric(5, 4) NOT NULL DEFAULT 0.5 CHECK (diagnosis_confidence BETWEEN 0 AND 1),
  corrective_explanation text,
  improved_afterward boolean,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'improving', 'resolved')),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, subject_knowledge_node_id, observed_mistake)
);

CREATE TABLE IF NOT EXISTS teaching_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES student_learning_profiles(id) ON DELETE CASCADE,
  learning_event_id uuid REFERENCES learning_events(id) ON DELETE SET NULL,
  intervention_type text NOT NULL CHECK (intervention_type IN ('simple_explanation', 'analogy', 'derivation', 'worked_example', 'diagram', 'stepwise_solution', 'guided_practice', 'independent_practice', 'revision')),
  target_node_id uuid REFERENCES subject_knowledge_nodes(id) ON DELETE SET NULL,
  explanation_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intervention_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid NOT NULL REFERENCES teaching_interventions(id) ON DELETE CASCADE,
  outcome_event_id uuid REFERENCES learning_events(id) ON DELETE SET NULL,
  performance_score numeric(5, 4) CHECK (performance_score BETWEEN 0 AND 1),
  independent boolean NOT NULL DEFAULT false,
  hint_used boolean NOT NULL DEFAULT false,
  evidence_quality text NOT NULL DEFAULT 'early' CHECK (evidence_quality IN ('early', 'developing', 'supported')),
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES student_learning_profiles(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  generated_from_event_id uuid REFERENCES learning_events(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version_number)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_learning_profiles_current_version_fk') THEN
    ALTER TABLE student_learning_profiles
      ADD CONSTRAINT student_learning_profiles_current_version_fk
      FOREIGN KEY (current_model_version_id) REFERENCES student_model_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS adaptive_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES student_learning_profiles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  subject_knowledge_node_id uuid REFERENCES subject_knowledge_nodes(id) ON DELETE SET NULL,
  recommendation_type text NOT NULL CHECK (recommendation_type IN ('next_lesson', 'prerequisite_review', 'guided_practice', 'independent_practice', 'revision', 'exam_strategy')),
  title text NOT NULL,
  rationale text NOT NULL,
  evidence_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject_model_version_id uuid REFERENCES subject_model_versions(id) ON DELETE SET NULL,
  student_model_version_id uuid REFERENCES student_model_versions(id) ON DELETE SET NULL,
  priority_score numeric(5, 4) NOT NULL DEFAULT 0.5 CHECK (priority_score BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'started', 'completed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS model_update_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_event_id uuid NOT NULL REFERENCES learning_events(id) ON DELETE CASCADE,
  processor_name text NOT NULL CHECK (char_length(processor_name) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learning_event_id, processor_name)
);

CREATE INDEX IF NOT EXISTS courses_user_id_idx ON courses(user_id);
CREATE INDEX IF NOT EXISTS source_documents_course_id_idx ON source_documents(course_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS subject_model_versions_course_status_idx ON subject_model_versions(course_id, status, version_number DESC);
CREATE INDEX IF NOT EXISTS subject_knowledge_nodes_version_type_idx ON subject_knowledge_nodes(subject_model_version_id, node_type);
CREATE INDEX IF NOT EXISTS subject_knowledge_edges_version_relationship_idx ON subject_knowledge_edges(subject_model_version_id, relationship_type);
CREATE INDEX IF NOT EXISTS subject_concept_sources_node_idx ON subject_concept_sources(subject_knowledge_node_id);
CREATE INDEX IF NOT EXISTS exam_sources_course_year_idx ON exam_sources(course_id, exam_year DESC);
CREATE INDEX IF NOT EXISTS exam_questions_source_idx ON exam_questions(exam_source_id);
CREATE INDEX IF NOT EXISTS learning_events_user_course_time_idx ON learning_events(user_id, course_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS learning_events_type_idx ON learning_events(course_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS learning_event_knowledge_links_node_idx ON learning_event_knowledge_links(subject_knowledge_node_id);
CREATE INDEX IF NOT EXISTS student_misconceptions_profile_status_idx ON student_misconceptions(profile_id, status, last_observed_at DESC);
CREATE INDEX IF NOT EXISTS adaptive_recommendations_profile_status_idx ON adaptive_recommendations(profile_id, status, priority_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS model_update_jobs_status_idx ON model_update_jobs(status, next_attempt_at);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_fragments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_knowledge_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_knowledge_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_concept_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_skill_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_learning_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_event_knowledge_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_topic_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_skill_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_misconceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervention_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE adaptive_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_update_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON courses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON academic_concepts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON source_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON source_fragments TO authenticated;
GRANT SELECT ON subject_model_versions TO authenticated;
GRANT SELECT ON subject_knowledge_nodes TO authenticated;
GRANT SELECT ON subject_knowledge_edges TO authenticated;
GRANT SELECT ON subject_concept_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON exam_sources TO authenticated;
GRANT SELECT ON exam_questions TO authenticated;
GRANT SELECT ON question_skill_mappings TO authenticated;
REVOKE UPDATE ON student_learning_profiles FROM authenticated;
GRANT SELECT ON student_learning_profiles TO authenticated;
GRANT UPDATE (preferred_language, confidence_level) ON student_learning_profiles TO authenticated;
GRANT SELECT ON learning_events TO authenticated;
GRANT SELECT ON learning_event_knowledge_links TO authenticated;
GRANT SELECT ON student_topic_mastery TO authenticated;
GRANT SELECT ON student_skill_mastery TO authenticated;
GRANT SELECT ON student_misconceptions TO authenticated;
GRANT SELECT ON teaching_interventions TO authenticated;
GRANT SELECT ON intervention_outcomes TO authenticated;
GRANT SELECT ON student_model_versions TO authenticated;
REVOKE UPDATE ON adaptive_recommendations FROM authenticated;
GRANT SELECT ON adaptive_recommendations TO authenticated;
GRANT UPDATE (status) ON adaptive_recommendations TO authenticated;
GRANT SELECT ON model_update_jobs TO authenticated;

DROP POLICY IF EXISTS "courses_select_own" ON courses;
CREATE POLICY "courses_select_own" ON courses FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "courses_insert_own" ON courses;
CREATE POLICY "courses_insert_own" ON courses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "courses_update_own" ON courses;
CREATE POLICY "courses_update_own" ON courses FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "courses_delete_own" ON courses;
CREATE POLICY "courses_delete_own" ON courses FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "concepts_select_course_owner" ON academic_concepts;
CREATE POLICY "concepts_select_course_owner" ON academic_concepts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = academic_concepts.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "concepts_insert_course_owner" ON academic_concepts;
CREATE POLICY "concepts_insert_course_owner" ON academic_concepts FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM courses WHERE courses.id = academic_concepts.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "concepts_update_course_owner" ON academic_concepts;
CREATE POLICY "concepts_update_course_owner" ON academic_concepts FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = academic_concepts.course_id AND courses.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM courses WHERE courses.id = academic_concepts.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "concepts_delete_course_owner" ON academic_concepts;
CREATE POLICY "concepts_delete_course_owner" ON academic_concepts FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = academic_concepts.course_id AND courses.user_id = auth.uid()));

DROP POLICY IF EXISTS "source_documents_select_course_owner" ON source_documents;
CREATE POLICY "source_documents_select_course_owner" ON source_documents FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "source_documents_insert_course_owner" ON source_documents;
CREATE POLICY "source_documents_insert_course_owner" ON source_documents FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "source_documents_update_course_owner" ON source_documents;
CREATE POLICY "source_documents_update_course_owner" ON source_documents FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "source_documents_delete_course_owner" ON source_documents;
CREATE POLICY "source_documents_delete_course_owner" ON source_documents FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid()));

DROP POLICY IF EXISTS "source_fragments_select_course_owner" ON source_fragments;
CREATE POLICY "source_fragments_select_course_owner" ON source_fragments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM source_documents WHERE source_documents.id = source_fragments.document_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid())));
DROP POLICY IF EXISTS "source_fragments_insert_course_owner" ON source_fragments;
CREATE POLICY "source_fragments_insert_course_owner" ON source_fragments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM source_documents WHERE source_documents.id = source_fragments.document_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid())));
DROP POLICY IF EXISTS "source_fragments_update_course_owner" ON source_fragments;
CREATE POLICY "source_fragments_update_course_owner" ON source_fragments FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM source_documents WHERE source_documents.id = source_fragments.document_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM source_documents WHERE source_documents.id = source_fragments.document_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid())));
DROP POLICY IF EXISTS "source_fragments_delete_course_owner" ON source_fragments;
CREATE POLICY "source_fragments_delete_course_owner" ON source_fragments FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM source_documents WHERE source_documents.id = source_fragments.document_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = source_documents.course_id AND courses.user_id = auth.uid())));

DROP POLICY IF EXISTS "subject_versions_course_owner" ON subject_model_versions;
CREATE POLICY "subject_versions_course_owner" ON subject_model_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = subject_model_versions.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "subject_nodes_course_owner" ON subject_knowledge_nodes;
CREATE POLICY "subject_nodes_course_owner" ON subject_knowledge_nodes FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM subject_model_versions WHERE subject_model_versions.id = subject_knowledge_nodes.subject_model_version_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = subject_model_versions.course_id AND courses.user_id = auth.uid())));
DROP POLICY IF EXISTS "subject_edges_course_owner" ON subject_knowledge_edges;
CREATE POLICY "subject_edges_course_owner" ON subject_knowledge_edges FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM subject_model_versions WHERE subject_model_versions.id = subject_knowledge_edges.subject_model_version_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = subject_model_versions.course_id AND courses.user_id = auth.uid())));
DROP POLICY IF EXISTS "subject_sources_course_owner" ON subject_concept_sources;
CREATE POLICY "subject_sources_course_owner" ON subject_concept_sources FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM subject_knowledge_nodes WHERE subject_knowledge_nodes.id = subject_concept_sources.subject_knowledge_node_id AND EXISTS (SELECT 1 FROM subject_model_versions WHERE subject_model_versions.id = subject_knowledge_nodes.subject_model_version_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = subject_model_versions.course_id AND courses.user_id = auth.uid()))));

DROP POLICY IF EXISTS "exam_sources_select_course_owner" ON exam_sources;
CREATE POLICY "exam_sources_select_course_owner" ON exam_sources FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = exam_sources.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "exam_sources_insert_course_owner" ON exam_sources;
CREATE POLICY "exam_sources_insert_course_owner" ON exam_sources FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM courses WHERE courses.id = exam_sources.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "exam_sources_update_course_owner" ON exam_sources;
CREATE POLICY "exam_sources_update_course_owner" ON exam_sources FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = exam_sources.course_id AND courses.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM courses WHERE courses.id = exam_sources.course_id AND courses.user_id = auth.uid()));
DROP POLICY IF EXISTS "exam_sources_delete_course_owner" ON exam_sources;
CREATE POLICY "exam_sources_delete_course_owner" ON exam_sources FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM courses WHERE courses.id = exam_sources.course_id AND courses.user_id = auth.uid()));

DROP POLICY IF EXISTS "exam_questions_select_course_owner" ON exam_questions;
CREATE POLICY "exam_questions_select_course_owner" ON exam_questions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM exam_sources WHERE exam_sources.id = exam_questions.exam_source_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = exam_sources.course_id AND courses.user_id = auth.uid())));
DROP POLICY IF EXISTS "question_mappings_select_course_owner" ON question_skill_mappings;
CREATE POLICY "question_mappings_select_course_owner" ON question_skill_mappings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM exam_questions WHERE exam_questions.id = question_skill_mappings.exam_question_id AND EXISTS (SELECT 1 FROM exam_sources WHERE exam_sources.id = exam_questions.exam_source_id AND EXISTS (SELECT 1 FROM courses WHERE courses.id = exam_sources.course_id AND courses.user_id = auth.uid()))));

DROP POLICY IF EXISTS "profiles_select_own" ON student_learning_profiles;
CREATE POLICY "profiles_select_own" ON student_learning_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "profiles_update_own_preferences" ON student_learning_profiles;
CREATE POLICY "profiles_update_own_preferences" ON student_learning_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "events_select_own" ON learning_events;
CREATE POLICY "events_select_own" ON learning_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "event_links_select_own" ON learning_event_knowledge_links;
CREATE POLICY "event_links_select_own" ON learning_event_knowledge_links FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM learning_events WHERE learning_events.id = learning_event_knowledge_links.learning_event_id AND learning_events.user_id = auth.uid()));
DROP POLICY IF EXISTS "topic_mastery_select_own" ON student_topic_mastery;
CREATE POLICY "topic_mastery_select_own" ON student_topic_mastery FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM student_learning_profiles WHERE student_learning_profiles.id = student_topic_mastery.profile_id AND student_learning_profiles.user_id = auth.uid()));
DROP POLICY IF EXISTS "skill_mastery_select_own" ON student_skill_mastery;
CREATE POLICY "skill_mastery_select_own" ON student_skill_mastery FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM student_learning_profiles WHERE student_learning_profiles.id = student_skill_mastery.profile_id AND student_learning_profiles.user_id = auth.uid()));
DROP POLICY IF EXISTS "misconceptions_select_own" ON student_misconceptions;
CREATE POLICY "misconceptions_select_own" ON student_misconceptions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM student_learning_profiles WHERE student_learning_profiles.id = student_misconceptions.profile_id AND student_learning_profiles.user_id = auth.uid()));
DROP POLICY IF EXISTS "interventions_select_own" ON teaching_interventions;
CREATE POLICY "interventions_select_own" ON teaching_interventions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM student_learning_profiles WHERE student_learning_profiles.id = teaching_interventions.profile_id AND student_learning_profiles.user_id = auth.uid()));
DROP POLICY IF EXISTS "outcomes_select_own" ON intervention_outcomes;
CREATE POLICY "outcomes_select_own" ON intervention_outcomes FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM teaching_interventions JOIN student_learning_profiles ON student_learning_profiles.id = teaching_interventions.profile_id WHERE teaching_interventions.id = intervention_outcomes.intervention_id AND student_learning_profiles.user_id = auth.uid()));
DROP POLICY IF EXISTS "model_versions_select_own" ON student_model_versions;
CREATE POLICY "model_versions_select_own" ON student_model_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM student_learning_profiles WHERE student_learning_profiles.id = student_model_versions.profile_id AND student_learning_profiles.user_id = auth.uid()));
DROP POLICY IF EXISTS "recommendations_select_own" ON adaptive_recommendations;
CREATE POLICY "recommendations_select_own" ON adaptive_recommendations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM student_learning_profiles WHERE student_learning_profiles.id = adaptive_recommendations.profile_id AND student_learning_profiles.user_id = auth.uid()));
DROP POLICY IF EXISTS "recommendations_update_own" ON adaptive_recommendations;
CREATE POLICY "recommendations_update_own" ON adaptive_recommendations FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM student_learning_profiles WHERE student_learning_profiles.id = adaptive_recommendations.profile_id AND student_learning_profiles.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM student_learning_profiles WHERE student_learning_profiles.id = adaptive_recommendations.profile_id AND student_learning_profiles.user_id = auth.uid()));
DROP POLICY IF EXISTS "jobs_select_own" ON model_update_jobs;
CREATE POLICY "jobs_select_own" ON model_update_jobs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM learning_events WHERE learning_events.id = model_update_jobs.learning_event_id AND learning_events.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION ensure_student_profile(p_course_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM courses WHERE id = p_course_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  INSERT INTO student_learning_profiles (user_id, course_id)
  VALUES (auth.uid(), p_course_id)
  ON CONFLICT (user_id, course_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_profile_id;

  RETURN v_profile_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION ensure_student_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ensure_student_profile(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION record_learning_event(
  p_course_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_idempotency_key text,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM courses WHERE id = p_course_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  INSERT INTO learning_events (user_id, course_id, event_type, payload, idempotency_key, occurred_at)
  VALUES (auth.uid(), p_course_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), p_idempotency_key, COALESCE(p_occurred_at, now()))
  ON CONFLICT (user_id, course_id, idempotency_key) DO UPDATE SET id = learning_events.id
  RETURNING id INTO v_event_id;

  INSERT INTO model_update_jobs (learning_event_id, processor_name)
  VALUES
    (v_event_id, 'student_evidence'),
    (v_event_id, 'recommendation_refresh')
  ON CONFLICT (learning_event_id, processor_name) DO NOTHING;

  RETURN v_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_learning_event(uuid, text, jsonb, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_learning_event(uuid, text, jsonb, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION delete_my_learning_history(p_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM courses WHERE id = p_course_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  SELECT id INTO v_profile_id
  FROM student_learning_profiles
  WHERE user_id = auth.uid() AND course_id = p_course_id;

  DELETE FROM learning_events WHERE user_id = auth.uid() AND course_id = p_course_id;

  IF v_profile_id IS NOT NULL THEN
    DELETE FROM student_learning_profiles WHERE id = v_profile_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_my_learning_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_my_learning_history(uuid) TO authenticated;
