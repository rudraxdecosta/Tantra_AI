import { useMemo, useState } from 'react';
import { Activity, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Gauge, Layers3, LogOut, Network, RefreshCw, ShieldCheck, Sparkles, Target, Trash2, X } from 'lucide-react';
import { deleteLearningHistory, recordPractice, type CourseData, type SkillMastery, type SubjectNode } from '@/lib/study';

interface StudyDashboardProps {
  data: CourseData;
  userEmail: string;
  isAdmin: boolean;
  onBackToChat: () => void;
  onOpenAdminPortal: () => void;
  onSignOut: () => Promise<void>;
  onReload: () => Promise<void>;
  onHistoryDeleted: () => Promise<void>;
  onBlocked: () => void;
}

function masteryForNode(mastery: SkillMastery[], nodeId: string): SkillMastery | undefined {
  return mastery.find((item) => item.subject_knowledge_node_id === nodeId);
}

function evidenceLabel(item: SkillMastery | undefined): string {
  if (!item || item.evidence_count === 0) return 'Awaiting evidence';
  if (item.evidence_count < 3) return 'Early signal';
  if (item.mastery_estimate >= 0.75 && item.confidence_estimate >= 0.5) return 'Evidence-backed';
  return 'Still developing';
}

function topicStatus(item: SkillMastery | undefined): 'understood' | 'developing' | 'waiting' {
  if (!item || item.evidence_count === 0) return 'waiting';
  if (item.mastery_estimate >= 0.75 && item.confidence_estimate >= 0.5) return 'understood';
  return 'developing';
}

function formatMode(mode: CourseData['course']['learning_mode']): string {
  if (mode === 'material_only') return 'Material only';
  if (mode === 'prompt_only') return 'Prompt only';
  return 'Material + prompt';
}

