import { useState } from "react";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  Delete20Regular,
  Edit20Regular,
} from "@fluentui/react-icons";
import {
  addDimMember,
  deleteDimMember,
  newRequestId,
  updateDimMember,
} from "../api/client";
import type { DimMemberInfo } from "../types/generated";
import { DIM_NAMES, type DimName } from "../types/dims";
import { buildTree, memberLabelFromInfo } from "../excel/dim_tree";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusBar, type Status } from "./StatusBar";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  tree: {
    display: "flex",
    flexDirection: "column",
    maxHeight: "260px",
    overflowY: "auto",
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalXS,
    borderRadius: tokens.borderRadiusMedium,
  },
  treeRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    padding: `2px ${tokens.spacingHorizontalXS}`,
    borderRadius: tokens.borderRadiusSmall,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
  },
  treeLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: tokens.fontSizeBase200,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  alias: {
    color: tokens.colorNeutralForeground3,
    marginLeft: tokens.spacingHorizontalXS,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  addForm: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalS,
  },
  editFields: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    minWidth: "320px",
  },
});

interface Props {
  dimensionsByName: Partial<Record<DimName, DimMemberInfo[]>>;
  onChanged: () => void;
  disabled?: boolean;
}

interface EditState {
  id: string;
  displayName: string;
  ordinal: string;
}

interface AddFormState {
  id: string;
  displayName: string;
  parent: string; // "" means root
  ordinal: string;
}

const EMPTY_ADD: AddFormState = { id: "", displayName: "", parent: "", ordinal: "0" };

