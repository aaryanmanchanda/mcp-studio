import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ConfigFieldValueType,
  type ConfigFieldDef,
} from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";

import { orchestratorClient } from "@/rpc/orchestratorClient";
import { storageDump } from "@/test/storage";
import { SecretField } from "./SecretField";
import { useConfigStore } from "./configStore";

vi.mock("@/rpc/orchestratorClient", () => ({
  orchestratorClient: { setSecret: vi.fn() },
}));
const setSecret = vi.mocked(orchestratorClient.setSecret);

const SECRET = "sk-DISTINCTIVE-credential-9f3a";

const field = {
  name: "groq_api_key",
  secret: true,
  authType: "api_key",
  valueType: ConfigFieldValueType.STRING,
  enumValues: [],
} as unknown as ConfigFieldDef;

const input = () => screen.getByLabelText("groq_api_key") as HTMLInputElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });
const saveBtn = () => screen.getByRole("button", { name: /^(Save|Replace)$/ });

beforeEach(() => {
  localStorage.clear();
  useConfigStore.setState({ values: {}, configured: {} });
  setSecret.mockReset();
  setSecret.mockResolvedValue({ configured: true } as never);
});

describe("SecretField", () => {
  it("renders a masked input", () => {
    render(<SecretField nodeId="n1" field={field} />);
    expect(input().type).toBe("password");
  });

  it("typing alone sends nothing and flags nothing", () => {
    render(<SecretField nodeId="n1" field={field} />);
    type(SECRET);
    expect(setSecret).not.toHaveBeenCalled();
    expect(useConfigStore.getState().configured.n1).toBeUndefined();
  });

  it("Save sends the credential once, empties the input, and shows the badge", async () => {
    render(<SecretField nodeId="n1" field={field} />);
    type(SECRET);
    fireEvent.click(saveBtn());

    await waitFor(() => expect(screen.getByText("Saved to vault")).toBeTruthy());
    expect(setSecret).toHaveBeenCalledTimes(1);
    expect(setSecret).toHaveBeenCalledWith({ nodeId: "n1", field: "groq_api_key", value: SECRET });
    expect(input().value).toBe("");
    expect(useConfigStore.getState().configured.n1.groq_api_key).toBe(true);
  });

  it("the credential is in neither the store nor browser storage, even after saving", async () => {
    render(<SecretField nodeId="n1" field={field} />);
    type(SECRET);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(screen.getByText("Saved to vault")).toBeTruthy());

    const { values, configured } = useConfigStore.getState();
    expect(JSON.stringify({ values, configured })).not.toContain(SECRET);
    expect(JSON.stringify(storageDump())).not.toContain(SECRET);
  });

  it("remounts empty while the badge remains (D-07)", async () => {
    const first = render(<SecretField nodeId="n1" field={field} />);
    type(SECRET);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(screen.getByText("Saved to vault")).toBeTruthy());
    first.unmount();

    render(<SecretField nodeId="n1" field={field} />);
    expect(input().value).toBe("");
    expect(screen.getByText("Saved to vault")).toBeTruthy();
  });

  it("a failed save shows the error, keeps the buffer for a retry, and does not claim success", async () => {
    setSecret.mockRejectedValue(new Error("vault is down"));
    render(<SecretField nodeId="n1" field={field} />);
    type(SECRET);
    fireEvent.click(saveBtn());

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("vault is down"));
    expect(input().value).toBe(SECRET);
    expect(screen.queryByText("Saved to vault")).toBeNull();
    expect(useConfigStore.getState().configured.n1).toBeUndefined();
  });

  it("has no reveal or unmask control, and nothing echoes the value", () => {
    render(<SecretField nodeId="n1" field={field} />);
    expect(screen.queryByRole("button", { name: /show|reveal|unmask|eye/i })).toBeNull();
    expect(input().placeholder).toBe("");
  });

  it("only this component and the config store touch the credential: no setter takes a string", () => {
    const src = readFileSync(resolve(process.cwd(), "src/config-panel/configStore.ts"), "utf8");
    expect(src).toMatch(/setConfigured: \(nodeId: string, field: string, configured: boolean\)/);
  });

  it("the copy never calls the browser's storage secure (source check)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/config-panel/SecretField.tsx"), "utf8");
    const visible = src.replace(/\/\/.*$/gm, "");
    expect(visible).not.toMatch(/\bsecure[d]?\b/i);
    expect(visible).not.toMatch(/localStorage/);
  });
});
