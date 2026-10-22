import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type {
  AgentMessageRequest,
  AgentSubmission,
  AgentToolEvent,
  AgentTurnResponse,
} from '@tglobal/shared';
import type { ChatMessage, LlmClient } from '../agent/llm-client.js';
import { findUnsupportedNumbers } from '../agent/number-guard.js';
import { systemPrompt } from '../agent/prompt.js';
import {
  runTool,
  toolDefinitions,
  type PendingApplication,
  type ToolContext,
} from '../agent/tools.js';
import { formatINR } from '../domain/money.js';
import { ConflictError, NotFoundError } from '../errors.js';
import type { ExistingLead, LeadRepository } from '../repositories/lead-repository.js';
import { submitLead } from './lead-service.js';

export type AgentServiceDependencies = ToolContext & {
  llm: LlmClient;
  leadRepository: LeadRepository;
  logger: Logger;
  maxSteps?: number;
  sessionTtlMs?: number;
  maxSessions?: number;
};

export interface AgentService {
  sendMessage(input: AgentMessageRequest): Promise<AgentTurnResponse>;
  confirm(sessionId: string, confirm: boolean): Promise<AgentTurnResponse>;
}

type Session = {
  id: string;
  messages: ChatMessage[];
  pending: PendingApplication | null;
  busy: boolean;
  touchedAt: number;
};

export const confirmationPrompt =
  'Please check the summary below. Press Confirm to submit the application, or Cancel to change something.';
export const unverifiedFiguresReply =
  'I could not verify those figures, so I will not guess. Tell me the gross weight, net weight and karat of your gold and I will calculate the offer with our quote tool.';
const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeZone: 'Asia/Kolkata',
});