export function DimensionManagerPanel({
  dimensionsByName,
  onChanged,
  disabled,
}: Props) {
  const styles = useStyles();
  const [selectedDim, setSelectedDim] = useState<DimName>("account");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DimMemberInfo | null>(null);
  const [addForm, setAddForm] = useState<AddFormState>(EMPTY_ADD);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const members = dimensionsByName[selectedDim] ?? [];
  const tree = buildTree(members);

  function reset() {
    setEditing(null);
    setPendingDelete(null);
    setAddForm(EMPTY_ADD);
  }

  async function onAdd() {
    if (!addForm.id.trim()) {
      setStatus({ kind: "error", message: "Member id is required." });
      return;
    }
    setBusy(true);
    try {
      const ord = Number.parseInt(addForm.ordinal, 10);
      await addDimMember(selectedDim, {
        request_id: newRequestId(),
        id: addForm.id.trim(),
        display_name: addForm.displayName.trim() || null,
        parent: addForm.parent || null,
        ordinal: Number.isFinite(ord) ? ord : 0,
        rollup_op: "sum",
      });
      setStatus({ kind: "ok", message: `Added ${addForm.id.trim()}.` });
      setAddForm(EMPTY_ADD);
      onChanged();
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(m: DimMemberInfo) {
    setEditing({
      id: m.id,
      displayName: m.display_name ?? "",
      ordinal: "0", // server doesn't expose ordinal in DimMemberInfo today
    });
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      const ord = Number.parseInt(editing.ordinal, 10);
      await updateDimMember(selectedDim, editing.id, {
        request_id: newRequestId(),
        display_name: editing.displayName.trim() || null,
        ordinal: Number.isFinite(ord) ? ord : null,
      });
      setStatus({ kind: "ok", message: `Updated ${editing.id}.` });
      setEditing(null);
      onChanged();
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setBusy(true);
    try {
      const resp = await deleteDimMember(selectedDim, id, newRequestId());
      const cascaded = resp.descendants_deleted.length > 0
        ? ` (also removed: ${resp.descendants_deleted.join(", ")})`
        : "";
      setStatus({ kind: "ok", message: `Deleted ${id}${cascaded}.` });
      setPendingDelete(null);
      onChanged();
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <Field label="Dimension">
        <Dropdown
          value={selectedDim}
          selectedOptions={[selectedDim]}
          disabled={disabled || busy}
          onOptionSelect={(_e, data) => {
            if (data.optionValue) {
              setSelectedDim(data.optionValue as DimName);
              reset();
              setStatus({ kind: "idle" });
            }
          }}
        >
          {DIM_NAMES.map((d) => (
            <Option key={d} value={d} text={d}>{d}</Option>
          ))}
        </Dropdown>
      </Field>

      <div className={styles.tree}>
        {tree.length === 0 && (
          <Text className={styles.hint} style={{ padding: 8 }}>
            No members yet. Add one below.
          </Text>
        )}
        {tree.map((n) => {
          const m = members.find((x) => x.id === n.id);
          if (!m) return null;
          const indent = `calc(${tokens.spacingHorizontalM} * ${n.depth})`;
          return (
            <div key={n.id} className={styles.treeRow}>
              <Text
                className={styles.treeLabel}
                style={{ paddingInlineStart: indent }}
                title={n.id}
              >
                {memberLabelFromInfo(m)}
                {m.display_name && (
                  <span className={styles.alias}>({m.id})</span>
                )}
              </Text>
              <Button
                size="small"
                appearance="subtle"
                icon={<Edit20Regular />}
                aria-label={`Edit ${n.id}`}
                disabled={disabled || busy}
                onClick={() => startEdit(m)}
              />
              <Button
                size="small"
                appearance="subtle"
                icon={<Delete20Regular />}
                aria-label={`Delete ${n.id}`}
                disabled={disabled || busy}
                onClick={() => setPendingDelete(m)}
              />
            </div>
          );
        })}
      </div>

      <Accordion collapsible>
        <AccordionItem value="add">
          <AccordionHeader>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Add20Regular />
              <span>Add member to {selectedDim}</span>
            </span>
          </AccordionHeader>
          <AccordionPanel>
            <div className={styles.addForm}>
              <Field label="Id (immutable)">
                <Input
                  value={addForm.id}
                  onChange={(_, d) => setAddForm((f) => ({ ...f, id: d.value }))}
                  disabled={busy}
                  placeholder="e.g. 6000_Marketing"
                />
              </Field>
              <Field label="Display name (optional)">
                <Input
                  value={addForm.displayName}
                  onChange={(_, d) => setAddForm((f) => ({ ...f, displayName: d.value }))}
                  disabled={busy}
                  placeholder="(falls back to id)"
                />
              </Field>
              <Field label="Parent (optional)">
                <Dropdown
                  value={addForm.parent || "(none)"}
                  selectedOptions={[addForm.parent || "__none__"]}
                  disabled={busy}
                  onOptionSelect={(_e, data) => {
                    const v = data.optionValue;
                    if (!v) return;
                    setAddForm((f) => ({ ...f, parent: v === "__none__" ? "" : v }));
                  }}
                >
                  <Option key="__none__" value="__none__" text="(none)">(none)</Option>
                  {members.map((m) => (
                    <Option key={m.id} value={m.id} text={memberLabelFromInfo(m)}>
                      {memberLabelFromInfo(m)}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="Ordinal">
                <Input
                  type="number"
                  value={addForm.ordinal}
                  onChange={(_, d) => setAddForm((f) => ({ ...f, ordinal: d.value }))}
                  disabled={busy}
                />
              </Field>
              <Button
                appearance="primary"
                icon={<Add20Regular />}
                onClick={onAdd}
                disabled={busy || !addForm.id.trim()}
              >
                {busy ? "Working…" : "Add member"}
              </Button>
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      <StatusBar status={status} showLoading={false} />

      {/* Edit dialog */}
      <Dialog
        open={editing !== null}
        onOpenChange={(_e, data) => {
          if (!data.open && !busy) setEditing(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Edit {editing?.id}</DialogTitle>
            <DialogContent>
              {editing && (
                <div className={styles.editFields}>
                  <Field label="Display name">
                    <Input
                      value={editing.displayName}
                      onChange={(_, d) =>
                        setEditing({ ...editing, displayName: d.value })
                      }
                      placeholder="(falls back to id)"
                      disabled={busy}
                    />
                  </Field>
                  <Field
                    label="Ordinal"
                    hint="Sort position within the parent"
                  >
                    <Input
                      type="number"
                      value={editing.ordinal}
                      onChange={(_, d) =>
                        setEditing({ ...editing, ordinal: d.value })
                      }
                      disabled={busy}
                    />
                  </Field>
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={saveEdit}
                disabled={busy}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete member?"
        body={
          <Text>
            Permanently remove <strong>{pendingDelete?.id}</strong>
            {pendingDelete?.display_name &&
              ` (${pendingDelete.display_name})`}
            ? Descendants are also removed. The delete is rejected if any
            facts reference this member.
          </Text>
        }
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
