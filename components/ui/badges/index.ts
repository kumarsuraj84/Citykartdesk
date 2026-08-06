// Shared badge primitives — import from here in Tasks, Approvals, and any future domain.
// The canonical implementations live in components/requests/ because they originated there;
// these re-exports give every domain a single, location-stable import path.
export { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
export { SLABadge } from '@/components/requests/SLABadge'
