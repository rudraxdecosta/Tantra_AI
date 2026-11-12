/*
# Fix STUDY starter course creation

1. Purpose
- Make starter course seeding independent of multi-row `RETURNING` assignments.
- Keep the function safe when a user creates a new course after the intelligence foundation already exists.

2. Modified function
- `create_starter_course`: selects the generated concept and node identifiers explicitly after inserting their rows.

3. Security
- Preserve authenticated ownership validation and the existing restricted EXECUTE grant.
*/

CREATE OR REPLACE FUNCTION create_starter_course(
  p_title text,
  p_subject_label text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_profile_id uuid;
  v_version_id uuid;
  v_root_id uuid;
  v_foundations_id uuid;
  v_applications_id uuid;
  v_skill_node_id uuid;
  v_core_concept_id uuid;
  v_foundations_concept_id uuid;
  v_application_concept_id uuid;
  v_skill_concept_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF char_length(trim(p_title)) < 1 OR char_length(trim(p_title)) > 160 THEN
    RAISE EXCEPTION 'Course title is invalid';
  END IF;

  IF char_length(trim(p_subject_label)) < 1 OR char_length(trim(p_subject_label)) > 160 THEN
    RAISE EXCEPTION 'Subject label is invalid';
  END IF;

  INSERT INTO courses (user_id, title, subject_label)
  VALUES (auth.uid(), trim(p_title), trim(p_subject_label))
  RETURNING id INTO v_course_id;

  INSERT INTO student_learning_profiles (user_id, course_id)
  VALUES (auth.uid(), v_course_id)
  RETURNING id INTO v_profile_id;

  INSERT INTO subject_model_versions (course_id, version_number, status, change_summary, published_at)
  VALUES (v_course_id, 1, 'published', 'Starter subject map', now())
  RETURNING id INTO v_version_id;

  INSERT INTO academic_concepts (course_id, canonical_key, label, concept_type)
  VALUES
    (v_course_id, 'core-definitions', 'Core definitions', 'concept'),
    (v_course_id, 'foundations', 'Foundations', 'concept'),
    (v_course_id, 'applications', 'Applications', 'concept'),
    (v_course_id, 'independent-problem-solving', 'Independent problem solving', 'skill');

  SELECT id INTO v_core_concept_id FROM academic_concepts WHERE course_id = v_course_id AND canonical_key = 'core-definitions';
  SELECT id INTO v_foundations_concept_id FROM academic_concepts WHERE course_id = v_course_id AND canonical_key = 'foundations';
  SELECT id INTO v_application_concept_id FROM academic_concepts WHERE course_id = v_course_id AND canonical_key = 'applications';
  SELECT id INTO v_skill_concept_id FROM academic_concepts WHERE course_id = v_course_id AND canonical_key = 'independent-problem-solving';

  INSERT INTO subject_knowledge_nodes (subject_model_version_id, node_type, label, description, importance_score, difficulty_level)
  VALUES (v_version_id, 'subject', trim(p_subject_label), 'Your subject map starts here and grows as study material is processed.', 0.9, 'introductory')
  RETURNING id INTO v_root_id;

  INSERT INTO subject_knowledge_nodes (subject_model_version_id, academic_concept_id, parent_node_id, node_type, label, description, importance_score, difficulty_level)
  VALUES (v_version_id, v_core_concept_id, v_root_id, 'topic', 'Core definitions', 'Build a precise vocabulary before applying the ideas.', 0.85, 'introductory');

  INSERT INTO subject_knowledge_nodes (subject_model_version_id, academic_concept_id, parent_node_id, node_type, label, description, importance_score, difficulty_level)
  VALUES (v_version_id, v_foundations_concept_id, v_root_id, 'topic', 'Foundations', 'The prerequisite ideas that support later problem solving.', 0.9, 'developing')
  RETURNING id INTO v_foundations_id;

  INSERT INTO subject_knowledge_nodes (subject_model_version_id, academic_concept_id, parent_node_id, node_type, label, description, importance_score, difficulty_level)
  VALUES (v_version_id, v_application_concept_id, v_root_id, 'topic', 'Applications', 'Use the subject rules in guided and independent questions.', 0.8, 'intermediate')
  RETURNING id INTO v_applications_id;

  INSERT INTO subject_knowledge_nodes (subject_model_version_id, academic_concept_id, parent_node_id, node_type, label, description, importance_score, difficulty_level)
  VALUES (v_version_id, v_skill_concept_id, v_applications_id, 'skill', 'Independent problem solving', 'Solve without hints, then review the evidence.', 0.9, 'intermediate')
  RETURNING id INTO v_skill_node_id;

  INSERT INTO subject_knowledge_edges (subject_model_version_id, from_node_id, to_node_id, relationship_type, confidence, source_basis)
  VALUES
    (v_version_id, v_root_id, v_foundations_id, 'contains', 1, 'Starter subject map'),
    (v_version_id, v_root_id, v_applications_id, 'contains', 1, 'Starter subject map'),
    (v_version_id, v_foundations_id, v_applications_id, 'prerequisite', 0.75, 'Starter subject map');

  INSERT INTO adaptive_recommendations (profile_id, course_id, subject_knowledge_node_id, recommendation_type, title, rationale, subject_model_version_id, priority_score)
  VALUES (
    v_profile_id,
    v_course_id,
    v_foundations_id,
    'next_lesson',
    'Build your foundations',
    'Start with prerequisite ideas so later application questions have a stronger base. This is an early recommendation and will become more specific after your first practice responses.',
    v_version_id,
    0.88
  );

  RETURN v_course_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_starter_course(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_starter_course(text, text) TO authenticated;
