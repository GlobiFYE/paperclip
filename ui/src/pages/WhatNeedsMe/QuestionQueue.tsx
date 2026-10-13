import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Agent, AskUserQuestionsAnswer, AskUserQuestionsQuestion, PaperclipQuestionSetQuestion } from "@paperclipai/shared";
import { issuesApi } from "../../api/issues";
import { decisionsApi } from "../../api/decisions";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { MarkdownBody } from "../../components/MarkdownBody";
import { matchSafeQuestionValidationPattern } from "../../components/task-chat/question-validation-pattern";
import { Input } from "../../components/ui/input";
import { hasBlockingShortcutDialog } from "../../lib/keyboardShortcuts";
import type { HydratedDecision } from "./classifyDecision";
import { refreshDecisions } from "./useDecisionRecords";

type Draft = Record<string, AskUserQuestionsAnswer>;
type Choice = { id: string; label: string; description?: string | null; freeText?: boolean; recommended?: boolean };
function presentation(entry: HydratedDecision): { questions: AskUserQuestionsQuestion[]; canonical: PaperclipQuestionSetQuestion[] } {
  if (entry.kind === "decision") return { questions: [{ id: entry.record.id, prompt: entry.record.title, required: true,
    selectionMode: "single", allowOther: false, options: entry.record.options }], canonical: [] };
  if (entry.kind === "interaction" && entry.record.kind === "ask_user_questions") {
    return { questions: entry.record.payload.questions, canonical: entry.record.payload.questionSet?.questions ?? [] };
  }
  return { questions: [], canonical: [] };
}

