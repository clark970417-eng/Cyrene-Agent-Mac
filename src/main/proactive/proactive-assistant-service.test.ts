import { describe, expect, it } from "vitest";
import { ProactiveAssistantService } from "./proactive-assistant-service";

describe("ProactiveAssistantService", () => {
  it("pushes and dismisses notifications", () => {
    const service = new ProactiveAssistantService();
    const notif = service.pushNotification("測試提醒", "內容", "greeting", "🌸");

    expect(service.getNotifications().length).toBe(1);
    expect(service.getNotifications()[0].title).toBe("測試提醒");

    const dismissed = service.dismissNotification(notif.id);
    expect(dismissed).toBe(true);
    expect(service.getNotifications().length).toBe(0);
  });

  it("triggers late night rest reminder during late hours", () => {
    const service = new ProactiveAssistantService();
    // 23:30
    const lateNightDate = new Date();
    lateNightDate.setHours(23, 30, 0, 0);

    const notif = service.triggerCheck(lateNightDate.getTime());
    expect(notif).not.toBeNull();
    expect(notif?.title).toContain("夜深了");
    expect(notif?.type).toBe("greeting");
  });
});
