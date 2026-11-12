/*
# Reset STUDY authenticated grants

1. Purpose
- Remove inherited authenticated privileges from computed intelligence tables.
- Reapply only the minimum browser permissions required by the current product flow.

2. Modified access
- User-owned course and source tables retain authenticated CRUD access under their row policies.
- Subject models, learning events, event links, mastery, misconceptions, interventions, model versions, recommendations, and jobs are read-only from the browser except for recommendation status and profile preferences.
- All computed writes continue through authenticated, ownership-checking functions.

3. Security
- Anonymous and public access remains revoked.
- Existing row-level security policies remain unchanged.
*/

REVOKE ALL ON courses, academic_concepts, source_documents, source_fragments, subject_model_versions, subject_knowledge_nodes, subject_knowledge_edges, subject_concept_sources, exam_sources, exam_questions, question_skill_mappings, student_learning_profiles, learning_events, learning_event_knowledge_links, student_topic_mastery, student_skill_mastery, student_misconceptions, teaching_interventions, intervention_outcomes, student_model_versions, adaptive_recommendations, model_update_jobs FROM authenticated;

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