export default function StudyDashboard({ data, userEmail, isAdmin, onBackToChat, onOpenAdminPortal, onSignOut, onReload, onHistoryDeleted, onBlocked }: StudyDashboardProps) {
  const [activeView, setActiveView] = useState<'overview' | 'map' | 'evidence'>('overview');
  const [practiceNode, setPracticeNode] = useState<SubjectNode | null>(null);
  const [practiceResult, setPracticeResult] = useState<'correct' | 'unsure' | 'incorrect' | null>(null);
  const [hintUsed, setHintUsed] = useState(false);
  const [isSavingPractice, setIsSavingPractice] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [message, setMessage] = useState('');

  const topicNodes = useMemo(() => data.nodes.filter((node) => node.node_type === 'topic' || node.node_type === 'skill'), [data.nodes]);
  const evidenceCount = data.mastery.reduce((sum, item) => sum + item.evidence_count, 0);
  const independentAttempts = data.mastery.reduce((sum, item) => sum + item.independent_attempts, 0);
  const understoodCount = topicNodes.filter((node) => topicStatus(masteryForNode(data.mastery, node.id) ?? undefined) === 'understood').length;
  const activeRecommendation = data.recommendations[0];
  const recommendationNode = activeRecommendation ? data.nodes.find((node) => node.id === activeRecommendation.subject_knowledge_node_id) : null;

  async function refresh(): Promise<void> {
    setIsRefreshing(true);
    setMessage('');
    try {
      await onReload();
      setMessage('Your learner model is up to date.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The model could not be refreshed.');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function submitPractice(): Promise<void> {
    if (!practiceNode || !practiceResult) return;
    setIsSavingPractice(true);
    setMessage('');
    try {
      await recordPractice(data.course.id, practiceNode.id, {
        isCorrect: practiceResult === 'correct',
        hintUsed,
        independent: practiceResult !== 'unsure' && !hintUsed,
      });
      setPracticeNode(null);
      setPracticeResult(null);
      setHintUsed(false);
      await onReload();
      setMessage('Practice evidence added to your learner model.');
    } catch (error) {
      if (error instanceof Error && error.message === 'Account access blocked') {
        onBlocked();
        return;
      }
      setMessage(error instanceof Error ? error.message : 'This practice response could not be saved.');
    } finally {
      setIsSavingPractice(false);
    }
  }

  async function removeHistory(): Promise<void> {
    setIsDeleting(true);
    try {
      await deleteLearningHistory(data.course.id);
      setShowDeleteConfirm(false);
      await onHistoryDeleted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Your learning history could not be deleted.');
      setIsDeleting(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark"><BookOpen size={18} strokeWidth={2.5} /></div><span>Tantra</span></div>
        <div className="sidebar-course"><span className="course-kicker">Current course</span><strong>{data.course.title}</strong><span>{data.course.subject_label}</span></div>
        <nav className="side-nav" aria-label="Study sections">
          <button className="nav-item" onClick={onBackToChat}><BookOpen size={17} />Ask your teacher</button>
          <button className={activeView === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('overview')}><Gauge size={17} />Overview</button>
          <button className={activeView === 'map' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('map')}><Network size={17} />Knowledge map</button>
          <button className={activeView === 'evidence' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('evidence')}><Activity size={17} />Learning evidence</button>
        </nav>
        <div className="sidebar-bottom">
          {isAdmin && <button className="nav-item admin-link" onClick={onOpenAdminPortal}><ShieldCheck size={17} />Admin portal</button>}
          <div className="privacy-chip"><ShieldCheck size={15} /><span>Private workspace</span></div>
          <button className="nav-item" onClick={() => setShowDeleteConfirm(true)}><Trash2 size={17} />Delete history</button>
          <button className="nav-item" onClick={() => void onSignOut()}><LogOut size={17} />Sign out</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="mobile-brand"><div className="brand-mark"><BookOpen size={17} /></div><span>Tantra</span></div><div className="topbar-context"><span>{userEmail}</span><span className="topbar-dot" /><span>{formatMode(data.course.learning_mode)}</span></div><button className="refresh-button" onClick={() => void refresh()} disabled={isRefreshing} aria-label="Refresh learning model"><RefreshCw size={17} className={isRefreshing ? 'spin' : ''} /></button></header>

        <div className="content-wrap">
          {message && <div className="toast" role="status"><Check size={15} />{message}<button onClick={() => setMessage('')} aria-label="Dismiss message"><X size={14} /></button></div>}
          {activeView === 'overview' && (
            <>
              <section className="page-intro animate-in"><div><p className="eyebrow">{data.course.subject_label} / Learner intelligence</p><h1>Your next useful step.</h1><p className="intro-copy">A clear view of what your evidence says now, what is still uncertain, and where the teaching engine recommends you go next.</p></div><div className="model-status"><span className="status-pulse" />Model active<span>·</span><span>Evidence-led</span></div></section>
              <section className="stat-grid animate-in delay-1">
                <div className="stat-card"><div className="stat-icon"><Layers3 size={17} /></div><span className="stat-label">Topics with evidence</span><strong>{data.mastery.length || '—'}</strong><small>{data.mastery.length ? 'Learning signals recorded' : 'Your first response starts the map'}</small></div>
                <div className="stat-card"><div className="stat-icon"><Target size={17} /></div><span className="stat-label">Topics understood</span><strong>{understoodCount || '—'}</strong><small>{understoodCount ? 'Supported by repeated evidence' : 'Mastery is never assumed early'}</small></div>
                <div className="stat-card"><div className="stat-icon"><ArrowUpRight size={17} /></div><span className="stat-label">Independent attempts</span><strong>{independentAttempts || '—'}</strong><small>{independentAttempts ? 'Useful for confidence estimates' : 'Independent work is tracked separately'}</small></div>
              </section>
              <section className="dashboard-grid animate-in delay-2">
                <div className="recommendation-card"><div className="card-topline"><span className="dark-label"><Sparkles size={14} />Recommended next</span><span className="confidence-note">Priority {activeRecommendation ? Math.round(activeRecommendation.priority_score * 100) : '—'}</span></div><div className="recommendation-body"><div><p className="eyebrow">Adaptive teaching engine</p><h2>{activeRecommendation?.title ?? 'Complete one practice response'}</h2><p>{activeRecommendation?.rationale ?? 'The engine is waiting for your first explicit learning signal before it makes a more specific recommendation.'}</p></div><div className="recommendation-action"><span className="reason-label"><CircleHelp size={15} />Why this?</span><button className="button button-light" onClick={() => { const node = recommendationNode ?? topicNodes[0]; if (node) setPracticeNode(node); }}>{recommendationNode ? 'Begin lesson' : 'Choose a topic'}<ChevronRight size={16} /></button></div></div></div>
                <div className="focus-card"><div className="card-topline"><span className="eyebrow">Model note</span><Clock3 size={16} /></div><h3>Uncertainty is useful.</h3><p>Early estimates stay visible as early estimates. Time passing alone will not lower your mastery; revision is recommended when new evidence suggests it.</p><div className="thin-rule" /><span className="focus-foot">{evidenceCount ? `${evidenceCount} evidence signal${evidenceCount === 1 ? '' : 's'} in this course` : 'No evidence signals yet'}</span></div>
              </section>
              <section className="section-block animate-in delay-3"><div className="section-heading"><div><p className="eyebrow">Subject intelligence</p><h2>Knowledge map</h2></div><button className="text-button" onClick={() => setActiveView('map')}>View full map <ArrowUpRight size={15} /></button></div><div className="knowledge-list">{topicNodes.slice(0, 4).map((node) => <KnowledgeRow key={node.id} node={node} mastery={masteryForNode(data.mastery, node.id)} onPractice={() => setPracticeNode(node)} />)}</div></section>
              <section className="dashboard-grid lower-grid animate-in delay-3"><div className="insight-card"><div className="section-heading compact"><div><p className="eyebrow">Student intelligence</p><h2>Repeated difficulties</h2></div><span className="count-badge">{data.misconceptions.length}</span></div>{data.misconceptions.length ? data.misconceptions.slice(0, 2).map((item) => <div className="misconception-row" key={item.id}><span className="misconception-mark">!</span><div><strong>{item.observed_mistake}</strong><small>{item.supporting_attempts} supporting attempt{item.supporting_attempts === 1 ? '' : 's'} · {Math.round(item.diagnosis_confidence * 100)}% diagnosis confidence</small></div></div>) : <div className="empty-insight"><CircleHelp size={18} /><p>Recurring misconceptions will appear after the system sees the same conceptual mistake more than once.</p></div>}</div><div className="insight-card"><div className="section-heading compact"><div><p className="eyebrow">Learning behaviour</p><h2>Current profile</h2></div><span className="profile-mark">{data.profile.confidence_level.slice(0, 1).toUpperCase()}</span></div><div className="profile-lines"><div><span>Preferred language</span><strong>{data.profile.preferred_language}</strong></div><div><span>Self-reported confidence</span><strong>{data.profile.confidence_level}</strong></div><div><span>Evidence standard</span><strong>Repeated attempts</strong></div></div></div></section>
            </>
          )}
          {activeView === 'map' && <KnowledgeMap data={data} onPractice={(node) => setPracticeNode(node)} />}
          {activeView === 'evidence' && <EvidenceView data={data} />}
        </div>
      </main>

      {practiceNode && <PracticeModal node={practiceNode} result={practiceResult} hintUsed={hintUsed} isSaving={isSavingPractice} onResult={setPracticeResult} onHint={() => setHintUsed((value) => !value)} onSubmit={() => void submitPractice()} onClose={() => { setPracticeNode(null); setPracticeResult(null); setHintUsed(false); }} />}
      {showDeleteConfirm && <div className="modal-backdrop"><div className="confirm-card"><div className="auth-icon"><Trash2 size={18} /></div><h2>Delete learning history?</h2><p>This removes your practice evidence, mastery estimates, misconceptions and recommendations for this course. Your course and academic map remain.</p><div className="confirm-actions"><button className="button button-light" onClick={() => setShowDeleteConfirm(false)}>Keep history</button><button className="button button-dark" onClick={() => void removeHistory()} disabled={isDeleting}>{isDeleting ? 'Deleting' : 'Delete history'}</button></div></div></div>}
    </div>
  );
}

function KnowledgeRow({ node, mastery, onPractice }: { node: SubjectNode; mastery?: SkillMastery; onPractice: () => void }) {
  const status = topicStatus(mastery);
  return <div className="knowledge-row"><div className={`node-glyph ${status}`}><span /></div><div className="knowledge-main"><div className="knowledge-title"><strong>{node.label}</strong><span className="node-type">{node.node_type}</span></div><p>{node.description ?? 'This concept will become more specific as verified material is added.'}</p></div><div className="knowledge-evidence"><span className={`evidence-pill ${status}`}>{evidenceLabel(mastery)}</span>{mastery && <small>{mastery.evidence_count} signal{mastery.evidence_count === 1 ? '' : 's'}</small>}</div><button className="row-action" onClick={onPractice} aria-label={`Practice ${node.label}`}><ChevronRight size={17} /></button></div>;
}

function KnowledgeMap({ data, onPractice }: { data: CourseData; onPractice: (node: SubjectNode) => void }) {
  return <section className="page-section animate-in"><div className="page-intro"><div><p className="eyebrow">Subject intelligence / Version 1</p><h1>Knowledge map.</h1><p className="intro-copy">This is the subject structure the teaching engine uses. Every relationship can retain its source as uploaded material is processed.</p></div><div className="map-summary"><span className="status-pulse" />{data.nodes.length} mapped nodes</div></div><div className="map-canvas"><div className="map-root"><span>Subject</span><strong>{data.course.subject_label}</strong></div><div className="map-branch-grid">{data.nodes.filter((node) => node.node_type === 'topic').map((node) => <div className="map-branch" key={node.id}><div className="branch-line" /><div className="map-node"><span className="node-type">Topic</span><strong>{node.label}</strong><p>{node.description}</p><div className="map-node-footer"><span className={`evidence-pill ${topicStatus(masteryForNode(data.mastery, node.id))}`}>{evidenceLabel(masteryForNode(data.mastery, node.id))}</span><button className="text-button" onClick={() => onPractice(node)}>Practice <ArrowUpRight size={14} /></button></div></div></div>)}</div></div></section>;
}

function EvidenceView({ data }: { data: CourseData }) {
  return <section className="page-section animate-in"><div className="page-intro"><div><p className="eyebrow">Student intelligence / Audit trail</p><h1>Learning evidence.</h1><p className="intro-copy">Tantra keeps evidence separate from assumptions. A low-confidence estimate is more honest than a confident guess.</p></div><div className="evidence-counter"><strong>{data.mastery.reduce((sum, item) => sum + item.evidence_count, 0)}</strong><span>recorded signals</span></div></div><div className="evidence-grid"><div className="evidence-panel"><div className="panel-heading"><Activity size={17} /><div><strong>Knowledge tracing</strong><span>Interpretable by default</span></div></div>{data.mastery.length ? data.mastery.map((item) => { const node = data.nodes.find((candidate) => candidate.id === item.subject_knowledge_node_id); return <div className="trace-row" key={item.id}><div><strong>{node?.label ?? 'Mapped concept'}</strong><span>{item.correct_attempts} correct · {item.incorrect_attempts} incorrect · {item.independent_attempts} independent</span></div><div className="trace-value"><strong>{Math.round(item.mastery_estimate * 100)}%</strong><span>{evidenceLabel(item)}</span></div></div>; }) : <div className="empty-insight"><CircleHelp size={18} /><p>Submit a practice response to begin building your first evidence record.</p></div>}</div><div className="evidence-panel"><div className="panel-heading"><Sparkles size={17} /><div><strong>Teaching approach</strong><span>Compared over time</span></div></div><div className="approach-note"><div className="approach-number">01</div><div><strong>No preferred approach yet</strong><p>Tantra will compare explanations, analogies, worked examples and independent practice after there is enough evidence to make the comparison meaningful.</p></div></div><div className="approach-note"><div className="approach-number">02</div><div><strong>Guessing is not mastery</strong><p>Hints, difficulty and independent performance remain separate signals in your model.</p></div></div></div></div></section>;
}

function PracticeModal({ node, result, hintUsed, isSaving, onResult, onHint, onSubmit, onClose }: { node: SubjectNode; result: 'correct' | 'unsure' | 'incorrect' | null; hintUsed: boolean; isSaving: boolean; onResult: (result: 'correct' | 'unsure' | 'incorrect') => void; onHint: () => void; onSubmit: () => void; onClose: () => void }) {
  return <div className="modal-backdrop"><div className="practice-card"><button className="modal-close" onClick={onClose} aria-label="Close practice"><X size={17} /></button><p className="eyebrow">Guided practice / {node.node_type}</p><h2>{node.label}</h2><p className="practice-prompt">Try a question for this area, then tell Tantra what happened. This first release captures explicit evidence so the next recommendation can become more precise.</p><div className="practice-callout"><CircleHelp size={17} /><span>One response will never declare mastery.</span></div><div className="result-options"><button className={result === 'correct' ? 'result-option selected' : 'result-option'} onClick={() => onResult('correct')}><Check size={18} /><span><strong>I solved it</strong><small>Correct without a hint</small></span></button><button className={result === 'unsure' ? 'result-option selected' : 'result-option'} onClick={() => onResult('unsure')}><Clock3 size={18} /><span><strong>I am unsure</strong><small>Useful uncertainty signal</small></span></button><button className={result === 'incorrect' ? 'result-option selected' : 'result-option'} onClick={() => onResult('incorrect')}><CircleHelp size={18} /><span><strong>I need another explanation</strong><small>Marks a developing area</small></span></button></div><button className={hintUsed ? 'hint-toggle selected' : 'hint-toggle'} onClick={onHint}>{hintUsed ? 'Hint used' : 'I needed a hint'}<span>{hintUsed ? 'Included in evidence' : 'Optional'}</span></button><button className="button button-dark button-wide" onClick={onSubmit} disabled={!result || isSaving}>{isSaving ? 'Updating learner model' : 'Save learning evidence'}<ArrowUpRight size={16} /></button></div></div>;
}
