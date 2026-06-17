export type SliceKind = "route" | "process" | "tool" | "community" | "database";

export interface SliceSeed {
  id: string;
  kind: SliceKind;
  title: string;
  source?: string;
}

export interface DiscoveryGap {
  kind: "route" | "process" | "tool" | "community" | "table";
  reason: string;
  raw_line?: string;
}

export interface SlicePlan {
  slices: SliceSeed[];
  total_count: number;
  by_kind: Record<SliceKind, number>;
  gaps?: DiscoveryGap[];
}