export function createAgentService(deps: AgentServiceDependencies): AgentService {
  const maxSteps = deps.maxSteps ?? 6;
  const sessionTtlMs = deps.sessionTtlMs ?? 30 * 60 * 1000;
  const maxSessions = deps.maxSessions ?? 1000;
  const sessions = new Map<string, Session>();

  function touch(session: Session) {
    session.touchedAt = Date.now();
    sessions.delete(session.id);
    sessions.set(session.id, session);
  }

  function createSession(): Session {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.touchedAt > sessionTtlMs || sessions.size >= maxSessions)
        sessions.delete(id);
      else break;
    }
    const session: Session = {
      id: randomUUID(),
      messages: [],
      pending: null,
      busy: false,
      touchedAt: now,
    };
    sessions.set(session.id, session);
    return session;
  }

  function findSession(sessionId: string): Session {
    const session = sessions.get(sessionId);
    if (!session || Date.now() - session.touchedAt > sessionTtlMs) {
      sessions.delete(sessionId);
      throw new NotFoundError(
        'This conversation has expired. Start a new one.',
        'SESSION_NOT_FOUND',
      );
    }
    return session;
  }

  /** Runs one turn with the session locked; on failure the turn's messages are discarded. */
  async function withTurn(session: Session, turn: () => Promise<AgentTurnResponse>) {
    if (session.busy)
      throw new ConflictError('Loan Assist is still answering your last message.', 'AGENT_BUSY');
    session.busy = true;
    const historyLength = session.messages.length;
    const pending = session.pending;
    try {
      return await turn();
    } catch (error) {
      session.messages.length = historyLength;
      session.pending = pending;
      throw error;
    } finally {
      session.busy = false;
      touch(session);
    }
  }

  function borrowerText(session: Session): string {
    return session.messages
      .flatMap((message) =>
        message.role === 'user' && typeof message.content === 'string' ? [message.content] : [],
      )
      .join('\n');
  }

  function trustedSources(session: Session): string[] {
    return [
      systemPrompt,
      ...session.messages.flatMap((message) => {
        if (message.role === 'tool') return [message.content];
        if (message.role === 'user' && typeof message.content === 'string')
          return [message.content];
        return [];
      }),
    ];
  }

  function respond(
    session: Session,
    reply: string,
    toolEvents: AgentToolEvent[],
    submission: AgentSubmission | null,
  ): AgentTurnResponse {
    return {
      sessionId: session.id,
      reply,
      toolEvents,
      pendingConfirmation: session.pending?.summary ?? null,
      submission,
    };
  }

  async function converse(session: Session, message: string): Promise<AgentTurnResponse> {
    session.pending = null;
    session.messages.push({ role: 'user', content: message });
    const toolEvents: AgentToolEvent[] = [];
    let correction: ChatMessage | null = null;
    let guard: 'passed' | 'retried' | 'fallback' = 'passed';

    for (let step = 0; step < maxSteps; step += 1) {
      const assistant = await deps.llm.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          ...session.messages,
          ...(correction ? [correction] : []),
        ],
        tools: toolDefinitions,
      });
      correction = null;

      if (assistant.tool_calls?.length) {
        session.messages.push(assistant);
        for (const call of assistant.tool_calls) {
          const outcome = await runTool(
            call.function.name,
            call.function.arguments,
            deps,
            borrowerText(session),
          );
          toolEvents.push({ tool: outcome.tool, ok: outcome.ok });
          session.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(outcome.result),
          });
          if (outcome.pending) session.pending = outcome.pending;
        }
        if (session.pending) {
          session.messages.push({ role: 'assistant', content: confirmationPrompt });
          return finish(session, confirmationPrompt, toolEvents, guard);
        }
        continue;
      }

      const text = assistant.content?.trim() ?? '';
      const unsupported = findUnsupportedNumbers(text, trustedSources(session));
      if (text && unsupported.length === 0) {
        session.messages.push({ ...assistant, content: text });
        return finish(session, text, toolEvents, guard);
      }
      if (guard === 'retried') break;
      guard = 'retried';
      correction = {
        role: 'user',
        content: text
          ? `[Loan Assist check] Your draft reply stated figures that no tool returned (${unsupported.join(', ')}). Do not calculate. Rewrite the reply using only figures from tool results, or call the right tool first.`
          : '[Loan Assist check] Your reply was empty. Answer the borrower.',
      };
    }

    guard = 'fallback';
    session.messages.push({ role: 'assistant', content: unverifiedFiguresReply });
    return finish(session, unverifiedFiguresReply, toolEvents, guard);
  }

  function finish(session: Session, reply: string, toolEvents: AgentToolEvent[], guard: string) {
    deps.logger.info(
      { sessionId: session.id, toolEvents, guard, awaitingConfirmation: Boolean(session.pending) },
      'Agent turn completed',
    );
    return respond(session, reply, toolEvents, null);
  }

  async function settle(session: Session, confirm: boolean): Promise<AgentTurnResponse> {
    const pending = session.pending;
    if (!pending)
      throw new ConflictError(
        'There is no application waiting for confirmation.',
        'NO_PENDING_APPLICATION',
      );
    session.pending = null;

    let reply: string;
    let submission: AgentSubmission;
    if (!confirm) {
      reply = 'Okay, I have not submitted anything. Tell me what you would like to change.';
      submission = { outcome: 'cancelled' };
    } else {
      try {
        const { ratePaisePerGram } = await deps.goldRate.current();
        const result = await submitLead(pending.input, deps.leadRepository, ratePaisePerGram);
        reply = `Your application ${result.applicationId} has been submitted. Eligible loan: ${formatINR(result.quote.eligibleLoanPaise)} on the ${result.quote.planName} plan. This is a preliminary offer, subject to physical verification of your gold.`;
        submission = {
          outcome: 'submitted',
          applicationId: result.applicationId,
          status: result.status,
          createdAt: result.createdAt,
        };
      } catch (error) {
        if (!(error instanceof ConflictError) || error.code !== 'DUPLICATE_APPLICATION')
          throw error;
        const existing = error.extra.existing as ExistingLead;
        reply = `You already applied on ${dateFormatter.format(existing.createdAt)}, application ${existing.applicationId}. Only one application per mobile number is accepted within 7 days.`;
        submission = {
          outcome: 'duplicate',
          applicationId: existing.applicationId,
          createdAt: existing.createdAt.toISOString(),
        };
      }
    }

    session.messages.push(
      {
        role: 'user',
        content: `[Borrower pressed ${confirm ? 'Confirm' : 'Cancel'} on the summary card]`,
      },
      { role: 'assistant', content: reply },
    );
    deps.logger.info(
      { sessionId: session.id, outcome: submission.outcome },
      'Agent confirmation settled',
    );
    return respond(session, reply, [], submission);
  }

  return {
    sendMessage: async ({ sessionId, message }) => {
      const session = sessionId ? findSession(sessionId) : createSession();
      return withTurn(session, () => converse(session, message));
    },
    confirm: async (sessionId, confirm) => {
      const session = findSession(sessionId);
      return withTurn(session, () => settle(session, confirm));
    },
  };
}
