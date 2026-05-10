import { useEffect, useMemo, useState } from "react";
import type { Table } from "dexie";
import { db } from "../persist/db";

/**
 * Read-only inspector overlay for the Voyage IndexedDB store. Lists every
 * table with row counts on the left, renders the rows of the selected table
 * on the right (most-recent first), and lets you expand any row to see its
 * full JSON. Designed for "did the cache actually populate?" sanity checks
 * during development — not a full DBA tool.
 *
 * Built on Dexie's public API so it works against the live `db` instance and
 * picks up writes the next time you click Refresh.
 */
type Props = {
  onClose: () => void;
};

type TableSpec = {
  name: string;
  table: Table<unknown, unknown>;
  /** Field names to surface in the collapsed row header, left to right. */
  summary: string[];
  /** Field name to sort rows by, descending. Optional. */
  sortBy?: string;
  /** Render hint: tile images get a thumbnail; everything else is plain JSON. */
  variant?: "default" | "image";
};

const TABLE_SPECS: TableSpec[] = [
  {
    name: "transcript",
    table: db.transcript as unknown as Table<unknown, unknown>,
    summary: ["model", "promptHash", "generatedAt"],
    sortBy: "generatedAt",
  },
  {
    name: "sceneSpecs",
    table: db.sceneSpecs as unknown as Table<unknown, unknown>,
    summary: ["scope", "ids", "source", "generatedAt"],
    sortBy: "generatedAt",
  },
  {
    name: "tileImages",
    table: db.tileImages as unknown as Table<unknown, unknown>,
    summary: ["key", "source", "width", "height", "generatedAt"],
    sortBy: "generatedAt",
    variant: "image",
  },
  {
    name: "expansionEntities",
    table: db.expansionEntities as unknown as Table<unknown, unknown>,
    summary: ["entityType", "entityId"],
  },
  {
    name: "quarantine",
    table: db.quarantine as unknown as Table<unknown, unknown>,
    summary: ["entityType", "quarantineId", "failedAt"],
    sortBy: "failedAt",
  },
  {
    name: "saves",
    table: db.saves as unknown as Table<unknown, unknown>,
    summary: ["saveId", "configHash", "updatedAt"],
    sortBy: "updatedAt",
  },
  {
    name: "meta",
    table: db.meta as unknown as Table<unknown, unknown>,
    summary: ["key"],
  },
];

const PREVIEW_LIMIT = 100;

