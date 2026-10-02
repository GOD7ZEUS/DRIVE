export const STATUS_LABELS = {
  planning: 'Planning',
  // Stored as 'active'; shown as In Development — Live is the other
  // "in progress" meaning (rolled out, ongoing).
  active: 'In Development',
  live: 'Live',
  on_hold: 'On Hold',
  completed: 'Completed',
  pending: 'Pending',
  done: 'Done',
  todo: 'To Do',
  in_progress: 'In Progress',
};

export default function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status] || status}</span>;
}
