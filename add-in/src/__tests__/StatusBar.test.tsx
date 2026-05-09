import React from "react";
import { render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { StatusBar } from "../components/StatusBar";

function wrap(ui: React.ReactElement) {
  return <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("renders nothing when status is idle", () => {
  const { container } = render(wrap(<StatusBar status={{ kind: "idle" }} />));
  expect(container.textContent ?? "").toBe("");
});

test("shows refreshing label when loading=refresh", () => {
  render(wrap(<StatusBar status={{ kind: "loading", what: "refresh" }} />));
  expect(screen.queryByText("Refreshing…")).not.toBeNull();
});

test("shows generic 'Working…' when loading without a known what", () => {
  render(wrap(<StatusBar status={{ kind: "loading" }} />));
  expect(screen.queryByText("Working…")).not.toBeNull();
});

test("hides loading state when showLoading=false", () => {
  const { container } = render(
    wrap(
      <StatusBar
        status={{ kind: "loading", what: "refresh" }}
        showLoading={false}
      />,
    ),
  );
  expect(container.textContent ?? "").toBe("");
});

test("renders success MessageBar with the provided message", () => {
  render(
    wrap(
      <StatusBar status={{ kind: "ok", message: "Saved 12 cells" }} />,
    ),
  );
  expect(screen.queryByText("Saved 12 cells")).not.toBeNull();
  expect(screen.queryByText("Done")).not.toBeNull();
});

test("renders error MessageBar with the provided message", () => {
  render(
    wrap(
      <StatusBar status={{ kind: "error", message: "Network down" }} />,
    ),
  );
  expect(screen.queryByText("Network down")).not.toBeNull();
  expect(screen.queryByText("Error")).not.toBeNull();
});
