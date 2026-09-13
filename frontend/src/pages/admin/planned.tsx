import { AdminPlaceholder } from './placeholder'

// The three nav entries whose backing work does not exist yet. They are in
// the nav so the shell was designed once for nine areas rather than
// retrofitted from six.

export function AdminTeachersPage() {
  return (
    <AdminPlaceholder
      crumb="Users"
      title="Teachers"
      scope="Teacher accounts with their own groups: inviting students, assigning exercises, and tracking class progress."
      blockedBy="Depends on the teacher / org model, which is a later phase."
    />
  )
}

export function AdminExpertsPage() {
  return (
    <AdminPlaceholder
      crumb="Users"
      title="Experts"
      scope="Assigning exercises to reviewers, reading structured reviews, commenting on individual findings, and requesting a re-review."
      blockedBy="Depends on the expert-review workspace (Track B), which is designed but not built."
    />
  )
}

export function AdminFeedbackPage() {
  return (
    <AdminPlaceholder
      crumb="Insights"
      title="Feedback"
      scope="Per-exercise discussion threads where students comment or report problems, and possibly support tickets through the same mechanism."
      blockedBy="Not yet scoped. Structurally the same shape as expert-review comments: a thread anchored to a subject."
    />
  )
}
