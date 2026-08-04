export interface RecentContextMessage {
  id: string;
  turnId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
  partIndex: number | null;
}

function roleOrder(role: RecentContextMessage["role"]): number {
  if (role === "user") return 0;
  if (role === "assistant") return 1;
  return 2;
}

export function orderRecentContextMessages<T extends RecentContextMessage>(
  records: T[],
): T[] {
  return [...records].sort((left, right) => {
    const timeDifference =
      left.createdAt.getTime() - right.createdAt.getTime();
    if (timeDifference !== 0) return timeDifference;

    const roleDifference = roleOrder(left.role) - roleOrder(right.role);
    if (roleDifference !== 0) return roleDifference;

    if (
      left.turnId !== null &&
      left.turnId === right.turnId &&
      left.partIndex !== null &&
      right.partIndex !== null
    ) {
      const partDifference = left.partIndex - right.partIndex;
      if (partDifference !== 0) return partDifference;
    }

    return left.id.localeCompare(right.id);
  });
}
