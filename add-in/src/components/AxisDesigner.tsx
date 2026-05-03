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
import { Text, makeStyles, tokens } from "@fluentui/react-components";
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
    gridTemplateColumns: "70px 1fr",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  laneLabel: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  laneBox: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    minHeight: "32px",
    padding: tokens.spacingHorizontalXS,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  laneBoxOver: {
    backgroundColor: tokens.colorNeutralBackground3Hover,
    border: `1px solid ${tokens.colorBrandStroke1}`,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    borderRadius: tokens.borderRadiusSmall,
    fontSize: tokens.fontSizeBase200,
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",
  },
  chipDragging: { opacity: 0.4 },
  pickerBlock: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalS,
  },
});

interface Props {
  filters: Record<DimName, string[]>;
  axes: AxisSpec;
  dimensionsByName: Partial<Record<DimName, DimMemberInfo[]>>;
  onFilterChange: (dim: DimName, next: string[]) => void;
  onAxesChange: (next: AxisSpec) => void;
  disabled?: boolean;
}

export function AxisDesigner({
  filters,
  axes,
  dimensionsByName,
  onFilterChange,
  onAxesChange,
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className={styles.root}>
        <LaneRow label="Rows" laneId="rows" dims={axes.rows} disabled={disabled} />
        <LaneRow label="Columns" laneId="cols" dims={axes.cols} disabled={disabled} />
        <LaneRow label="Page" laneId="page" dims={pageFilterDims(axes)} disabled={disabled} />

        <div className={styles.pickerBlock}>
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
      </div>
      <DragOverlay>
        {draggingDim ? <span className={styles.chip}>{draggingDim}</span> : null}
      </DragOverlay>
    </DndContext>
  );
}

interface LaneRowProps {
  label: string;
  laneId: Lane;
  dims: DimName[];
  disabled?: boolean;
}

function LaneRow({ label, laneId, dims, disabled }: LaneRowProps) {
  const styles = useStyles();
  const { isOver, setNodeRef } = useDroppable({ id: `lane:${laneId}` });
  const klass = `${styles.laneBox}${isOver ? ` ${styles.laneBoxOver}` : ""}`;
  return (
    <div className={styles.laneRow}>
      <Text className={styles.laneLabel}>{label}</Text>
      <SortableContext items={dims} strategy={horizontalListSortingStrategy}>
        <div ref={setNodeRef} className={klass}>
          {dims.map((d) => (
            <Chip key={d} dim={d} disabled={disabled} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function Chip({ dim, disabled }: { dim: DimName; disabled?: boolean }) {
  const styles = useStyles();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dim, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const klass = `${styles.chip}${isDragging ? ` ${styles.chipDragging}` : ""}`;
  return (
    <span
      ref={setNodeRef}
      style={style}
      className={klass}
      {...attributes}
      {...listeners}
    >
      {dim}
    </span>
  );
}
