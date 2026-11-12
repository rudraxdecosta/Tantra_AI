import { requireSupabase } from '@/lib/supabase';

export interface Course {
  id: string;
  title: string;
  subject_label: string;
  learning_mode: 'material_only' | 'prompt_only' | 'material_plus_prompt';
}

export interface SubjectNode {
  id: string;
  label: string;
  node_type: string;
  description: string | null;
  importance_score: number | null;
  difficulty_level: string | null;
}

export interface SkillMastery {
  id: string;
  subject_knowledge_node_id: string;
  mastery_estimate: number;
  confidence_estimate: number;
  evidence_count: number;
  correct_attempts: number;
  incorrect_attempts: number;
  hint_usage: number;
  independent_attempts: number;
  recent_trend: 'improving' | 'steady' | 'declining' | 'not_enough_evidence';
  next_practice_at: string | null;
}

export interface Recommendation {
  id: string;
  subject_knowledge_node_id: string | null;
  recommendation_type: string;
  title: string;
  rationale: string;
  priority_score: number;
  status: 'active' | 'started' | 'completed' | 'dismissed';
}

export interface Misconception {
  id: string;
  subject_knowledge_node_id: string;
  observed_mistake: string;
  supporting_attempts: number;
  diagnosis_confidence: number;
  status: 'active' | 'improving' | 'resolved';
}

export interface StudentProfile {
  id: string;
  preferred_language: string;
  confidence_level: 'uncertain' | 'developing' | 'confident';
}

export interface CourseData {
  course: Course;
  profile: StudentProfile;
  nodes: SubjectNode[];
  mastery: SkillMastery[];
  recommendations: Recommendation[];
  misconceptions: Misconception[];
}

async function read<T>(request: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await request;
  if (error) {
    throw new Error('Study data could not be loaded.');
  }
  return data as T;
}

export async function getCourses(): Promise<Course[]> {
  const client = requireSupabase();
  return read(
    client
      .from('courses')
      .select('id, title, subject_label, learning_mode')
      .order('updated_at', { ascending: false }),
  );
}

export async function createStarterCourse(title: string, subjectLabel: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_starter_course', {
    p_title: title,
    p_subject_label: subjectLabel,
  });

  if (error || !data) {
    throw new Error('Your study space could not be created.');
  }

  return data as string;
}

export async function loadCourseData(course: Course): Promise<CourseData> {
  const client = requireSupabase();
  const { data: profileId, error: profileError } = await client.rpc('ensure_student_profile', {
    p_course_id: course.id,
  });

  if (profileError || !profileId) {
    throw new Error('Your learner profile could not be loaded.');
  }

  const publishedVersion = await read<{ id: string } | null>(
    client
      .from('subject_model_versions')
      .select('id')
      .eq('course_id', course.id)
      .eq('status', 'published')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

  const [profileResult, nodeResult, masteryResult, recommendationResult, misconceptionResult] = await Promise.all([
    client
      .from('student_learning_profiles')
      .select('id, preferred_language, confidence_level')
      .eq('id', profileId)
      .maybeSingle(),
    client
      .from('subject_knowledge_nodes')
      .select('id, label, node_type, description, importance_score, difficulty_level')
      .eq('subject_model_version_id', publishedVersion?.id ?? '')
      .order('node_type', { ascending: true }),
    client
      .from('student_skill_mastery')
      .select('id, subject_knowledge_node_id, mastery_estimate, confidence_estimate, evidence_count, correct_attempts, incorrect_attempts, hint_usage, independent_attempts, recent_trend, next_practice_at')
      .eq('profile_id', profileId)
      .order('updated_at', { ascending: false }),
    client
      .from('adaptive_recommendations')
      .select('id, subject_knowledge_node_id, recommendation_type, title, rationale, priority_score, status')
      .eq('profile_id', profileId)
      .eq('status', 'active')
      .order('priority_score', { ascending: false }),
    client
      .from('student_misconceptions')
      .select('id, subject_knowledge_node_id, observed_mistake, supporting_attempts, diagnosis_confidence, status')
      .eq('profile_id', profileId)
      .eq('status', 'active')
      .order('supporting_attempts', { ascending: false }),
  ]);

  if (profileResult.error || nodeResult.error || masteryResult.error || recommendationResult.error || misconceptionResult.error || !profileResult.data) {
    throw new Error('Your study intelligence could not be loaded.');
  }

  return {
    course,
    profile: profileResult.data as StudentProfile,
    nodes: (nodeResult.data ?? []) as SubjectNode[],
    mastery: (masteryResult.data ?? []) as SkillMastery[],
    recommendations: (recommendationResult.data ?? []) as Recommendation[],
    misconceptions: (misconceptionResult.data ?? []) as Misconception[],
  };
}

export async function recordPractice(
  courseId: string,
  nodeId: string,
  result: { isCorrect: boolean; hintUsed: boolean; independent: boolean },
): Promise<void> {
  const client = requireSupabase();
  const idempotencyKey = `practice-${crypto.randomUUID()}`;
  const { data: eventId, error: eventError } = await client.rpc('record_learning_event', {
    p_course_id: courseId,
    p_event_type: 'answer_submitted',
    p_payload: {
      knowledge_node_id: nodeId,
      is_correct: result.isCorrect,
      hint_used: result.hintUsed,
      independent: result.independent,
    },
    p_idempotency_key: idempotencyKey,
  });

  if (eventError || !eventId) {
    throw new Error('This learning response could not be recorded.');
  }

  const { error: processingError } = await client.rpc('process_learning_event', {
    p_event_id: eventId,
  });

  if (processingError) {
    throw new Error('Your response was saved, but the learner model is still updating.');
  }
}

export async function updateProfilePreferences(
  profileId: string,
  preferences: { preferredLanguage: string; confidenceLevel: StudentProfile['confidence_level'] },
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('student_learning_profiles')
    .update({
      preferred_language: preferences.preferredLanguage,
      confidence_level: preferences.confidenceLevel,
    })
    .eq('id', profileId);

  if (error) {
    throw new Error('Your learner preferences could not be saved.');
  }
}

export async function deleteLearningHistory(courseId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('delete_my_learning_history', {
    p_course_id: courseId,
  });

  if (error) {
    throw new Error('Your learning history could not be deleted.');
  }
}
