export type SliceKind = 'route' | 'process' | 'tool' | 'community' | 'database';

export interface SliceSeed {
  id: string;
  kind: SliceKind;
  title: string;
  source: string;
}

export interface SlicePlan {
  slices: SliceSeed[];
  total_count: number;
  by_kind: Record<SliceKind, number>;
}