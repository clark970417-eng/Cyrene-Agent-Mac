import { describe, expect, it, vi } from "vitest";
import { AmbientLifeService } from "./ambient-life-service";

describe("AmbientLifeService", () => {
  it("computes correct time of day period based on hour", () => {
    const service = new AmbientLifeService();

    expect(service.getTimeOfDayPeriod(6)).toBe("dawn");
    expect(service.getTimeOfDayPeriod(9)).toBe("morning");
    expect(service.getTimeOfDayPeriod(12)).toBe("noon");
    expect(service.getTimeOfDayPeriod(15)).toBe("afternoon");
    expect(service.getTimeOfDayPeriod(20)).toBe("evening");
    expect(service.getTimeOfDayPeriod(2)).toBe("late_night");
  });

  it("manages focus session lifecycle and pomodoro state", () => {
    const service = new AmbientLifeService();

    const initialState = service.getCurrentState();
    expect(initialState.focus.isActive).toBe(false);

    // Start focus
    const startState = service.startFocus({ durationMinutes: 25, breakMinutes: 5, topic: "寫程式" });
    expect(startState.focus.isActive).toBe(true);
    expect(startState.focus.phase).toBe("focus");
    expect(startState.focus.remainingSec).toBe(25 * 60);
    expect(startState.focus.topic).toBe("寫程式");

    // Pause focus
    const pausedState = service.pauseFocus();
    expect(pausedState.focus.isPaused).toBe(true);

    // Resume focus
    const resumeState = service.resumeFocus();
    expect(resumeState.focus.isPaused).toBe(false);

    // Tick down
    service.tick();
    const tickState = service.getCurrentState();
    expect(tickState.focus.remainingSec).toBe(25 * 60 - 1);
    expect(tickState.focus.elapsedSec).toBe(1);

    // Stop focus
    const stopState = service.stopFocus();
    expect(stopState.focus.isActive).toBe(false);
  });

  it("switches to break phase when focus duration expires", () => {
    const service = new AmbientLifeService();
    service.startFocus({ durationSeconds: 1, breakSeconds: 60 });

    expect(service.getCurrentState().focus.remainingSec).toBe(1);

    // Trigger tick
    service.tick();

    const updatedState = service.getCurrentState();
    expect(updatedState.focus.phase).toBe("short_break");
    expect(updatedState.focus.completedPomodoros).toBe(1);
    expect(updatedState.focus.remainingSec).toBe(60);
  });

  it("notifies listeners on state change and action trigger", () => {
    const service = new AmbientLifeService();
    const stateListener = vi.fn();
    const actionListener = vi.fn();

    const unsubState = service.subscribe(stateListener);
    const unsubAction = service.subscribeAction(actionListener);

    service.startFocus();
    expect(stateListener).toHaveBeenCalled();
    expect(actionListener).toHaveBeenCalledWith("笑一笑");

    unsubState();
    unsubAction();
  });
});
