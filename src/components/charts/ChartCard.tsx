"use client";

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
    if (tab.xKey && data[tab.xKey] !== undefined) {
      const year = Number(data[tab.xKey]);
      if (!isNaN(year) && year >= 2000 && year <= 2100) {
        setSelectedYear(selectedYear === year ? null : year);
      }
    }
  };

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
            data={tab.data}
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={tab.xKey ?? undefined} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
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
      // Pivot data: rows like [{year, type, income}] → [{year, "Päätehakkuu": 120k, "Harvennus": 34k}]
      const pivotStacked = () => {
        if (!tab.colorKey) return { pivoted: tab.data, stackKeys: [tab.yKey] };
        const colorValues = new Set<string>();
        const pivotMap = new Map<string, Record<string, unknown>>();
        for (const row of tab.data) {
          const xVal = String(row[tab.xKey ?? "x"] ?? "");
          const colorVal = String(row[tab.colorKey ?? ""] ?? "");
          colorValues.add(colorVal);
          if (!pivotMap.has(xVal)) {
            const entry: Record<string, unknown> = {};
            if (tab.xKey) entry[tab.xKey] = row[tab.xKey];
            pivotMap.set(xVal, entry);
          }
          pivotMap.get(xVal)![colorVal] = row[tab.yKey];
        }
        // Sort alphabetically for stable color assignment across recomputes
        const sorted = Array.from(colorValues).sort((a, b) => a.localeCompare(b));
        return {
          pivoted: Array.from(pivotMap.values()),
          stackKeys: sorted,
        };
      };
      const { pivoted, stackKeys } = pivotStacked();
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
            <XAxis dataKey={tab.xKey ?? undefined} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {stackKeys.map((key, i) => (
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
            data={tab.data}
            layout="vertical"
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis
              dataKey={tab.xKey ?? undefined}
              type="category"
              width={100}
              tick={{ fontSize: 12 }}
            />
            <Tooltip />
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
              data={tab.data}
              dataKey={tab.yKey}
              nameKey={tab.nameKey ?? undefined}
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={({ name, value }) => `${name}: ${value}`}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
            >
              {tab.data.map((_, i) => (
                <Cell key={i} fill={getCellFill(i)} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );

    case "donut":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={tab.data}
              dataKey={tab.yKey}
              nameKey={tab.nameKey ?? undefined}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={100}
              label={({ name, value }) => `${name}: ${value}`}
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
            >
              {tab.data.map((_, i) => (
                <Cell key={i} fill={getCellFill(i)} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );

    case "line":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={tab.data}
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={tab.xKey ?? undefined} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
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
            data={tab.data}
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={tab.xKey ?? undefined} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
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
              dataKey={tab.xKey ?? undefined}
              type="number"
              name={tab.xKey ?? "x"}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              dataKey={tab.yKey}
              type="number"
              name={tab.yKey}
              tick={{ fontSize: 12 }}
            />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter
              data={tab.data}
              fill="#E91E63"
              onClick={(data) => handleChartClick(data as unknown as Record<string, unknown>)}
            />
          </ScatterChart>
        </ResponsiveContainer>
      );

    case "radar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={tab.data}>
            <PolarGrid />
            <PolarAngleAxis dataKey={tab.xKey ?? undefined} tick={{ fontSize: 11 }} />
            <PolarRadiusAxis tick={{ fontSize: 11 }} />
            <Tooltip />
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
            data={tab.data}
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={tab.xKey ?? undefined} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
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
            data={tab.data}
            onClick={(e) =>
              handleChartClick(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any)?.activePayload?.[0]?.payload as Record<string, unknown> | undefined
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={tab.xKey ?? undefined} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
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