export function DbInspector({ onClose }: Props) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string>("transcript");
  const [rows, setRows] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const selectedSpec = useMemo(
    () => TABLE_SPECS.find((s) => s.name === selected) ?? TABLE_SPECS[0],
    [selected],
  );

  // Refresh row counts for every table whenever the inspector opens or the
  // user hits Refresh. Cheap because Dexie counts use the index.
  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      const next: Record<string, number> = {};
      for (const spec of TABLE_SPECS) {
        try {
          next[spec.name] = await spec.table.count();
        } catch {
          next[spec.name] = -1;
        }
      }
      if (!cancelled) setCounts(next);
    }
    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  // Load rows for the currently-selected table. Limited to PREVIEW_LIMIT for
  // tables with potentially huge row counts (transcript on big worlds).
  useEffect(() => {
    let cancelled = false;
    async function loadRows() {
      setLoading(true);
      setExpanded(new Set());
      try {
        const all = (await selectedSpec.table.toArray()) as Record<string, unknown>[];
        const sorted = selectedSpec.sortBy
          ? [...all].sort((a, b) => {
              const av = (a[selectedSpec.sortBy!] ?? 0) as number;
              const bv = (b[selectedSpec.sortBy!] ?? 0) as number;
              return bv - av;
            })
          : all;
        const limited = sorted.slice(0, PREVIEW_LIMIT);
        if (!cancelled) setRows(limited);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadRows();
    return () => {
      cancelled = true;
    };
  }, [selected, selectedSpec, refreshTick]);

  function toggleExpanded(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__inner dbInspector"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>DB Inspector</h2>
          <div className="dbInspector__headerActions">
            <button type="button" onClick={() => setRefreshTick((n) => n + 1)}>
              Refresh
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="dbInspector__body">
          <aside className="dbInspector__rail">
            {TABLE_SPECS.map((spec) => {
              const count = counts[spec.name];
              const active = spec.name === selected;
              return (
                <button
                  key={spec.name}
                  type="button"
                  className={
                    active ? "dbInspector__tableBtn active" : "dbInspector__tableBtn"
                  }
                  onClick={() => setSelected(spec.name)}
                >
                  <span className="dbInspector__tableName">{spec.name}</span>
                  <span className="dbInspector__tableCount">
                    {count === undefined ? "…" : count === -1 ? "err" : count}
                  </span>
                </button>
              );
            })}
          </aside>
          <main className="dbInspector__rows">
            {loading ? (
              <div className="dbInspector__empty">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="dbInspector__empty">
                No rows in <code>{selected}</code>.
              </div>
            ) : (
              <>
                <div className="dbInspector__rowsHeader">
                  Showing {rows.length}
                  {(counts[selected] ?? 0) > rows.length
                    ? ` of ${counts[selected]}`
                    : ""}
                  {selectedSpec.sortBy
                    ? ` (sorted by ${selectedSpec.sortBy} desc)`
                    : ""}
                </div>
                <ul className="dbInspector__rowList">
                  {rows.map((row, index) => (
                    <RowItem
                      key={index}
                      row={row as Record<string, unknown>}
                      spec={selectedSpec}
                      expanded={expanded.has(index)}
                      onToggle={() => toggleExpanded(index)}
                    />
                  ))}
                </ul>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

type RowItemProps = {
  row: Record<string, unknown>;
  spec: TableSpec;
  expanded: boolean;
  onToggle: () => void;
};

function RowItem({ row, spec, expanded, onToggle }: RowItemProps) {
  const summary = useMemo(() => buildSummary(row, spec.summary), [row, spec.summary]);
  const fullJson = useMemo(() => stringifyForDisplay(row), [row]);
  const thumbnailUrl = useMemo(() => {
    if (spec.variant !== "image") return null;
    return buildImageThumbnail(row);
  }, [row, spec.variant]);

  return (
    <li className="dbInspector__row">
      <button
        type="button"
        className="dbInspector__rowSummary"
        onClick={onToggle}
      >
        <span className="dbInspector__rowToggle">{expanded ? "▾" : "▸"}</span>
        <span className="dbInspector__rowFields">{summary}</span>
      </button>
      {expanded ? (
        <div className="dbInspector__rowDetail">
          {thumbnailUrl ? (
            <img
              className="dbInspector__thumb"
              src={thumbnailUrl}
              alt={String(row.key ?? "tile")}
            />
          ) : null}
          <pre className="dbInspector__json">{fullJson}</pre>
        </div>
      ) : null}
    </li>
  );
}

function buildSummary(row: Record<string, unknown>, keys: string[]): string {
  const parts: string[] = [];
  for (const key of keys) {
    const value = row[key];
    if (value === undefined) continue;
    parts.push(`${key}=${formatSummaryValue(key, value)}`);
  }
  return parts.length > 0 ? parts.join("  ·  ") : "(row)";
}

function formatSummaryValue(key: string, value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (
      key === "generatedAt" ||
      key === "updatedAt" ||
      key === "createdAt" ||
      key === "failedAt"
    ) {
      return new Date(value).toISOString().replace("T", " ").slice(0, 19);
    }
    return String(value);
  }
  if (typeof value === "string") {
    return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  }
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(value).slice(0, 40);
}

/**
 * Custom replacer for JSON.stringify that:
 *   1. Truncates very long strings (system prompts can be 4-5kB);
 *   2. Replaces Uint8Array byte buffers with a `<bytes len=N>` stub so the
 *      texture rows don't blow up the panel.
 * Falls back to plain JSON for normal fields.
 */
function stringifyForDisplay(row: Record<string, unknown>): string {
  return JSON.stringify(
    row,
    (_key, value) => {
      if (value instanceof Uint8Array) {
        return `<bytes len=${value.length}>`;
      }
      if (typeof value === "string" && value.length > 800) {
        return `${value.slice(0, 800)}… [truncated, full length ${value.length}]`;
      }
      return value;
    },
    2,
  );
}

/**
 * Build a `data:` URL from a stored tile-image row so we can preview generated
 * tiles in-line. Returns null if the row doesn't look like a tile image.
 */
function buildImageThumbnail(row: Record<string, unknown>): string | null {
  const bytes = row.bytes;
  const mime = (row.mime as string | undefined) ?? "image/png";
  if (!(bytes instanceof Uint8Array)) return null;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return `data:${mime};base64,${b64}`;
}