export function QuestionQueue({ entries, companyId, agentMap, userLabelMap, currentUserId }: {
  entries: HydratedDecision[]; companyId: string; agentMap: Map<string, Agent>;
  userLabelMap?: ReadonlyMap<string, string>; currentUserId?: string | null;
}) {
  const client = useQueryClient();
  const [order, setOrder] = useState(() => entries.map((entry) => entry.item.id));
  const [cursor, setCursor] = useState(0);
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [customOpen, setCustomOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setOrder((previous) => {
      const added = entries.map((entry) => entry.item.id).filter((id) => !previous.includes(id));
      return added.length ? [...previous, ...added] : previous;
    });
  }, [entries]);
  const available = (id: string) => !completed.has(id) && entries.some((entry) => entry.item.id === id);
  const unansweredIds = order.filter(available);
  const index = order.findIndex((id, i) => i >= cursor && available(id));
  const entry = index < 0 ? undefined : entries.find((entry) => entry.item.id === order[index]);
  const { questions, canonical } = entry ? presentation(entry) : { questions: [], canonical: [] };
  const page = Math.min(step, Math.max(0, questions.length - 1));
  const question = questions[page];
  const shown = canonical.find((question) => question.id === questions[page]?.id);
  const textOnly = shown?.answerMode === "text";
  const multi = question?.selectionMode === "multi";
  const draft = entry ? drafts[entry.item.id] ?? {} : {};
  const answer = question ? draft[question.id] ?? { questionId: question.id, optionIds: [] } : undefined;
  const choices: Choice[] = (question?.options ?? []).map((option) => ({ ...option,
    recommended: shown?.prompt === question?.prompt
      && shown?.options?.some((choice) => choice.id === option.id && choice.label === option.label && choice.recommended === true) === true,
  })).sort((a, b) => Number(b.recommended) - Number(a.recommended));
  if (question && !textOnly && !choices.some((choice) => choice.freeText)
    && (shown ? shown.customAnswer?.enabled === true : question.allowOther !== false)) {
    choices.push({ id: "__custom_text", label: shown?.customAnswer?.label || "Write my own answer", freeText: true });
  }
  const showText = textOnly || customOpen || !!answer?.otherText;
  useEffect(() => {
    setCustomOpen(false); setError(null);
    card.current?.focus();
  }, [entry?.item.id, page]);
  useEffect(() => { if (showText) input.current?.focus(); }, [showText, entry?.item.id, page]);

  // A disabled submit control can leave focus on body when a write fails.
  useEffect(() => { if (error && !busy) card.current?.focus(); }, [error, busy]);

  function save(next: AskUserQuestionsAnswer) {
    if (entry) setDrafts((previous) => ({ ...previous, [entry.item.id]: { ...previous[entry.item.id], [next.questionId]: next } }));
  }
  function move(next: number) { setCursor(next); setStep(0); setError(null); setCustomOpen(false); }
  function back() {
    if (lock.current) return;
    if (entry && page > 0) { setStep(page - 1); return; }
    const before = index < 0 ? order.length : index;
    for (let i = before - 1; i >= 0; i--) if (available(order[i])) { move(i); return; }
  }
  function skip() { if (!lock.current && entry) move(index + 1); }
  async function advance(next: AskUserQuestionsAnswer) {
    if (!entry || !question || lock.current) return;
    if ((textOnly || (customOpen && !next.optionIds.length)) && !next.otherText?.trim()) { setError("Enter your answer first."); return; }
    if (question.required && !next.optionIds.length && !next.otherText?.trim()) { setError("Choose an answer first."); return; }
    const text = next.otherText?.trim();
    const validation = shown?.textValidation;
    if (text && validation) {
      if (validation.minLength != null && text.length < validation.minLength) { setError(`Enter at least ${validation.minLength} characters.`); return; }
      if (validation.maxLength != null && text.length > validation.maxLength) { setError(`Enter no more than ${validation.maxLength} characters.`); return; }
      if (validation.pattern && matchSafeQuestionValidationPattern(validation.pattern, text) !== "match") { setError("Use the requested answer format."); return; }
      if (validation.inputType === "number" || validation.inputType === "integer") {
        const value = Number(text);
        if (!Number.isFinite(value) || (validation.inputType === "integer" && !Number.isInteger(value))
          || (validation.minimum != null && value < validation.minimum) || (validation.maximum != null && value > validation.maximum)) {
          setError("Enter a number in the requested range."); return;
        }
      }
    }
    save(next);
    if (page < questions.length - 1) { setStep(page + 1); return; }
    const answers = { ...draft, [question.id]: next };
    const missing = questions.findIndex((q) => q.required && !answers[q.id]?.optionIds.length && !answers[q.id]?.otherText?.trim());
    if (missing >= 0) { setStep(missing); setError("Answer this question before submitting."); return; }
    lock.current = true; setBusy(true); setError(null);
    try {
      if (entry.kind === "decision") {
        const receipt = await decisionsApi.decide(entry.record.id, { optionId: next.optionIds[0] });
        if (receipt.status !== "decided") throw new Error("The decision changed. Refresh and review it again.");
      } else if (entry.kind === "interaction") {
        const receipt = await issuesApi.respondToInteraction(entry.record.issueId, entry.record.id, {
          answers: questions.map((q) => answers[q.id] ?? { questionId: q.id, optionIds: [] }),
        });
        if (receipt.status !== "answered") throw new Error("The question changed. Refresh and review it again.");
      }
      setCompleted((previous) => new Set(previous).add(entry.item.id));
      setDrafts((previous) => { const next = { ...previous }; delete next[entry.item.id]; return next; });
      move(index + 1);
      await refreshDecisions(client, companyId);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The answer could not be saved. Try again.");
    } finally { lock.current = false; setBusy(false); }
  }
  function choose(choice: Choice) {
    if (!answer || lock.current) return;
    if (choice.freeText) {
      setCustomOpen(true);
      save({ ...answer, optionIds: multi ? answer.optionIds : [], otherText: answer.otherText ?? "" });
      input.current?.focus();
    } else if (multi) {
      save({ ...answer, optionIds: answer.optionIds.includes(choice.id) ? answer.optionIds.filter((id) => id !== choice.id) : [...answer.optionIds, choice.id] });
    } else {
      setCustomOpen(false);
      // Picking a regular option replaces a custom answer.
      void advance({ questionId: answer.questionId, optionIds: [choice.id] });
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (lock.current || event.repeat || event.ctrlKey || event.metaKey || event.altKey || hasBlockingShortcutDialog()
        || target?.closest("input:not([type='checkbox']),textarea,select,[contenteditable='true']")
        || !card.current?.contains(document.activeElement)) return;
      if (/^[1-9]$/.test(event.key) && !textOnly && choices[Number(event.key) - 1]) {
        event.preventDefault(); choose(choices[Number(event.key) - 1]);
      } else if (event.key.toLowerCase() === "s" || event.key === "ArrowRight") { event.preventDefault();
        if (event.key === "ArrowRight" && entry && page < questions.length - 1) setStep(page + 1); else skip(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const agentId = entry?.kind === "decision" ? entry.record.originAgentId
    : entry?.kind === "interaction" ? entry.record.createdByAgentId : null;
  const userId = entry?.kind === "interaction" ? entry.record.createdByUserId : null;
  const asker = agentId ? agentMap.get(agentId)?.name ?? entry?.item.originAgentName ?? "an agent"
    : userId ? userId === currentUserId ? "you" : userLabelMap?.get(userId) ?? "a teammate" : "the system";
  const description = entry?.kind === "decision" ? entry.record.body
    : entry?.kind === "interaction" && entry.record.kind === "ask_user_questions" ? entry.record.payload.questionSet?.description : null;
  const emptyTitle = unansweredIds.length
    ? `${unansweredIds.length} unanswered ${unansweredIds.length === 1 ? "request" : "requests"}` : "All caught up";
  const canBack = page > 0 || order.some((id, i) => i < (index < 0 ? order.length : index) && available(id));
  return <div className="flex min-w-0 flex-col gap-3">
    <p className="text-sm text-muted-foreground">Answers stay in a draft until every question in this request is answered. Leaving this page or tab discards unfinished drafts.</p>
    <div key={`${entry?.item.id ?? "done"}:${page}`} ref={card} tabIndex={-1} aria-live="polite" aria-atomic="true"
      aria-label={question?.prompt ?? emptyTitle} className="decision-question-card flex min-w-0 flex-col gap-4 rounded-lg border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {entry && question && answer ? <>
        <p className="text-sm text-muted-foreground">{unansweredIds.indexOf(entry.item.id) + 1} of {unansweredIds.length}{questions.length > 1 ? ` · Question ${page + 1} of ${questions.length}` : ""}</p>
        <h2 className="break-words text-xl font-semibold">{question.prompt}</h2>
        <p className="text-xs text-muted-foreground">Asked by {asker}</p>
        {description && <MarkdownBody>{description}</MarkdownBody>}
        {(question.helpText || shown?.helpText) && <p className="break-words text-sm">{shown?.helpText || question.helpText}</p>}
        {!textOnly && <div className="flex min-w-0 flex-col gap-2">
          {choices.map((choice, i) => multi && !choice.freeText ? <label key={choice.id} className="flex items-center gap-3 rounded-md border p-3">
            <input type="checkbox" checked={answer.optionIds.includes(choice.id)} disabled={busy} onChange={() => choose(choice)} />
            <span className="min-w-0 break-words">{choice.label}{choice.description && <span className="block text-sm text-muted-foreground">{choice.description}</span>}</span>
            {choice.recommended && <Badge>Recommended</Badge>}
          </label> : <Button key={choice.id} variant="outline" disabled={busy} onClick={() => choose(choice)}
            className="h-auto min-w-0 justify-start whitespace-normal break-words p-4 text-left">
            <span className="min-w-0 flex-1">{i < 9 ? `${i + 1}. ` : ""}{choice.label}
              {choice.description && <span className="block text-sm text-muted-foreground">{choice.description}</span>}</span>
            {choice.recommended && <Badge>Recommended</Badge>}
          </Button>)}
        </div>}
        {showText && <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void advance(answer); }}>
          <Input ref={input} aria-label="Your answer" value={answer.otherText ?? ""} disabled={busy}
            placeholder={shown?.customAnswer?.placeholder} onChange={(event) => save({ ...answer, otherText: event.target.value })} />
          {!multi && <Button disabled={busy || !answer.otherText?.trim()} type="submit">{textOnly ? "Submit" : "Next"}</Button>}
        </form>}
        {multi && <Button disabled={busy || (!!question.required && !answer.optionIds.length && !answer.otherText?.trim())}
          onClick={() => void advance(answer)}>Done</Button>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </> : <>
        <h2 className="text-xl font-semibold">{emptyTitle}</h2>
        {unansweredIds.length > 0 && <p className="text-sm text-muted-foreground">You skipped these requests. Go back to answer them.</p>}
      </>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={busy || !canBack} onClick={back}>Back</Button>
        {entry && <Button variant="ghost" disabled={busy} onClick={skip}>Skip</Button>}
      </div>
    </div>
  </div>;
}
