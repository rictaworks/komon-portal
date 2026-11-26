import { describe, expect, it } from "vitest";
import { attachJev } from "../../src/app/web/pages/office/jev-settings";

describe("attachJev", () => {
  it("sends the key header and the model only when this browser holds a key", () => {
    const form = new FormData();
    expect(attachJev(form, { key: "tsk-user-secret-key", model: "jev-1.13.0" })).toEqual({ "X-Jev-Key": "tsk-user-secret-key" });
    expect(form.get("model")).toBe("jev-1.13.0");
  });

  it("adds nothing to an upload without a stored key", () => {
    const form = new FormData();
    expect(attachJev(form, { key: "", model: "jev-1.13.0" })).toBeUndefined();
    expect(form.has("model")).toBe(false);
  });
});
