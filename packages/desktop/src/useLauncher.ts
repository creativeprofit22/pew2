import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { desktop, type Pairing, type Snapshot } from "./bridge.js";
import { initialState, resolveActionFailure, transition } from "./state.js";

export function useLauncher() {
  const [state, dispatch] = useReducer(transition, initialState);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [stopDialog, setStopDialog] = useState(false);
  const [closeRequested, setCloseRequested] = useState(false);
  const epoch = useRef(0);
  const pending = useRef(false);
  const closingAttempt = useRef(false);
  const secretGeneration = useRef(0);
  const pairingVisible = useRef(false);

  const perform = useCallback(async (label: string, action: () => Promise<Snapshot>): Promise<Snapshot | undefined> => {
    if (pending.current) return;
    pending.current = true;
    const current = ++epoch.current;
    dispatch({ type: "begin", action: label, epoch: current });
    try {
      const snapshot = await action();
      dispatch({ type: "snapshot", snapshot, epoch: current });
      return snapshot;
    } catch (error) {
      let reason: unknown = error;
      try {
        const snapshot = await desktop.status();
        dispatch({ type: "snapshot", snapshot, epoch: current });
        reason = resolveActionFailure(error, snapshot.failure);
      } catch { /* Preserve the previous state; never invent successful recovery. */ }
      dispatch({ type: "error", error: reason, epoch: current });
    } finally {
      pending.current = false;
      dispatch({ type: "end", epoch: current });
    }
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (!active) return;
      if (!pending.current) {
        const current = epoch.current;
        try {
          const snapshot = await desktop.status();
          if (active) dispatch({ type: "snapshot", snapshot, epoch: current });
        } catch (error) {
          if (active && error !== "operation_in_progress") dispatch({ type: "error", error, epoch: current });
        }
      }
      if (active) timer = setTimeout(() => { void poll(); }, 1000);
    }
    void poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, []);

  const hidePairing = useCallback(() => {
    secretGeneration.current++;
    const wasVisible = pairingVisible.current;
    pairingVisible.current = false;
    setPairing(null);
    if (wasVisible) void desktop.hidePairing().catch(() => {});
  }, []);
  useEffect(() => {
    window.addEventListener("blur", hidePairing);
    return () => { window.removeEventListener("blur", hidePairing); secretGeneration.current++; };
  }, [hidePairing]);
  useEffect(() => { if (state.snapshot?.lifecycle !== "ready") hidePairing(); }, [state.snapshot?.lifecycle, hidePairing]);

  const requestStop = useCallback(async () => {
    hidePairing();
    const snapshot = await perform("Checking active work", desktop.stop);
    if (snapshot?.confirmation || snapshot?.forceConfirmation) setStopDialog(true);
  }, [hidePairing, perform]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void desktop.onCloseRequested(() => { setCloseRequested(true); }).then(dispose => {
      if (active) unlisten = dispose; else dispose();
    }).catch(error => { if (active) dispatch({ type: "error", error, epoch: epoch.current }); });
    return () => { active = false; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!closeRequested || state.pending || !state.snapshot) return;
    if (!state.snapshot.instance) {
      void desktop.finishClose().catch(error => {
        setCloseRequested(false);
        closingAttempt.current = false;
        dispatch({ type: "error", error, epoch: epoch.current });
      });
    } else if (state.snapshot.forceConfirmation) {
      setStopDialog(true);
    } else if (!closingAttempt.current) {
      closingAttempt.current = true;
      void requestStop();
    }
  }, [closeRequested, state.pending, state.snapshot, requestStop]);

  return {
    state, pairing, stopDialog, closeRequested,
    start: () => perform("Starting phone access", desktop.start),
    chooseHome: () => perform("Choosing data folder", desktop.chooseHome),
    stop: requestStop,
    hidePairing,
    revealPairing: async () => {
      if (pending.current) return;
      const generation = ++secretGeneration.current;
      await perform("Preparing pairing code", async () => {
        const view = await desktop.revealPairing();
        if (secretGeneration.current === generation) {
          pairingVisible.current = true;
          setPairing(view);
        }
        return desktop.status();
      });
    },
    cancelStop: () => {
      setStopDialog(false);
      setCloseRequested(false);
      closingAttempt.current = false;
    },
    confirmStop: async () => {
      const instance = state.snapshot?.instance;
      if (!instance) { setStopDialog(false); return; }
      const snapshot = await perform("Stopping phone access", () => desktop.confirmStop(instance, Boolean(state.snapshot?.forceConfirmation)));
      if (snapshot) setStopDialog(false);
    },
  };
}
