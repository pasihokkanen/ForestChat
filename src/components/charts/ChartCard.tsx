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
import { displayOperationType } from "@/lib/ai/config";

// Format number with space as thousand separator (Finnish/SI convention: 10 000)
function formatEuro(value: number): string {
  const formatted = Math.abs(value)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0"); // non-breaking space
  return value < 0 ? `−${formatted}` : formatted;
}

// Detect if a key likely holds euro values by name heuristics
function isEuroKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes("euro") || lower.includes("eur") || lower.includes("income") || lower.includes("cost") || lower.includes("revenue") || lower.includes("price");
}

// Detect if a key likely holds year values
function isYearKey(key: string | null | undefined): boolean {
  return key?.toLowerCase() === "year" || key?.toLowerCase() === "vuosi";
}

// Custom tooltip that formats currency values with thousand separators
function EuroTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !payload) return null;
  return (
    <div style={{
      backgroundColor: "white",
      border: "1px solid #e5e7eb",
      borderRadius: "6px",
      padding: "8px 12px",
      fontSize: "13px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{String(label)}</div>
      {(payload as Array<Record<string, unknown>>).map((entry, i) => {
        const val = entry.value as number;
        const name = entry.name as string;
        const color = entry.color as string;
        if (val === undefined || val === null) return null;
        return (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, display: "inline-block" }} />
            <span>{name}:</span>
            <span style={{ fontWeight: 500 }}>
              {isEuroKey(name) || isEuroKey(entry.dataKey as string)
                ? `${formatEuro(val)} €`
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
  const { fill: _fill, value, ...rest } = props;
  const barColor =
    typeof value === "number" && value < 0 ? "#E53935" : "#4CAF50";
  return <Rectangle {...rest} fill={barColor} />;
}

interface ChartCardProps {
  tab: ChartTab;
}

export default function ChartCard({ tab }: ChartCardProps) {
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const selectedYear = useForestStore((s) => s.selectedYear);
  const setSelectedYear = useForestStore((s) => s.setSelectedYear);
  const setHighlightedStands = useForestStore((s) => s.setHighlightedStands);

  // Handle click on chart element
  const handleChartClick = (data: Record<string, unknown> | undefined) => {
    if (!data) return;

    // If chart has stand_dimension, clicking highlights that stand
    if (tab.standDimension) {
      const standId = data[tab.standDimension] as string;
      if (standId) {
        // Toggle: clicking same stand deselects
        setHighlightedStands(
          highlightedStandIds.includes(standId) ? [] : [standId]
        );
        return;
      }
    }

    // If x_key is "year" or similar, clicking filters by that value
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
          const en = displayOperationType(row[key] as string);
          if (en !== row[key]) translated[key] = en;
        }
      }
      return translated;
    });
  }, [tab.data, effectiveXKey, tab.nameKey, tab.colorKey]);

  // Determine if a data point is "active" (highlighted)
  const isActive = (_entry: Record<string, unknown>): boolean => {
    return false; // Simplified — full active highlighting handled by Cell opacity
  };

  // Choose fill based on active state
  const getCellFill = (index: number, baseColor?: string): string => {
    return baseColor ?? CHART_COLORS[index % CHART_COLORS.length];
  };

  const getActiveOpacity = (_entry: Record<string, unknown>): number => {
    if (tab.standDimension && highlightedStandIds.length > 0) return 1;
    return 1;
  };

  switch (tab.type) {
    case "bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
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
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => isEuroKey(tab.yKey) ? formatEuro(v) : String(v)}
              label={isEuroKey(tab.yKey) ? EURO_AXIS_LABEL : undefined}
            />
            <Tooltip content={<EuroTooltip />} />
            <Bar
              dataKey={tab.yKey}
              fill="#4CAF50"
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
              radius={[4, 4, 0, 0]}
            />
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
        const hasDual = !!(tab.yKey2); // income (yKey) + costs (yKey2)

        for (const row of tab.data) {
          const xVal = String(row[effectiveXKey ?? "x"] ?? "");
          const rawColorVal = String(row[tab.colorKey ?? ""] ?? "");
          const displayColorVal = displayOperationType(rawColorVal);
          colorValues.add(displayColorVal);
          if (!pivotMap.has(xVal)) {
            const entry: Record<string, unknown> = {};
            if (effectiveXKey) entry[effectiveXKey] = row[effectiveXKey];
            pivotMap.set(xVal, entry);
          }
          const entry = pivotMap.get(xVal)!;

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
        const pivotedArr = Array.from(pivotMap.values());
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
          <BarChart
            data={pivoted}
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
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => {
                const anyEuro = stackKeys.some((k) => isEuroKey(k)) || isEuroKey(tab.yKey) || isEuroKey(tab.yKey2 ?? "");
                return anyEuro ? formatEuro(v) : String(v);
              }}
              label={(() => {
                const anyEuro = stackKeys.some((k) => isEuroKey(k)) || isEuroKey(tab.yKey) || isEuroKey(tab.yKey2 ?? "");
                return anyEuro ? EURO_AXIS_LABEL : undefined;
              })()}
            />
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
                      />
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
                      />
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
                  />
                ))}
          </BarChart>
        </ResponsiveContainer>
      );

    case "horizontal_bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={translatedData}
            layout="vertical"
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              type="number"
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => isEuroKey(tab.yKey) ? formatEuro(v) : String(v)}
              label={isEuroKey(tab.yKey) ? EURO_AXIS_LABEL : undefined}
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
            />
          </BarChart>
        </ResponsiveContainer>
      );

    case "pie":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={translatedData}
              dataKey={tab.yKey}
              nameKey={tab.nameKey ?? undefined}
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={({ name, value }) => `${name}: ${isEuroKey(tab.yKey) ? formatEuro(value) + " €" : typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value}`}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}

            >
              {translatedData.map((_, i) => (
                <Cell key={i} fill={getCellFill(i)} />
              ))}
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
              data={translatedData}
              dataKey={tab.yKey}
              nameKey={tab.nameKey ?? undefined}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={100}
              label={({ name, value }) => `${name}: ${isEuroKey(tab.yKey) ? formatEuro(value) + " €" : typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value}`}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}

            >
              {translatedData.map((_, i) => (
                <Cell key={i} fill={getCellFill(i)} />
              ))}
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
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => isEuroKey(tab.yKey) ? formatEuro(v) : String(v)}
              label={isEuroKey(tab.yKey) ? EURO_AXIS_LABEL : undefined}
            />
            <Tooltip content={<EuroTooltip />} />
            <Line
              type="monotone"
              dataKey={tab.yKey}
              stroke="#2196F3"
              strokeWidth={2}
              activeDot={{ r: 8 }}
            />
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
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => isEuroKey(tab.yKey) ? formatEuro(v) : String(v)}
              label={isEuroKey(tab.yKey) ? EURO_AXIS_LABEL : undefined}
            />
            <Tooltip content={<EuroTooltip />} />
            <Area
              type="monotone"
              dataKey={tab.yKey}
              stroke="#4CAF50"
              fill="#4CAF50"
              fillOpacity={0.3}
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
              tickFormatter={(v: number) => isEuroKey(effectiveXKey ?? "") ? formatEuro(v) : String(v)}
              label={isEuroKey(effectiveXKey ?? "") ? EURO_AXIS_LABEL : isYearKey(effectiveXKey) ? YEAR_AXIS_LABEL : undefined}
            />
            <YAxis
              dataKey={tab.yKey}
              type="number"
              name={tab.yKey}
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => isEuroKey(tab.yKey) ? formatEuro(v) : String(v)}
              label={isEuroKey(tab.yKey) ? EURO_AXIS_LABEL : undefined}
            />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<EuroTooltip />} />
            <Scatter
              data={translatedData}
              fill="#E91E63"
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
            />
          </ScatterChart>
        </ResponsiveContainer>
      );

    case "radar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={translatedData}>
            <PolarGrid />
            <PolarAngleAxis dataKey={effectiveXKey ?? undefined} tick={{ fontSize: 11 }} />
            <PolarRadiusAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => isEuroKey(tab.yKey) ? formatEuro(v) : String(v)}
            />
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
          <ComposedChart
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
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => isEuroKey(tab.yKey) || isEuroKey(tab.yKey2 ?? "") ? formatEuro(v) : String(v)}
              label={isEuroKey(tab.yKey) || isEuroKey(tab.yKey2 ?? "") ? EURO_AXIS_LABEL : undefined}
            />
            <Tooltip content={<EuroTooltip />} />
            <Legend />
            <Bar dataKey={tab.yKey} fill="#4CAF50" radius={[4, 4, 0, 0]} />
            <Line
              type="monotone"
              dataKey={tab.yKey2 ?? tab.yKey}
              stroke="#2196F3"
              strokeWidth={2}
            />
          </ComposedChart>
        </ResponsiveContainer>
      );

    case "waterfall":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
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
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => isEuroKey(tab.yKey) ? formatEuro(v) : String(v)}
              label={isEuroKey(tab.yKey) ? EURO_AXIS_LABEL : undefined}
            />
            <Tooltip content={<EuroTooltip />} />
            <Bar
              dataKey={tab.yKey}
              shape={<WaterfallBar />}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
            />
          </BarChart>
        </ResponsiveContainer>
      );

    default:
      return (
        <div className="flex items-center justify-center h-full text-gray-400 text-sm">
          Unknown chart type: {tab.type}
        </div>
      );
  }
}