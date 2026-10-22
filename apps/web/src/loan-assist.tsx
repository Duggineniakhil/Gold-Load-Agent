import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  API_PREFIX,
  type AgentApplicationSummary,
  type AgentSubmission,
  type AgentToolEvent,
  type AgentTurnResponse,
} from '@tglobal/shared';
import { Button } from './ui';

type Entry = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  toolEvents?: AgentToolEvent[];
  submission?: AgentSubmission | null;
};

const toolLabels: Record<AgentToolEvent['tool'], string> = {
  get_loan_schemes: 'Checked plans',
  calculate_quote: 'Calculated quote',
  check_existing_application: 'Checked past applications',
  submit_application: 'Prepared summary',
  unknown: 'Unknown tool',
};

const greeting: Entry = {
  id: 0,
  role: 'assistant',
  text: 'Hello! Tell me about your gold, for example “I have 45 grams of 22 carat jewellery”, and I will work out your loan offer.',
};

async function post(path: string, body: unknown): Promise<AgentTurnResponse> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message ?? 'Loan Assist could not be reached.',
    ) as Error & { code?: string };
    error.code = payload?.error?.code;
    throw error;
  }
  return payload as AgentTurnResponse;
}

async function postStream(
  path: string,
  body: unknown,
  onDelta: (delta: string) => void,
): Promise<AgentTurnResponse> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(
      payload?.error?.message ?? 'Loan Assist could not be reached.',
    ) as Error & { code?: string };
    error.code = payload?.error?.code;
    throw error;
  }
  if (!response.body) throw new Error('Loan Assist returned no reply stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AgentTurnResponse | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const rawEvent of events) {
      const lines = rawEvent.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (!event || !data) continue;
      if (event === 'delta') {
        onDelta((JSON.parse(data) as { delta: string }).delta);
      } else if (event === 'done') {
        result = JSON.parse(data) as AgentTurnResponse;
      } else if (event === 'error') {
        const payload = JSON.parse(data) as {
          error: { code: string; message: string };
        };
        const error = new Error(payload.error.message) as Error & { code?: string };
        error.code = payload.error.code;
        throw error;
      }
    }
    if (done) break;
  }
  if (!result) throw new Error('Loan Assist reply stream ended unexpectedly.');
  return result;
}

/** Conversation state lives above the sheet so closing the panel keeps the chat. */
export function useLoanAssist() {
  const [entries, setEntries] = useState<Entry[]>([greeting]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [pending, setPending] = useState<AgentApplicationSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nextId = useRef(1);

  const append = (entry: Omit<Entry, 'id'>) =>
    setEntries((current) => [...current, { ...entry, id: nextId.current++ }]);

  function receive(turn: AgentTurnResponse, entryId?: number) {
    setSessionId(turn.sessionId);
    setPending(turn.pendingConfirmation);
    if (entryId === undefined) {
      append({
        role: 'assistant',
        text: turn.reply,
        toolEvents: turn.toolEvents,
        submission: turn.submission,
      });
    } else {
      setEntries((current) =>
        current.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                text: turn.reply,
                toolEvents: turn.toolEvents,
                submission: turn.submission,
              }
            : entry,
        ),
      );
    }
  }

  async function run(action: () => Promise<AgentTurnResponse>) {
    setBusy(true);
    setError('');
    try {
      receive(await action());
    } catch (reason) {
      const failure = reason as Error & { code?: string };
      if (failure.code === 'SESSION_NOT_FOUND') {
        setSessionId(undefined);
        setPending(null);
      }
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return {
    entries,
    pending,
    busy,
    error,
    send(message: string) {
      const userId = nextId.current++;
      const assistantId = nextId.current++;
      setEntries((current) => [
        ...current,
        { id: userId, role: 'user', text: message },
        { id: assistantId, role: 'assistant', text: '' },
      ]);
      setPending(null);
      setBusy(true);
      setError('');
      return postStream(
        '/agent/messages/stream',
        { message, ...(sessionId ? { sessionId } : {}) },
        (delta) =>
          setEntries((current) =>
            current.map((entry) =>
              entry.id === assistantId ? { ...entry, text: entry.text + delta } : entry,
            ),
          ),
      )
        .then((turn) => receive(turn, assistantId))
        .catch((reason: unknown) => {
          const failure = reason as Error & { code?: string };
          if (failure.code === 'SESSION_NOT_FOUND') {
            setSessionId(undefined);
            setPending(null);
          }
          setEntries((current) =>
            current.filter((entry) => entry.id !== assistantId || entry.text.length > 0),
          );
          setError(failure.message);
        })
        .finally(() => setBusy(false));
    },
    settle(confirm: boolean) {
      if (!sessionId) return Promise.resolve();
      return run(() => post(`/agent/sessions/${sessionId}/confirm`, { confirm }));
    },
    reset() {
      setEntries([greeting]);
      setSessionId(undefined);
      setPending(null);
      setError('');
    },
  };
}

export type LoanAssistState = ReturnType<typeof useLoanAssist>;

/** Renders **bold** spans from model replies; everything else stays plain text. */
function formatReply(text: string): ReactNode[] {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : part));
}

