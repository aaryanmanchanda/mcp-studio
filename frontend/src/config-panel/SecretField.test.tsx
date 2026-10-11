import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ConfigFieldValueType,
  type ConfigFieldDef,
} from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";

import { SecretField } from "./SecretField";
import { useConfigStore } from "./configStore";

const SECRET = "sk-DISTINCTIVE-credential-9f3a";

const field = {
  name: "groq_api_key",
  secret: true,
  authType: "api_key",
  valueType: ConfigFieldValueType.STRING,
  enumValues: [],
} as unknown as ConfigFieldDef;

const input = () => screen.getByLabelText("groq_api_key") as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  useConfigStore.setState({ values: {}, configured: {} });
});

describe("SecretField", () => {
  it("renders a masked input", () => {
    render(<SecretField nodeId="n1" field={field} />);
    expect(input().type).toBe("password");
  });

  it("sets the configured flag without the typed characters reaching the store", () => {
    render(<SecretField nodeId="n1" field={field} />);
    fireEvent.change(input(), { target: { value: SECRET } });

    const { values, configured } = useConfigStore.getState();
    expect(configured.n1.groq_api_key).toBe(true);
    expect(JSON.stringify({ values, configured })).not.toContain(SECRET);
  });

  it("shows the badge once something is entered", () => {
    render(<SecretField nodeId="n1" field={field} />);
    expect(screen.queryByText("Value entered")).toBeNull();
    fireEvent.change(input(), { target: { value: SECRET } });
    expect(screen.getByText("Value entered")).toBeTruthy();
  });

  it("remounts empty while the badge remains (D-07)", () => {
    const first = render(<SecretField nodeId="n1" field={field} />);
    fireEvent.change(input(), { target: { value: SECRET } });
    first.unmount();

    render(<SecretField nodeId="n1" field={field} />);
    expect(input().value).toBe("");
    expect(screen.getByText("Value entered")).toBeTruthy();
  });

  it("clearing the input resets the flag and hides the badge", () => {
    render(<SecretField nodeId="n1" field={field} />);
    fireEvent.change(input(), { target: { value: SECRET } });
    fireEvent.change(input(), { target: { value: "" } });

    expect(useConfigStore.getState().configured.n1.groq_api_key).toBe(false);
    expect(screen.queryByText("Value entered")).toBeNull();
  });

  it("has no reveal or unmask control", () => {
    render(<SecretField nodeId="n1" field={field} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(input().placeholder).toBe("");
  });

  it("badge copy avoids claiming storage or security (source check)", () => {
    const src = readFileSync(
      resolve(__dirname, "SecretField.tsx"),
      "utf8",
    );
    // only user-visible text matters; strip comments first
    const visible = src.replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(visible).not.toMatch(/\b(stored|saved|encrypted|secure)\b/i);
  });
});
