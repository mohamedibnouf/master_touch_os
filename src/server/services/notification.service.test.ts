import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string } | null };

const state: {
  profile: Record<string, unknown> | null;
  /** When set, selects that include `locale` fail like a database without the column. */
  localeColumnMissing: boolean;
  profileSelects: string[];
  rpc: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>;
} = {
  profile: null,
  localeColumnMissing: false,
  profileSelects: [],
  rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
};

function builder(table: string) {
  let columns = "";
  const resolve = (): Result => {
    if (table === "profiles") {
      if (state.localeColumnMissing && columns.includes("locale")) {
        return { data: null, error: { message: "column profiles.locale does not exist" } };
      }
      return { data: state.profile, error: null };
    }
    if (table === "organization_members") return { data: { status: "active" }, error: null };
    if (table === "notification_preferences") return { data: [], error: null };
    return { data: null, error: null };
  };
  const chain = {
    select(cols: string) {
      columns = cols;
      if (table === "profiles") state.profileSelects.push(cols);
      return chain;
    },
    eq() {
      return chain;
    },
    maybeSingle: async () => resolve(),
    then(onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => builder(table),
    rpc: (...args: unknown[]) => state.rpc(...args),
  }),
}));

import { createNotificationService } from "./notification.service";
import { pickNotificationText } from "@/modules/notifications/localize";

const payload = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  recipientProfileId: "00000000-0000-0000-0000-000000000002",
  type: "approval.created",
  title: "طلب موافقة جديد",
  message: "اعتماد مرحلة — MT-1",
  titleEn: "New approval request",
  messageEn: "Stage approval — MT-1",
};

function storedText() {
  const args = state.rpc.mock.calls.at(-1)?.[1] as { p_title: string; p_message: string };
  return { title: args.p_title, message: args.p_message };
}

describe("recipient-language notifications", () => {
  beforeEach(() => {
    state.profile = { is_active: true, phone: null, whatsapp_opt_in: false, locale: "ar" };
    state.localeColumnMissing = false;
    state.profileSelects = [];
    state.rpc = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ data: "n-1", error: null });
  });

  it("stores the English text for a recipient whose locale is 'en'", async () => {
    state.profile = { is_active: true, phone: null, whatsapp_opt_in: false, locale: "en" };
    const service = createNotificationService({} as never);
    await expect(service.notify(payload)).resolves.toBe("n-1");
    expect(storedText()).toEqual({ title: "New approval request", message: "Stage approval — MT-1" });
  });

  it("keeps Arabic as the default for 'ar' recipients", async () => {
    await createNotificationService({} as never).notify(payload);
    expect(storedText()).toEqual({ title: "طلب موافقة جديد", message: "اعتماد مرحلة — MT-1" });
  });

  it("falls back to Arabic when English is not provided", async () => {
    state.profile = { is_active: true, phone: null, whatsapp_opt_in: false, locale: "en" };
    await createNotificationService({} as never).notify({ ...payload, titleEn: undefined, messageEn: null });
    expect(storedText()).toEqual({ title: "طلب موافقة جديد", message: "اعتماد مرحلة — MT-1" });
  });

  it("tolerates a database without profiles.locale (Arabic)", async () => {
    state.localeColumnMissing = true;
    await createNotificationService({} as never).notify(payload);
    expect(state.profileSelects[0]).toContain("locale");
    expect(state.profileSelects.at(-1)).not.toContain("locale");
    expect(storedText().title).toBe("طلب موافقة جديد");
  });
});

describe("pickNotificationText", () => {
  it("uses English only for 'en' and only when present", () => {
    const text = { title: "عنوان", message: "رسالة", titleEn: "Title", messageEn: "  " };
    expect(pickNotificationText("ar", text)).toEqual({ title: "عنوان", message: "رسالة" });
    expect(pickNotificationText("en", text)).toEqual({ title: "Title", message: "رسالة" });
  });
});