function SummaryCard({
  summary,
  busy,
  onSettle,
}: {
  summary: AgentApplicationSummary;
  busy: boolean;
  onSettle: (confirm: boolean) => void;
}) {
  const rows: [string, string][] = [
    ['Name', summary.name],
    ['Mobile', summary.mobileNumber],
    ['Gross weight', `${summary.grossWeightGrams} g`],
    ['Net weight', `${summary.netWeightGrams} g`],
    ['Purity', `${summary.karat}K`],
    ['Pure gold', `${summary.pureGoldGrams} g`],
    ['Gold value', summary.goldValue],
    ['Plan', `${summary.planName} · ${summary.ltvPercent}% LTV`],
  ];
  return (
    <section className="assist-summary" aria-labelledby="assist-summary-heading">
      <p className="eyebrow" id="assist-summary-heading">
        CONFIRM APPLICATION
      </p>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="assist-summary__loan">
        <span>Eligible loan</span>
        <strong>{summary.eligibleLoan}</strong>
      </div>
      <div className="assist-summary__actions">
        <Button tone="outline" type="button" disabled={busy} onClick={() => onSettle(false)}>
          Cancel
        </Button>
        <Button type="button" disabled={busy} onClick={() => onSettle(true)}>
          Confirm &amp; submit
        </Button>
      </div>
    </section>
  );
}

export function LoanAssistChat({ chat }: { chat: LoanAssistState }) {
  const [draft, setDraft] = useState('');
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [chat.entries.length, chat.pending, chat.busy]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || chat.busy) return;
    setDraft('');
    void chat.send(message);
  }

  return (
    <div className="assist-chat">
      <div
        className="assist-log"
        role="log"
        aria-live="polite"
        aria-label="Loan Assist conversation"
      >
        {chat.entries.map((entry) => (
          <div key={entry.id} className={`assist-message assist-message--${entry.role}`}>
            {entry.toolEvents && entry.toolEvents.length > 0 && (
              <ul className="assist-chips" aria-label="Tools used">
                {entry.toolEvents.map((event, index) => (
                  <li key={index} className={event.ok ? '' : 'is-error'}>
                    {toolLabels[event.tool]}
                    {event.ok ? '' : ' · needs fixing'}
                  </li>
                ))}
              </ul>
            )}
            <p>{entry.role === 'assistant' ? formatReply(entry.text) : entry.text}</p>
            {entry.submission?.outcome === 'submitted' && (
              <span className="assist-outcome">Application {entry.submission.applicationId}</span>
            )}
          </div>
        ))}
        {chat.pending && (
          <SummaryCard
            summary={chat.pending}
            busy={chat.busy}
            onSettle={(confirm) => void chat.settle(confirm)}
          />
        )}
        {chat.busy && (
          <div className="assist-working" role="status">
            Loan Assist is working…
          </div>
        )}
        {chat.error && (
          <p className="inline-error" role="alert">
            {chat.error}
          </p>
        )}
        <div ref={logEnd} />
      </div>
      <form className="assist-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="assist-input">
          Message Loan Assist
        </label>
        <input
          id="assist-input"
          className="field__input"
          autoComplete="off"
          maxLength={2000}
          placeholder="Ask about your gold loan"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" disabled={chat.busy || !draft.trim()}>
          Send
        </Button>
      </form>
      <button type="button" className="assist-reset" onClick={chat.reset} disabled={chat.busy}>
        Start a new conversation
      </button>
    </div>
  );
}
