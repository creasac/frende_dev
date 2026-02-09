export function getPresenceStatus(lastSeen: string): {
  isOnline: boolean
  lastSeenText: string
} {
  const lastSeenDate = new Date(lastSeen)
  const now = new Date()
  const diffMs = now.getTime() - lastSeenDate.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)

  // Consider online if last seen within 2 minutes
  const isOnline = diffMinutes < 2

  let lastSeenText = ''
  if (isOnline) {
    lastSeenText = 'Online'
  } else if (diffMinutes < 60) {
    lastSeenText = `${diffMinutes}m ago`
  } else if (diffMinutes < 1440) {
    const hours = Math.floor(diffMinutes / 60)
    lastSeenText = `${hours}h ago`
  } else {
    const days = Math.floor(diffMinutes / 1440)
    lastSeenText = `${days}d ago`
  }

  return { isOnline, lastSeenText }
}