import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Switch,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Dismiss16Regular,
  ReOrderDotsVertical20Regular,
  Filter20Regular,
} from "@fluentui/react-icons";
import { DIM_NAMES, type DimName } from "../types/dims";
import type { DimMemberInfo } from "../types/generated";
import {
  type AxisSpec,
  type Lane,
  laneOf,
  moveDim,
  pageFilterDims,
  reorderInLane,
} from "../excel/axes";
import { MultiMemberPicker } from "./MultiMemberPicker";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  laneRow: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  laneLabel: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    minWidth: "60px",
  },
  laneBox: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    minHeight: "36px",
    padding: tokens.spacingHorizontalXS,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  laneBoxOver: {
    backgroundColor: tokens.colorNeutralBackground3Hover,
    border: `1px solid ${tokens.colorBrandStroke1}`,
  },
  laneEmptyHint: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase100,
    paddingLeft: tokens.spacingHorizontalXS,
    fontStyle: "italic",
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    paddingTop: tokens.spacingVerticalXXS,
    paddingBottom: tokens.spacingVerticalXXS,
    paddingLeft: "2px",
    paddingRight: "2px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    borderRadius: tokens.borderRadiusSmall,
    fontSize: tokens.fontSizeBase200,
    userSelect: "none",
    border: `1px solid ${tokens.colorBrandStroke2}`,
  },
  chipDragging: { opacity: 0.4 },
  chipHandle: {
    display: "inline-flex",
    cursor: "grab",
    color: tokens.colorBrandForeground2,
    touchAction: "none",
    padding: "1px",
    ":active": { cursor: "grabbing" },
  },
  chipLabel: {
    paddingRight: tokens.spacingHorizontalXS,
    paddingLeft: "2px",
  },
  chipRemove: {
    display: "inline-flex",
    alignItems: "center",
    background: "transparent",
    border: "none",
    padding: "2px",
    cursor: "pointer",
    color: tokens.colorBrandForeground2,
    borderRadius: tokens.borderRadiusSmall,
    ":hover": {
      backgroundColor: tokens.colorBrandBackground2Hover,
      color: tokens.colorBrandForeground1,
    },
  },
  filtersHeader: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  pickerStack: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalS,
  },
  drillRow: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    paddingTop: tokens.spacingVerticalXS,
  },
  drillHint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface Props {
  filters: Record<DimName, string[]>;
  axes: AxisSpec;
  dimensionsByName: Partial<Record<DimName, DimMemberInfo[]>>;
  onFilterChange: (dim: DimName, next: string[]) => void;
  onAxesChange: (next: AxisSpec) => void;
  drillRows: boolean;
  onDrillRowsChange: (next: boolean) => void;
  disabled?: boolean;
}

