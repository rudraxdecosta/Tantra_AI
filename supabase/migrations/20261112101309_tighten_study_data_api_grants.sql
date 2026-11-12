/*
# Tighten STUDY data API privileges

1. Purpose
- Remove inherited anonymous and public privileges from all STUDY intelligence tables.
- Ensure browser writes are limited to intentional user-owned content and preference fields.
- Keep computed learning evidence and model records server-managed.

2. Modified tables
- All 22 STUDY tables now explicitly revoke `PUBLIC` and `anon` access.
- Course, source-document, source-fragment, academic-concept, and exam-source editing remains available only to authenticated course owners through row policies.
- Subject models, learning events, mastery, misconceptions, interventions, model versions, jobs, and mappings are read-only to authenticated users.
- Student profile updates are limited to preferred language and confidence level.
- Recommendation updates are limited to status.

3. Security
- These grants complement the existing row-level security policies.
- No anonymous role can read or write private learning data.
*/

REVOKE ALL ON courses, academic_concepts, source_documents, source_fragments, subject_model_versions, subject_knowledge_nodes, subject_knowledge_edges, subject_concept_sources, exam_sources, exam_questions, question_skill_mappings, student_learning_profiles, learning_events, learning_event_knowledge_links, student_topic_mastery, student_skill_mastery, student_misconceptions, teaching_interventions, intervention_outcomes, student_model_versions, adaptive_recommendations, model_update_jobs FROM PUBLIC, anon;

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
GRANT SELECT ON adaptive_recommendations TO authenticated;
GRANT UPDATE (status) ON adaptive_recommendations TO authenticated;
GRANT SELECT ON model_update_jobs TO authenticated;
