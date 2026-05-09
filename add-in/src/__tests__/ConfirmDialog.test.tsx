import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ConfirmDialog } from "../components/ConfirmDialog";

function wrap(ui: React.ReactElement) {
  return <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("renders title and body when open", () => {
  render(
    wrap(
      <ConfirmDialog
        open
        title="Delete member 4000_Revenue?"
        body="This is permanent."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    ),
  );
  expect(screen.queryByText("Delete member 4000_Revenue?")).not.toBeNull();
  expect(screen.queryByText("This is permanent.")).not.toBeNull();
});

test("does not render dialog content when closed", () => {
  render(
    wrap(
      <ConfirmDialog
        open={false}
        title="Should not appear"
        body="Body should not appear"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    ),
  );
  expect(screen.queryByText("Should not appear")).toBeNull();
  expect(screen.queryByText("Body should not appear")).toBeNull();
});

test("default confirm label is 'Confirm' for non-destructive action", () => {
  render(
    wrap(
      <ConfirmDialog
        open
        title="Heads up"
        body="."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    ),
  );
  expect(screen.queryByText("Confirm")).not.toBeNull();
});

test("default confirm label is 'Delete' for destructive action", () => {
  render(
    wrap(
      <ConfirmDialog
        open
        title="Heads up"
        body="."
        destructive
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    ),
  );
  expect(screen.queryByText("Delete")).not.toBeNull();
});

test("confirmLabel prop overrides the default", () => {
  render(
    wrap(
      <ConfirmDialog
        open
        title="Submit?"
        body="."
        confirmLabel="Send it"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    ),
  );
  expect(screen.queryByText("Send it")).not.toBeNull();
});

test("clicking confirm fires onConfirm exactly once", () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(
    wrap(
      <ConfirmDialog
        open
        title="X"
        body="y"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    ),
  );
  fireEvent.click(screen.getByText("Confirm"));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

test("clicking cancel fires onCancel exactly once", () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(
    wrap(
      <ConfirmDialog
        open
        title="X"
        body="y"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    ),
  );
  fireEvent.click(screen.getByText("Cancel"));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});
