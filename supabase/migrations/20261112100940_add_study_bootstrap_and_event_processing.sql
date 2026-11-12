/*
# Add STUDY bootstrap and event processing

1. Purpose
- Give a new student a complete first course without requiring manual database setup.
- Seed a small subject structure that can later be replaced by uploaded material.
- Process explicit practice evidence immediately for the MVP while retaining queued jobs for heavier future processors.

2. New functions
- `create_starter_course`: creates an owned course, profile, versioned subject map, concepts, prerequisite links, and first recommendation.
- `process_learning_event`: validates an event, updates skill mastery from explicit evidence, and marks the simple student processor complete.

3. Security
- Both functions require an authenticated session and verify course ownership.
- Computed student records are updated only inside server-enforced functions.
- Anonymous callers cannot execute either function.

4. Processing notes
- The initial mastery estimate is a transparent smoothed evidence ratio, bounded away from false certainty.
- Independent work receives more weight in the recommendation context, while hints remain visible as separate evidence.
- Repeated calls for the same event are safe because completed processing is detected before updating.
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
  v_skill_id uuid;
  v_core_concept_id uuid;
  v_foundations_concept_id uuid;
  v_application_concept_id uuid;
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
    (v_course_id, 'independent-problem-solving', 'Independent problem solving', 'skill')
  RETURNING id INTO v_application_concept_id;

  SELECT id INTO v_core_concept_id FROM academic_concepts WHERE course_id = v_course_id AND canonical_key = 'core-definitions';
  SELECT id INTO v_foundations_concept_id FROM academic_concepts WHERE course_id = v_course_id AND canonical_key = 'foundations';
  SELECT id INTO v_application_concept_id FROM academic_concepts WHERE course_id = v_course_id AND canonical_key = 'applications';
  SELECT id INTO v_skill_id FROM academic_concepts WHERE course_id = v_course_id AND canonical_key = 'independent-problem-solving';

  INSERT INTO subject_knowledge_nodes (subject_model_version_id, academic_concept_id, node_type, label, description, importance_score, difficulty_level)
  VALUES (v_version_id, NULL, 'subject', trim(p_subject_label), 'Your subject map starts here and grows as study material is processed.', 0.9, 'introductory')
  RETURNING id INTO v_root_id;

  INSERT INTO subject_knowledge_nodes (subject_model_version_id, academic_concept_id, parent_node_id, node_type, label, description, importance_score, difficulty_level)
  VALUES
    (v_version_id, v_core_concept_id, v_root_id, 'topic', 'Core definitions', 'Build a precise vocabulary before applying the ideas.', 0.85, 'introductory'),
    (v_version_id, v_foundations_concept_id, v_root_id, 'topic', 'Foundations', 'The prerequisite ideas that support later problem solving.', 0.9, 'developing'),
    (v_version_id, v_application_concept_id, v_root_id, 'topic', 'Applications', 'Use the subject rules in guided and independent questions.', 0.8, 'intermediate')
  RETURNING id INTO v_applications_id;

  SELECT id INTO v_foundations_id FROM subject_knowledge_nodes WHERE subject_model_version_id = v_version_id AND label = 'Foundations';
  SELECT id INTO v_applications_id FROM subject_knowledge_nodes WHERE subject_model_version_id = v_version_id AND label = 'Applications';

  INSERT INTO subject_knowledge_nodes (subject_model_version_id, academic_concept_id, parent_node_id, node_type, label, description, importance_score, difficulty_level)
  VALUES (v_version_id, v_skill_id, v_applications_id, 'skill', 'Independent problem solving', 'Solve without hints, then review the evidence.', 0.9, 'intermediate')
  RETURNING id INTO v_skill_id;

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

CREATE OR REPLACE FUNCTION process_learning_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event learning_events%ROWTYPE;
  v_profile_id uuid;
  v_node_id uuid;
  v_is_correct boolean;
  v_hint_used boolean;
  v_independent boolean;
  v_evidence_count integer;
  v_correct_attempts integer;
  v_incorrect_attempts integer;
  v_hint_usage integer;
  v_independent_attempts integer;
  v_mastery numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_event
  FROM learning_events
  WHERE id = p_event_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning event not found';
  END IF;

  IF EXISTS (SELECT 1 FROM model_update_jobs WHERE learning_event_id = p_event_id AND processor_name = 'student_evidence' AND status = 'completed') THEN
    RETURN;
  END IF;

  SELECT id INTO v_profile_id
  FROM student_learning_profiles
  WHERE user_id = auth.uid() AND course_id = v_event.course_id;

  IF v_profile_id IS NULL THEN
    INSERT INTO student_learning_profiles (user_id, course_id)
    VALUES (auth.uid(), v_event.course_id)
    RETURNING id INTO v_profile_id;
  END IF;

  IF NOT ((v_event.payload->>'knowledge_node_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
    UPDATE model_update_jobs
    SET status = 'completed', completed_at = now(), attempt_count = attempt_count + 1
    WHERE learning_event_id = p_event_id AND processor_name = 'student_evidence';
    RETURN;
  END IF;

  v_node_id := (v_event.payload->>'knowledge_node_id')::uuid;

  IF NOT EXISTS (
    SELECT 1
    FROM subject_knowledge_nodes n
    JOIN subject_model_versions v ON v.id = n.subject_model_version_id
    WHERE n.id = v_node_id AND v.course_id = v_event.course_id
  ) THEN
    RAISE EXCEPTION 'Learning concept not found';
  END IF;

  v_is_correct := COALESCE((v_event.payload->>'is_correct')::boolean, false);
  v_hint_used := COALESCE((v_event.payload->>'hint_used')::boolean, false);
  v_independent := COALESCE((v_event.payload->>'independent')::boolean, false);

  SELECT evidence_count, correct_attempts, incorrect_attempts, hint_usage, independent_attempts
  INTO v_evidence_count, v_correct_attempts, v_incorrect_attempts, v_hint_usage, v_independent_attempts
  FROM student_skill_mastery
  WHERE profile_id = v_profile_id AND subject_knowledge_node_id = v_node_id;

  v_evidence_count := COALESCE(v_evidence_count, 0) + 1;
  v_correct_attempts := COALESCE(v_correct_attempts, 0) + CASE WHEN v_is_correct THEN 1 ELSE 0 END;
  v_incorrect_attempts := COALESCE(v_incorrect_attempts, 0) + CASE WHEN v_is_correct THEN 0 ELSE 1 END;
  v_hint_usage := COALESCE(v_hint_usage, 0) + CASE WHEN v_hint_used THEN 1 ELSE 0 END;
  v_independent_attempts := COALESCE(v_independent_attempts, 0) + CASE WHEN v_independent THEN 1 ELSE 0 END;
  v_mastery := LEAST(0.95, GREATEST(0.05, (v_correct_attempts + 1)::numeric / (v_evidence_count + 2)::numeric));

  INSERT INTO student_skill_mastery (profile_id, subject_knowledge_node_id, mastery_estimate, confidence_estimate, evidence_count, correct_attempts, incorrect_attempts, hint_usage, independent_attempts, last_demonstrated_at, recent_trend, updated_at)
  VALUES (v_profile_id, v_node_id, v_mastery, LEAST(0.95, v_evidence_count::numeric / 8), v_evidence_count, v_correct_attempts, v_incorrect_attempts, v_hint_usage, v_independent_attempts, v_event.occurred_at, CASE WHEN v_evidence_count < 3 THEN 'not_enough_evidence' WHEN v_is_correct THEN 'improving' ELSE 'declining' END, now())
  ON CONFLICT (profile_id, subject_knowledge_node_id) DO UPDATE SET
    mastery_estimate = EXCLUDED.mastery_estimate,
    confidence_estimate = EXCLUDED.confidence_estimate,
    evidence_count = EXCLUDED.evidence_count,
    correct_attempts = EXCLUDED.correct_attempts,
    incorrect_attempts = EXCLUDED.incorrect_attempts,
    hint_usage = EXCLUDED.hint_usage,
    independent_attempts = EXCLUDED.independent_attempts,
    last_demonstrated_at = EXCLUDED.last_demonstrated_at,
    recent_trend = EXCLUDED.recent_trend,
    updated_at = now();

  UPDATE model_update_jobs
  SET status = 'completed', completed_at = now(), attempt_count = attempt_count + 1
  WHERE learning_event_id = p_event_id AND processor_name = 'student_evidence';
END;
$$;

REVOKE EXECUTE ON FUNCTION process_learning_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION process_learning_event(uuid) TO authenticated;
