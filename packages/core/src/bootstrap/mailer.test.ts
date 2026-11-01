import { describe, expect, it, vi } from "vite-plus/test";
import { FakeLogger } from "../app/fake-repository.ts";
import { ConsoleMailer, ResendMailer } from "./mailer.ts";

describe("ConsoleMailer", () => {
  it("ロガーに送信先とリンクを出力する", async () => {
    const logger = new FakeLogger();
    const mailer = new ConsoleMailer(logger);
    await mailer.send({ to: "a@example.com", subject: "件名", text: "https://example.com/link" });
    expect(logger.infos).toHaveLength(1);
    expect(logger.infos[0]).toContain("a@example.com");
    expect(logger.infos[0]).toContain("https://example.com/link");
  });
});

describe("ResendMailer", () => {
  it("Resend の API を正しいヘッダ・ボディで呼ぶ", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const mailer = new ResendMailer({
      apiKey: "re_test",
      from: "hakoniwa@example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await mailer.send({ to: "a@example.com", subject: "件名", text: "本文" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "hakoniwa@example.com",
      to: "a@example.com",
      subject: "件名",
      text: "本文",
    });
  });

  it("応答が失敗ステータスなら Error を投げる", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const mailer = new ResendMailer({
      apiKey: "re_test",
      from: "hakoniwa@example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(mailer.send({ to: "a@example.com", subject: "s", text: "t" })).rejects.toThrow();
  });
});
