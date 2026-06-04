"use client";

import React from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  LineChart,
  Line,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ComposedChart,
  Rectangle,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { ChartTab } from "@/lib/store/visualization-slice";
import { useForestStore } from "@/lib/store";
import { displayOp } from "@/lib/i18n";

// Format number with space as thousand separator (Finnish/SI convention: 10 000)
function formatNumber(value: number): string {
  return Math.abs(value)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0"); // non-breaking space
}

// Backwards-compatible alias for euro formatting
function formatEuro(value: number): string {
  const formatted = formatNumber(value);
  return value < 0 ? `−${formatted}` : formatted;
}

// Format pie/donut slice label with appropriate unit suffix
function formatPieLabel(yKey: string | null | undefined, name: string, value: number): string {
  if (isEuroKey(yKey)) return `${name}: ${formatEuro(value)} €`;
  if (isVolumeKey(yKey)) return `${name}: ${formatNumber(value)} m³`;
  if (isAreaKey(yKey)) return `${name}: ${formatNumber(value)} ha`;
  return `${name}: ${Number.isInteger(value) ? value : value.toFixed(1)}`;
}

// Detect if a key likely holds euro values by name heuristics
function isEuroKey(key: string | null | undefined): boolean {
  if (!key) return false;
  const lower = key.toLowerCase();
  return lower.includes("euro") || lower.includes("eur") || lower.includes("income") || lower.includes("cost") || lower.includes("revenue") || lower.includes("price");
}

// Detect if a key likely holds volume (m³) values
function isVolumeKey(key: string | null | undefined): boolean {
  if (!key) return false;
  const lower = key.toLowerCase();
  return lower.includes("m3") || lower.includes("m³") || lower.includes("volume");
}

// Detect if a key likely holds area (ha) values
function isAreaKey(key: string | null | undefined): boolean {
  if (!key) return false;
  const lower = key.toLowerCase();
  return lower.includes("ha") || lower.includes("area") || lower.includes("hectare");
}

// Detect if a key likely holds count or percentage values
function isCountOrPctKey(key: string | null | undefined): boolean {
  if (!key) return false;
  const lower = key.toLowerCase();
  return lower === "count" || lower === "n" || lower.includes("pct") || lower.includes("percent") || lower.includes("%");
}

// Detect if a key is numeric and should be formatted with thousand separators
function isNumericKey(key: string | null | undefined): boolean {
  return isEuroKey(key) || isVolumeKey(key) || isAreaKey(key);
}

// Get appropriate axis label for a key's unit
function getAxisLabel(key: string | null | undefined): { value: string; position: "insideTopLeft"; offset: number; style: { fontSize: number; fill: string } } | undefined {
  if (isEuroKey(key)) return EURO_AXIS_LABEL;
  if (isVolumeKey(key)) return { value: "m³", position: "insideTopLeft", offset: -4, style: { fontSize: 11, fill: "#6b7280" } };
  if (isAreaKey(key)) return { value: "ha", position: "insideTopLeft", offset: -4, style: { fontSize: 11, fill: "#6b7280" } };
  return undefined;
}

// Detect if a key likely holds year values
function isYearKey(key: string | null | undefined): boolean {
  return key?.toLowerCase() === "year" || key?.toLowerCase() === "vuosi";
}

