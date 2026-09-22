/** Session-owned failures must never finish or overwrite another conversation. */
import { findDuplicateError } from "./errorDedup";
import { capTurns } from "./replayFold";
import type { Session, Turn } from "./useDaemon";

interface ErrorState {
  sessionId?: string;
  turns: Turn[];
  sessions: Session[];
  busy: boolean;
  loadingSession: boolean;
  loadingProject?: string;
}

interface SessionError {
  code: string;
  message: string;
  sessionId?: string;
}

/** Pure reducer used by the socket path, including its older-daemon fallback. */
export function foldSessionError<S extends ErrorState>(
  prev: S,
  message: SessionError,
  now: number,
): S {
  // Optional requests unsupported by an older daemon are not failed turns.
  if (message.code === "unknown_message") {
    return prev.loadingProject === undefined ? prev : { ...prev, loadingProject: undefined };
  }
  const target = message.sessionId ?? prev.sessionId;
  const mine = message.sessionId === undefined || message.sessionId === prev.sessionId;
  const session = prev.sessions.find((row) => row.id === target);
  // Never redirect an error for a removed/unknown session into the open thread.
  if (!mine && !session) return prev;

  // A scoped command failure (cancel, permission, workspace...) is not evidence
  // a turn ended. Unscoped errors keep the legacy fallback, except config
  // failures explicitly identified by a newer daemon.
  const finished = message.code !== "config_failed" && (
    message.sessionId === undefined ||
    message.code === "prompt_failed" || message.code === "resume_failed"
  );
  const source = mine ? prev.turns : session!.turns;
  const turns = [...source];
  const duplicate = findDuplicateError(turns, message.message);
  if (duplicate >= 0) {
    turns[duplicate] = { ...turns[duplicate]!, role: "system" };
  } else {
    turns.push({ id: `err-${turns.length}-${now}`, role: "system", text: message.message });
  }
  const capped = capTurns(turns);
  return {
    ...prev,
    turns: mine ? capped : prev.turns,
    busy: mine && finished ? false : prev.busy,
    loadingSession: mine && finished ? false : prev.loadingSession,
    sessions: prev.sessions.map((row) => row.id === target ? {
      ...row,
      turns: capped,
      busy: finished ? false : row.busy,
      unread: mine ? row.unread : true,
    } : row),
  };
}
