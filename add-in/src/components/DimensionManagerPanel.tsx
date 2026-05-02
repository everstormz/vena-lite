import { useState } from "react";
import {
  Button,
  Dropdown,
  Field,
  Input,
  Option,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  addDimMember,
  deleteDimMember,
  newRequestId,
  updateDimMember,
} from "../api/client";
import type { DimMemberInfo } from "../types/generated";
import { DIM_NAMES, type DimName } from "../types/dims";
import { buildTree, memberLabelFromInfo } from "../excel/dim_tree";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    maxHeight: "240px",
    overflowY: "auto",
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyMonospace,
  },
  treeRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  treeLabel: { flex: 1 },
  editRow: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    paddingLeft: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground3,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
  },
  addForm: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  status: { color: tokens.colorNeutralForeground2, minHeight: "1.4em" },
  error: { color: tokens.colorPaletteRedForeground1 },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

const NBSP_INDENT = "  ";

interface Props {
  dimensionsByName: Partial<Record<DimName, DimMemberInfo[]>>;
  onChanged: () => void;
  disabled?: boolean;
}

interface EditState {
  displayName: string;
  ordinal: string;
}

interface AddFormState {
  id: string;
  displayName: string;
  parent: string;  // "" means root
  ordinal: string;
}

const EMPTY_ADD: AddFormState = { id: "", displayName: "", parent: "", ordinal: "0" };

type Status = { kind: "ok" | "error"; msg: string } | null;

export function DimensionManagerPanel({
  dimensionsByName,
  onChanged,
  disabled,
}: Props) {
  const styles = useStyles();
  const [selectedDim, setSelectedDim] = useState<DimName>("account");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ displayName: "", ordinal: "0" });
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<AddFormState>(EMPTY_ADD);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const members = dimensionsByName[selectedDim] ?? [];
  const tree = buildTree(members);

  function reset() {
    setEditingId(null);
    setPendingDelete(null);
    setAddForm(EMPTY_ADD);
  }

  function clearStatusSoon() {
    setStatus(null);
  }

  async function onAdd() {
    if (!addForm.id.trim()) {
      setStatus({ kind: "error", msg: "Member id is required." });
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
      setStatus({ kind: "ok", msg: `Added ${addForm.id.trim()}.` });
      setAddForm(EMPTY_ADD);
      onChanged();
    } catch (err) {
      setStatus({ kind: "error", msg: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(m: DimMemberInfo) {
    setEditingId(m.id);
    setEditState({
      displayName: m.display_name ?? "",
      ordinal: "0", // server doesn't expose ordinal in DimMemberInfo today; user can re-set
    });
    setPendingDelete(null);
    clearStatusSoon();
  }

  async function saveEdit(id: string) {
    setBusy(true);
    try {
      const ord = Number.parseInt(editState.ordinal, 10);
      await updateDimMember(selectedDim, id, {
        request_id: newRequestId(),
        display_name: editState.displayName.trim() || null,
        ordinal: Number.isFinite(ord) ? ord : null,
      });
      setStatus({ kind: "ok", msg: `Updated ${id}.` });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setStatus({ kind: "error", msg: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(id: string) {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      setStatus({ kind: "ok", msg: `Click Delete again to confirm removal of ${id}.` });
      return;
    }
    setBusy(true);
    try {
      const resp = await deleteDimMember(selectedDim, id, newRequestId());
      const cascaded = resp.descendants_deleted.length > 0
        ? ` (also removed: ${resp.descendants_deleted.join(", ")})`
        : "";
      setStatus({ kind: "ok", msg: `Deleted ${id}${cascaded}.` });
      setPendingDelete(null);
      onChanged();
    } catch (err) {
      setStatus({ kind: "error", msg: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <Field label="Dim">
        <Dropdown
          value={selectedDim}
          selectedOptions={[selectedDim]}
          disabled={disabled || busy}
          onOptionSelect={(_e, data) => {
            if (data.optionValue) {
              setSelectedDim(data.optionValue as DimName);
              reset();
              clearStatusSoon();
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
          <Text className={styles.hint}>No members yet. Add one below.</Text>
        )}
        {tree.map((n) => {
          const isEditing = editingId === n.id;
          const m = members.find((x) => x.id === n.id);
          if (!m) return null;
          const aliasSuffix = m.display_name ? ` (${n.id})` : "";
          return (
            <div key={n.id}>
              <div className={styles.treeRow}>
                <Text className={styles.treeLabel}>
                  {NBSP_INDENT.repeat(n.depth)}{memberLabelFromInfo(m)}{aliasSuffix}
                </Text>
                {!isEditing && (
                  <>
                    <Button
                      size="small"
                      appearance="subtle"
                      disabled={disabled || busy}
                      onClick={() => startEdit(m)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="small"
                      appearance={pendingDelete === n.id ? "primary" : "subtle"}
                      disabled={disabled || busy}
                      onClick={() => confirmDelete(n.id)}
                    >
                      {pendingDelete === n.id ? "Confirm" : "Delete"}
                    </Button>
                  </>
                )}
              </div>
              {isEditing && (
                <div className={styles.editRow}>
                  <Field label="Display name">
                    <Input
                      value={editState.displayName}
                      onChange={(_, d) =>
                        setEditState((s) => ({ ...s, displayName: d.value }))
                      }
                      placeholder="(falls back to id)"
                      disabled={busy}
                    />
                  </Field>
                  <Field label="Ordinal">
                    <Input
                      type="number"
                      value={editState.ordinal}
                      onChange={(_, d) =>
                        setEditState((s) => ({ ...s, ordinal: d.value }))
                      }
                      disabled={busy}
                    />
                  </Field>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      appearance="primary"
                      onClick={() => saveEdit(n.id)}
                      disabled={busy}
                    >
                      Save
                    </Button>
                    <Button
                      appearance="secondary"
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.addForm}>
        <Text className={styles.hint}>Add member to {selectedDim}:</Text>
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
          onClick={onAdd}
          disabled={busy || !addForm.id.trim()}
        >
          {busy ? "Working…" : "Add"}
        </Button>
      </div>

      {status && (
        <Text className={status.kind === "error" ? styles.error : styles.status}>
          {status.kind === "error" ? `Error: ${status.msg}` : status.msg}
        </Text>
      )}
    </div>
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
