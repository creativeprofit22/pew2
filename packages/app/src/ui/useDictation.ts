/**
 * Composer-side state for dictation.
 *
 * Owns the one thing the pure merge rule cannot: a live native session that has
 * to be torn down on unmount, on send, and on switching sessions. A recogniser
 * left running holds the audio session open — on iOS that ducks other audio and
 * shows the orange mic indicator indefinitely, which reads as the app spying.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyTranscript,
  beginDictation,
  dictationMessage,
} from "../transcription";
import { speechAvailable, startDictation, type DictationSession } from "./speech";
import { haptics } from "./haptics";

export interface UseDictationOptions {
  /** The draft as it stands, read when dictation starts. */
  draft: () => string;
  onDraftChange: (draft: string) => void;
  /** Shown to the user; empty string means "say nothing". */
  onMessage: (message: string) => void;
}

export interface Dictation {
  /** False on a device with no recogniser, so the button can be hidden entirely. */
  available: boolean;
  listening: boolean;
  toggle: () => void;
  /** Stop without committing a partial guess. For send, blur and session change. */
  cancel: () => void;
}

export function useDictation({ draft, onDraftChange, onMessage }: UseDictationOptions): Dictation {
  const [listening, setListening] = useState(false);
  // Identity owns callbacks even while permission is pending or stop awaits end.
  const session = useRef<{ handle?: DictationSession } | undefined>(undefined);
  // Read at start rather than captured in a dep: the draft changes on every
  // keystroke and restarting listeners for that would drop audio mid-word.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const changeRef = useRef(onDraftChange);
  changeRef.current = onDraftChange;
  const messageRef = useRef(onMessage);
  messageRef.current = onMessage;

  // Resolved once: the answer cannot change while the app is running, and
  // asking the native module on every render is wasted work.
  const [available] = useState(speechAvailable);

  /**
   * Whether the user wants the mic on, as opposed to whether it is on yet.
   *
   * `startDictation` awaits a permission dialog, so there is a window with no
   * session to stop. Intent is tracked separately: a tap during that window
   * must cancel the session the moment it arrives, and must not be mistaken for
   * a request to start a second recogniser on top of the first.
   */
  const wanted = useRef(false);

  const stopSession = useCallback(() => {
    wanted.current = false;
    const previous = session.current;
    session.current = undefined; // Invalidate before cancel can deliver callbacks.
    previous?.handle?.cancel();
    setListening(false);
  }, []);

  // A mic left open outlives the screen that opened it.
  useEffect(() => stopSession, [stopSession]);

  const toggle = useCallback(() => {
    if (wanted.current) {
      wanted.current = false;
      // A deliberate stop asks for the final result, so the last few words the
      // recogniser had not committed still land in the draft.
      if (session.current?.handle) {
        session.current.handle.stop();
      } else {
        // A pending permission has no final to collect. Cancel it on arrival.
        session.current = undefined;
      }
      setListening(false);
      haptics.finished();
      return;
    }

    stopSession();
    const owner: { handle?: DictationSession } = {};
    session.current = owner;
    wanted.current = true;
    let state = beginDictation(draftRef.current());
    setListening(true);
    haptics.sent();

    void startDictation({
      onTranscript: (transcript) => {
        // An empty final result can arrive when the recogniser stops. Keep the
        // words already in the draft instead of resetting to the starting text.
        if (session.current !== owner || !transcript.trim()) return;
        const next = applyTranscript(state, transcript);
        state = next.state;
        changeRef.current(next.draft);
      },
      onError: (code) => {
        if (session.current !== owner) return;
        stopSession();
        const message = dictationMessage(code);
        if (message) {
          messageRef.current(message);
          haptics.failed();
        }
      },
      onEnd: () => {
        if (session.current !== owner) return;
        wanted.current = false;
        session.current = undefined;
        setListening(false);
      },
    }).then((started) => {
      if (session.current !== owner) {
        started?.cancel();
        return;
      }
      if (!started) {
        // Permission refused, or the module is missing. `onError` has already
        // said so; this only clears the optimistic listening state.
        stopSession();
        return;
      }
      owner.handle = started;
    });
  }, [stopSession]);

  // Memoized: `Composer` is memoized precisely because streamed chunks
  // re-render this screen many times a second, and a fresh object here would
  // re-render it on every one of them.
  return useMemo(
    () => ({ available, listening, toggle, cancel: stopSession }),
    [available, listening, toggle, stopSession],
  );
}