export function AxisDesigner({
  filters,
  axes,
  dimensionsByName,
  onFilterChange,
  onAxesChange,
  drillRows,
  onDrillRowsChange,
  disabled,
}: Props) {
  const styles = useStyles();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [draggingDim, setDraggingDim] = useState<DimName | null>(null);

  function onDragStart(e: DragStartEvent) {
    setDraggingDim(e.active.id as DimName);
  }

  function onDragEnd(e: DragEndEvent) {
    setDraggingDim(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = active.id as DimName;
    const overId = String(over.id);

    if (overId.startsWith("lane:")) {
      const targetLane = overId.slice("lane:".length) as Lane;
      onAxesChange(moveDim(axes, activeId, targetLane));
      return;
    }

    const overDim = overId as DimName;
    if (activeId === overDim) return;
    const sourceLane = laneOf(axes, activeId);
    const targetLane = laneOf(axes, overDim);

    if (
      sourceLane === targetLane &&
      (sourceLane === "rows" || sourceLane === "cols")
    ) {
      const list = axes[sourceLane];
      const toIdx = list.indexOf(overDim);
      if (toIdx >= 0) onAxesChange(reorderInLane(axes, sourceLane, activeId, toIdx));
      return;
    }

    onAxesChange(moveDim(axes, activeId, targetLane));
  }

  function removeFromLane(dim: DimName, fromLane: Lane) {
    if (fromLane === "page") return; // already on page = no-op
    onAxesChange(moveDim(axes, dim, "page"));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className={styles.root}>
        <LaneRow
          label="Rows"
          laneId="rows"
          dims={axes.rows}
          disabled={disabled}
          emptyHint="drop dims here"
          onRemove={removeFromLane}
        />
        <LaneRow
          label="Columns"
          laneId="cols"
          dims={axes.cols}
          disabled={disabled}
          emptyHint="drop dims here"
          onRemove={removeFromLane}
        />
        <LaneRow
          label="Page"
          laneId="page"
          dims={pageFilterDims(axes)}
          disabled={disabled}
          removable={false}
          onRemove={removeFromLane}
        />

        <DrillToggle
          axes={axes}
          drillRows={drillRows}
          onDrillRowsChange={onDrillRowsChange}
          disabled={disabled}
        />

        <Accordion collapsible defaultOpenItems={["filters"]}>
          <AccordionItem value="filters">
            <AccordionHeader>
              <span className={styles.filtersHeader}>
                <Filter20Regular />
                <span>Filters</span>
              </span>
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.pickerStack}>
                {DIM_NAMES.map((d) => (
                  <MultiMemberPicker
                    key={d}
                    label={d}
                    members={dimensionsByName[d] ?? []}
                    selected={filters[d] ?? []}
                    onChange={(next) => onFilterChange(d, next)}
                    disabled={disabled}
                  />
                ))}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>
      <DragOverlay>
        {draggingDim ? (
          <span className={styles.chip}>
            <span className={styles.chipHandle}>
              <ReOrderDotsVertical20Regular />
            </span>
            <span className={styles.chipLabel}>{draggingDim}</span>
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

interface LaneRowProps {
  label: string;
  laneId: Lane;
  dims: DimName[];
  disabled?: boolean;
  emptyHint?: string;
  removable?: boolean;
  onRemove: (dim: DimName, fromLane: Lane) => void;
}

function LaneRow({
  label,
  laneId,
  dims,
  disabled,
  emptyHint,
  removable = true,
  onRemove,
}: LaneRowProps) {
  const styles = useStyles();
  const { isOver, setNodeRef } = useDroppable({ id: `lane:${laneId}` });
  const klass = mergeClasses(styles.laneBox, isOver && styles.laneBoxOver);
  return (
    <div className={styles.laneRow}>
      <Text className={styles.laneLabel}>{label}</Text>
      <SortableContext items={dims} strategy={horizontalListSortingStrategy}>
        <div ref={setNodeRef} className={klass}>
          {dims.length === 0 && emptyHint && (
            <Text className={styles.laneEmptyHint}>{emptyHint}</Text>
          )}
          {dims.map((d) => (
            <Chip
              key={d}
              dim={d}
              disabled={disabled}
              removable={removable}
              onRemove={() => onRemove(d, laneId)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

interface ChipProps {
  dim: DimName;
  disabled?: boolean;
  removable: boolean;
  onRemove: () => void;
}

interface DrillToggleProps {
  axes: AxisSpec;
  drillRows: boolean;
  onDrillRowsChange: (next: boolean) => void;
  disabled?: boolean;
}

/**
 * Toggle for "drill into row hierarchy". Only meaningful for single-dim
 * Rows axis (multi-dim stacking + drill is out of scope for v1 — the
 * post-order traversal would be ambiguous across multiple dim hierarchies).
 *
 * When on, App.tsx expands the row dim's filter to include each selected
 * member's full subtree on the next Refresh. The pivot emits rows in
 * post-order with depth info; refresh.ts applies Excel native row outline
 * grouping (the +/− gutter) so the user can collapse/expand subtrees in
 * Excel directly.
 */
function DrillToggle({
  axes,
  drillRows,
  onDrillRowsChange,
  disabled,
}: DrillToggleProps) {
  const styles = useStyles();
  const supported = axes.rows.length === 1;
  const hint = !supported
    ? axes.rows.length === 0
      ? "Drill needs a dim on Rows."
      : "Drill needs a single-dim Rows axis. Move all but one back to Page."
    : drillRows
      ? "Each selected parent expands to its subtree. Use Excel's +/− gutter to collapse."
      : "Show parents alongside their children with Excel +/− grouping.";
  return (
    <div className={styles.drillRow}>
      <Switch
        checked={supported && drillRows}
        disabled={disabled || !supported}
        onChange={(_e, data) => onDrillRowsChange(Boolean(data.checked))}
        label="Drill into row hierarchy"
      />
      <Text className={styles.drillHint}>{hint}</Text>
    </div>
  );
}

function Chip({ dim, disabled, removable, onRemove }: ChipProps) {
  const styles = useStyles();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dim, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const klass = mergeClasses(styles.chip, isDragging && styles.chipDragging);
  return (
    <span ref={setNodeRef} style={style} className={klass} {...attributes}>
      <span className={styles.chipHandle} {...listeners} aria-label={`Drag ${dim}`}>
        <ReOrderDotsVertical20Regular />
      </span>
      <span className={styles.chipLabel}>{dim}</span>
      {removable && (
        <button
          type="button"
          className={styles.chipRemove}
          aria-label={`Remove ${dim} from this lane`}
          disabled={disabled}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Dismiss16Regular />
        </button>
      )}
    </span>
  );
}