// Custom tooltip that formats currency values with thousand separators
// Uses CSS variables for dark mode support
function EuroTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !payload) return null;
  return (
    <div style={{
      backgroundColor: "var(--background, #ffffff)",
      border: "1px solid var(--color-border, #e5e7eb)",
      borderRadius: "6px",
      padding: "8px 12px",
      fontSize: "13px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      color: "var(--foreground, #171717)",
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--foreground, #171717)" }}>{String(label)}</div>
      {(payload as Array<Record<string, unknown>>)
        .filter((entry) => (entry.dataKey as string) !== "_wfBase")
        .map((entry, i) => {
        const val = entry.value as number;
        const name = entry.name as string;
        const color = entry.color as string;
        if (val === undefined || val === null) return null;
        return (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, display: "inline-block" }} />
            <span style={{ color: "var(--foreground, #171717)" }}>{name}:</span>
            <span style={{ fontWeight: 500, color: "var(--foreground, #171717)" }}>
              {isEuroKey(name) || isEuroKey(entry.dataKey as string)
                ? `${formatEuro(val)} €`
                : isVolumeKey(name) || isVolumeKey(entry.dataKey as string)
                  ? `${formatNumber(val)} m³`
                  : isAreaKey(name) || isAreaKey(entry.dataKey as string)
                    ? `${formatNumber(val)} ha`
                    : isNumericKey(name) || isNumericKey(entry.dataKey as string)
                      ? formatNumber(val)
                      : typeof val === "number" && !Number.isInteger(val)
                        ? val.toFixed(1)
                        : String(val)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const EURO_AXIS_LABEL = { value: "€", position: "insideTopLeft" as const, offset: -4, style: { fontSize: 11, fill: "#6b7280" } };
const YEAR_AXIS_LABEL = { value: "Year", position: "insideBottomRight" as const, offset: -6, style: { fontSize: 11, fill: "#6b7280" } };

// Shared YAxis props: formats numbers with thousand separators and shows unit label.
// Usage: <YAxis {...yAxisProps(tab.yKey)} />
function yAxisProps(yKey: string | null | undefined, yKey2?: string | null) {
  const anyEuro = isEuroKey(yKey) || isEuroKey(yKey2);
  const anyNumeric = isNumericKey(yKey) || isNumericKey(yKey2);
  return {
    tick: { fontSize: 12 as const },
    tickFormatter: (v: number) => {
      if (anyEuro) return formatEuro(v);
      if (anyNumeric || isVolumeKey(yKey) || isAreaKey(yKey)) return formatNumber(v);
      if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(1);
      return String(v);
    },
    label: getAxisLabel(yKey) ?? getAxisLabel(yKey2),
  };
}

const CHART_COLORS = [
  "#4CAF50",
  "#2196F3",
  "#FF9800",
  "#E91E63",
  "#9C27B0",
  "#00BCD4",
  "#FF5722",
  "#607D8B",
  "#8BC34A",
  "#03A9F4",
  "#FFC107",
  "#795548",
];

function WaterfallBar(props: Record<string, unknown>) {
  const { fill: _fill, value, payload, dataKey, ...rest } = props;
  // In stacked bars Recharts passes absolute segment height as "value".
  // Use the original payload to get the real (possibly negative) number.
  const actualValue = payload && dataKey
    ? (payload as Record<string, unknown>)[dataKey as string]
    : value;
  const barColor =
    typeof actualValue === "number" && Number(actualValue) < 0 ? "#E53935" : "#4CAF50";
  return <Rectangle {...rest} fill={barColor} />;
}

/** Transform flat data into waterfall format: each row gets a "base" (where
 *  the bar starts) computed from the cumulative sum of all previous values.
 *  The visible bar ("yKey") stacks on top of the invisible "base" bar.
 *  When waterfallBase is set, prepends a synthetic "Start" row with that value. */
function buildWaterfallData(
  data: Record<string, unknown>[],
  yKey: string,
  waterfallBase?: number | null
): Record<string, unknown>[] {
  let cumulative = waterfallBase ?? 0;
  const result: Record<string, unknown>[] = [];

  // Prepend synthetic starting row when base is non-zero
  if (waterfallBase && waterfallBase !== 0) {
    result.push({
      _wfLabel: "Start",
      [yKey]: waterfallBase,
      _wfBase: 0,
    });
  }

  for (const row of data) {
    const val = (row[yKey] as number) ?? 0;
    const wfRow = {
      ...row,
      _wfBase: cumulative,
      [yKey]: val,
    };
    cumulative += val;
    result.push(wfRow);
  }
  return result;
}

interface ChartCardProps {
  tab: ChartTab;
}

export default function ChartCard({ tab }: ChartCardProps) {
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const selectedYear = useForestStore((s) => s.selectedYear);
  const setSelectedYear = useForestStore((s) => s.setSelectedYear);
  const setHighlightedStands = useForestStore((s) => s.setHighlightedStands);
  const language = useForestStore((s) => s.language) ?? "en";

  // Handle click on chart element — uses _stand_ids for cross-highlighting.
  // Toggle semantics prevent selection loops: clicking a bar whose stands
  // are already selected deselects them; clicking a different bar replaces
  // the selection. This way no accumulation cascade can build up.
  const handleChartClick = (data: Record<string, unknown> | undefined) => {
    if (!data) return;

    // If data has _stand_ids, use them for multi-selection (works for ALL chart types)
    const standIds = data["_stand_ids"] as string[] | undefined;
    if (standIds && standIds.length > 0) {
      // Toggle: if all stands from this bar are already selected, deselect.
      // Otherwise select exactly these stands (replaces previous selection).
      const current = useForestStore.getState().highlightedStandIds;
      const allSelected = standIds.length > 0 && standIds.every((id) => current.includes(id));
      setHighlightedStands(allSelected ? [] : standIds);
      return;
    }

    // Fallback: if x_key is "year" or similar, clicking filters by that value
    if (effectiveXKey && data[effectiveXKey] !== undefined) {
      const year = Number(data[effectiveXKey]);
      if (!isNaN(year) && year >= 2000 && year <= 2100) {
        setSelectedYear(selectedYear === year ? null : year);
      }
    }
  };

  // Fallback xKey: if null but data has "year" column, auto-detect it.
  // Prevents all years collapsing into one bar when AI omits x_key.
  const effectiveXKey = tab.xKey ?? (tab.data?.[0] && "year" in tab.data[0] ? "year" : null);

  // Translate operation type names in data for display (Finnish → English).
  // Applies to charts where xKey or nameKey corresponds to operation types.
  const translatedData = React.useMemo(() => {
    if (!tab.data?.length) return tab.data;
    const typeKeys = [effectiveXKey, tab.nameKey, tab.colorKey].filter(Boolean) as string[];
    if (typeKeys.length === 0) return tab.data;
    return tab.data.map((row) => {
      const translated: Record<string, unknown> = { ...row };
      for (const key of typeKeys) {
        if (row[key] && typeof row[key] === "string") {
          const en = displayOp(row[key] as string, language);
          if (en !== row[key]) translated[key] = en;
        }
      }
      return translated;
    });
  }, [tab.data, effectiveXKey, tab.nameKey, tab.colorKey]);

  // Filter out rows with null/undefined/"null" nameKey values for pie/donut charts.
  // Recharts Pie fails to render slices when nameKey resolves to null.
  // DB stores some nulls as the literal string "null".
  const cleanData = React.useMemo(() => {
    if (!translatedData?.length) return translatedData;
    const isPieLike = tab.type === "pie" || tab.type === "donut";
    if (!isPieLike || !tab.nameKey) return translatedData;
    const filtered = translatedData.filter((row) => {
      const v = row[tab.nameKey!];
      return v != null && v !== "null";
    });
    console.log("[ChartCard] donut/pie cleanData:", { type: tab.type, nameKey: tab.nameKey, yKey: tab.yKey, total: translatedData.length, filtered: filtered.length, sample: filtered.slice(0, 2) });
    return filtered;
  }, [translatedData, tab.type, tab.nameKey]);

  // Determine if a data point contains any of the highlighted stands.
  // Uses _stand_ids injected by the chart engine during aggregation.
  const isDataPointHighlighted = (entry: Record<string, unknown>): boolean => {
    if (highlightedStandIds.length === 0) return true;
    const standIds = entry["_stand_ids"] as string[] | undefined;
    if (!standIds || standIds.length === 0) return true; // no stand info → show all
    return standIds.some((id) => highlightedStandIds.includes(id));
  };

  // Choose fill based on active state
  const getCellFill = (index: number, baseColor?: string): string => {
    return baseColor ?? CHART_COLORS[index % CHART_COLORS.length];
  };

  // No data state — show a centered message
  if (!tab.data || tab.data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <div className="text-center">
          <p className="text-gray-400 dark:text-gray-500 text-sm font-medium">No data</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
            Run a query to populate this chart
          </p>
        </div>
      </div>
    );
  }

  switch (tab.type) {
    case "bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={translatedData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey={effectiveXKey ?? undefined}
              tick={{ fontSize: 12 }}
              label={isYearKey(effectiveXKey) ? YEAR_AXIS_LABEL : undefined}
            />
            <YAxis {...yAxisProps(tab.yKey)} />
            <Tooltip content={<EuroTooltip />} />
            <Bar
              dataKey={tab.yKey}
              fill="#4CAF50"
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
              radius={[4, 4, 0, 0]}
            >
              {translatedData.map((entry, index) => {
                const highlighted = isDataPointHighlighted(entry);
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={highlighted ? CHART_COLORS[index % CHART_COLORS.length] : "#e5e5e5"}
                    fillOpacity={highlighted ? 1 : 0.3}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );

    case "stacked_bar":
      // Pivot data: rows like [{year, type, income}] → [{year, "Clearcut": 120k, "Thinning": 34k}]
      // Operation type names are translated from Finnish → English for display.
      // When yKey2 is present, creates a dual-stack chart: income above zero,
      // costs below zero (cost values should be pre-negated via multiply: -1 in query_config).
      const pivotStacked = () => {
        if (!tab.colorKey) return { pivoted: tab.data, stackKeys: [tab.yKey], dual: false };

        const colorValues = new Set<string>();
        const pivotMap = new Map<string, Record<string, unknown>>();
        // Collect _stand_ids per pivot key for cross-highlighting
        const standIdSets = new Map<string, Set<string>>();
        const hasDual = !!(tab.yKey2); // income (yKey) + costs (yKey2)

        for (const row of tab.data) {
          const xVal = String(row[effectiveXKey ?? "x"] ?? "");
          const rawColorVal = String(row[tab.colorKey ?? ""] ?? "");
          const displayColorVal = displayOp(rawColorVal, language);
          colorValues.add(displayColorVal);
          if (!pivotMap.has(xVal)) {
            const entry: Record<string, unknown> = {};
            if (effectiveXKey) entry[effectiveXKey] = row[effectiveXKey];
            pivotMap.set(xVal, entry);
            standIdSets.set(xVal, new Set());
          }
          const entry = pivotMap.get(xVal)!;
          // Collect stand_ids from this row
          const sids = row["_stand_ids"] as string[] | undefined;
          if (sids) for (const sid of sids) standIdSets.get(xVal)!.add(sid);

          if (hasDual) {
            // Dual-stack: income above zero, costs below zero
            entry[`${displayColorVal}_Income`] =
              ((entry[`${displayColorVal}_Income`] as number) ?? 0) + (row[tab.yKey] as number ?? 0);
            entry[`${displayColorVal}_Cost`] =
              ((entry[`${displayColorVal}_Cost`] as number) ?? 0) + (row[tab.yKey2!] as number ?? 0);
          } else {
            // Single-stack (legacy)
            entry[displayColorVal] = row[tab.yKey];
          }
        }
        // Sort alphabetically for stable color assignment across recomputes
        const sorted = Array.from(colorValues).sort((a, b) => a.localeCompare(b));

        // Filter out zero-only categories (e.g., Clearcut has no cost, Mounding has no income)
        const pivotedArr = Array.from(pivotMap.values()).map((entry, i) => {
          const xKey = Array.from(pivotMap.keys())[i];
          entry["_stand_ids"] = Array.from(standIdSets.get(xKey) ?? []);
          return entry;
        });
        const skipIncome = new Set<string>();
        const skipCost = new Set<string>();
        if (hasDual) {
          for (const cat of sorted) {
            if (!pivotedArr.some((row) => ((row[`${cat}_Income`] as number) ?? 0) !== 0)) {
              skipIncome.add(cat);
            }
            if (!pivotedArr.some((row) => ((row[`${cat}_Cost`] as number) ?? 0) !== 0)) {
              skipCost.add(cat);
            }
          }
        }

        return {
          pivoted: pivotedArr,
          stackKeys: sorted,
          dual: hasDual,
          skipIncome,
          skipCost,
        };
      };
      const { pivoted, stackKeys, dual, skipIncome = new Set<string>(), skipCost = new Set<string>() } = pivotStacked();

      // Color palette for costs (warmer) vs income (greens/blues)
      const COST_COLORS = [
        "#E57373", "#F06292", "#FF8A65", "#BA68C8",
        "#EF5350", "#EC407A", "#FF7043", "#AB47BC",
        "#E53935", "#D81B60", "#F4511E", "#8E24AA",
      ];

      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={pivoted}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey={effectiveXKey ?? undefined}
              tick={{ fontSize: 12 }}
              label={isYearKey(effectiveXKey) ? YEAR_AXIS_LABEL : undefined}
            />
            <YAxis {...yAxisProps(tab.yKey, tab.yKey2)} />
            <Tooltip content={<EuroTooltip />} />
            <Legend />
            {dual
              ? stackKeys.flatMap((cat, i) => {
                  const bars: React.ReactElement[] = [];
                  if (!skipIncome.has(cat)) {
                    bars.push(
                      <Bar
                        key={`${cat}_Income`}
                        dataKey={`${cat}_Income`}
                        stackId="income"
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                        name={`${cat}`}
                        onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
                      >
                        {pivoted.map((entry, j) => (
                          <Cell
                            key={`inc-${j}`}
                            fillOpacity={isDataPointHighlighted(entry) ? 1 : 0.3}
                          />
                        ))}
                      </Bar>
                    );
                  }
                  if (!skipCost.has(cat)) {
                    bars.push(
                      <Bar
                        key={`${cat}_Cost`}
                        dataKey={`${cat}_Cost`}
                        stackId="cost"
                        fill={COST_COLORS[i % COST_COLORS.length]}
                        name={`${cat}`}
                        onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
                      >
                        {pivoted.map((entry, j) => (
                          <Cell
                            key={`cost-${j}`}
                            fillOpacity={isDataPointHighlighted(entry) ? 1 : 0.3}
                          />
                        ))}
                      </Bar>
                    );
                  }
                  return bars;
                })
              : stackKeys.map((key, i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
                  >
                    {pivoted.map((entry, j) => (
                      <Cell
                        key={`stk-${j}`}
                        fillOpacity={isDataPointHighlighted(entry) ? 1 : 0.3}
                      />
                    ))}
                  </Bar>
                ))}
          </BarChart>
        </ResponsiveContainer>
      );

    case "horizontal_bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={translatedData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              type="number"
              {...yAxisProps(tab.yKey)}
            />
            <YAxis
              dataKey={effectiveXKey ?? undefined}
              type="category"
              width={100}
              tick={{ fontSize: 12 }}
            />
            <Tooltip content={<EuroTooltip />} />
            <Bar
              dataKey={tab.yKey}
              fill="#FF9800"
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
              radius={[0, 4, 4, 0]}
            >
              {translatedData.map((entry, index) => {
                const highlighted = isDataPointHighlighted(entry);
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={highlighted ? CHART_COLORS[index % CHART_COLORS.length] : "#e5e5e5"}
                    fillOpacity={highlighted ? 1 : 0.3}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );

    case "pie":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={cleanData}
              dataKey={tab.yKey}
              nameKey={tab.nameKey ?? undefined}
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={({ name, value }) => formatPieLabel(tab.yKey, name ?? "", value as number)}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}

            >
              {cleanData.map((entry, i) => {
                const highlighted = isDataPointHighlighted(entry);
                return (
                  <Cell
                    key={i}
                    fill={highlighted ? getCellFill(i) : "#e5e5e5"}
                    opacity={highlighted ? 1 : 0.3}
                  />
                );
              })}
            </Pie>
            <Tooltip content={<EuroTooltip />} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );

    case "donut":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={cleanData}
              dataKey={tab.yKey}
              nameKey={tab.nameKey ?? undefined}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={100}
              label={({ name, value }) => formatPieLabel(tab.yKey, name ?? "", value as number)}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}

            >
              {cleanData.map((entry, i) => {
                const highlighted = isDataPointHighlighted(entry);
                return (
                  <Cell
                    key={i}
                    fill={highlighted ? getCellFill(i) : "#e5e5e5"}
                    opacity={highlighted ? 1 : 0.3}
                  />
                );
              })}
            </Pie>
            <Tooltip content={<EuroTooltip />} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );

    case "line":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={translatedData}
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey={effectiveXKey ?? undefined}
              tick={{ fontSize: 12 }}
              label={isYearKey(effectiveXKey) ? YEAR_AXIS_LABEL : undefined}
            />
            <YAxis {...yAxisProps(tab.yKey)} />
            <Tooltip content={<EuroTooltip />} />
            <Line
              type="monotone"
              dataKey={tab.yKey}
              stroke="#2196F3"
              strokeWidth={2}
              activeDot={{ r: 8 }}
              dot={(props: Record<string, unknown>) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: Record<string, unknown> };
                const highlighted = isDataPointHighlighted(payload);
                return <circle cx={cx} cy={cy} r={4} fill={highlighted ? "#2196F3" : "#e5e5e5"} fillOpacity={highlighted ? 1 : 0.3} />;
              }}
            />
            {tab.yKey2 && (
              <Line
                type="monotone"
                dataKey={tab.yKey2}
                stroke="#FF9800"
                strokeWidth={2}
                activeDot={{ r: 6 }}
                dot={(props: Record<string, unknown>) => {
                  const { cx, cy, payload } = props as { cx: number; cy: number; payload: Record<string, unknown> };
                  const highlighted = isDataPointHighlighted(payload);
                  return <circle cx={cx} cy={cy} r={4} fill={highlighted ? "#FF9800" : "#e5e5e5"} fillOpacity={highlighted ? 1 : 0.3} />;
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      );

    case "area":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={translatedData}
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey={effectiveXKey ?? undefined}
              tick={{ fontSize: 12 }}
              label={isYearKey(effectiveXKey) ? YEAR_AXIS_LABEL : undefined}
            />
            <YAxis {...yAxisProps(tab.yKey)} />
            <Tooltip content={<EuroTooltip />} />
            <Area
              type="monotone"
              dataKey={tab.yKey}
              stroke="#4CAF50"
              fill="#4CAF50"
              fillOpacity={0.3}
              dot={(props: Record<string, unknown>) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: Record<string, unknown> };
                const highlighted = isDataPointHighlighted(payload);
                return <circle cx={cx} cy={cy} r={4} fill={highlighted ? "#4CAF50" : "#e5e5e5"} fillOpacity={highlighted ? 0.8 : 0.3} />;
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      );

    case "scatter":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey={effectiveXKey ?? undefined}
              type="number"
              name={effectiveXKey ?? "x"}
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => isNumericKey(effectiveXKey) ? formatNumber(v) : String(v)}
              label={getAxisLabel(effectiveXKey) ?? (isYearKey(effectiveXKey) ? YEAR_AXIS_LABEL : undefined)}
            />
            <YAxis
              dataKey={tab.yKey}
              type="number"
              name={tab.yKey}
              {...yAxisProps(tab.yKey)}
            />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<EuroTooltip />} />
            <Scatter
              data={translatedData}
              fill="#E91E63"
              isAnimationActive={false}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
            >
              {translatedData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={isDataPointHighlighted(entry) ? "#E91E63" : "#e5e5e5"}
                  fillOpacity={isDataPointHighlighted(entry) ? 1 : 0.3}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      );

    case "radar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={translatedData}>
            <PolarGrid />
            <PolarAngleAxis dataKey={effectiveXKey ?? undefined} tick={{ fontSize: 11 }} />
            <PolarRadiusAxis {...yAxisProps(tab.yKey)} />
            <Tooltip content={<EuroTooltip />} />
            <Radar
              name={tab.title}
              dataKey={tab.yKey}
              stroke="#9C27B0"
              fill="#9C27B0"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      );

    case "composed":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={translatedData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey={effectiveXKey ?? undefined}
              tick={{ fontSize: 12 }}
              label={isYearKey(effectiveXKey) ? YEAR_AXIS_LABEL : undefined}
            />
            <YAxis {...yAxisProps(tab.yKey, tab.yKey2)} />
            <Tooltip content={<EuroTooltip />} />
            <Legend />
            <Bar dataKey={tab.yKey} fill="#4CAF50" radius={[4, 4, 0, 0]}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
            >
              {translatedData.map((entry, i) => (
                <Cell
                  key={`comp-${i}`}
                  fillOpacity={isDataPointHighlighted(entry) ? 1 : 0.3}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey={tab.yKey2 ?? tab.yKey}
              stroke="#2196F3"
              strokeWidth={2}
              dot={(props: Record<string, unknown>) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: Record<string, unknown> };
                const highlighted = isDataPointHighlighted(payload);
                return <circle cx={cx} cy={cy} r={4} fill={highlighted ? "#2196F3" : "#e5e5e5"} fillOpacity={highlighted ? 1 : 0.3} />;
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      );

    case "waterfall": {
      const wfData = buildWaterfallData(translatedData, tab.yKey, tab.waterfall_base);
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={wfData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey={effectiveXKey ?? undefined}
              tick={{ fontSize: 12 }}
              label={isYearKey(effectiveXKey) ? YEAR_AXIS_LABEL : undefined}
            />
            <YAxis {...yAxisProps(tab.yKey)} />
            <Tooltip content={<EuroTooltip />} />
            {/* Invisible base bar — pushes each visible bar to start above previous cumulative */}
            <Bar dataKey="_wfBase" stackId="wf" fill="transparent" />
            <Bar
              dataKey={tab.yKey}
              stackId="wf"
              shape={<WaterfallBar />}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
            >
              {wfData.map((entry, i) => (
                <Cell
                  key={`wf-${i}`}
                  fillOpacity={isDataPointHighlighted(entry) ? 1 : 0.6}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    }

    default:
      return (
        <div className="flex items-center justify-center h-full text-gray-400 text-sm">
          Unknown chart type: {tab.type}
        </div>
      );
  }
}