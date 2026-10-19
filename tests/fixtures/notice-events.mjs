// Exercise the host's real event-to-notice mapping without making provider calls.
export default function ({ host }, { event, notice } = {}) {
  if (event) host.onSessionEvent(event);
  if (notice) host.notice(notice.message, notice.level);
}
