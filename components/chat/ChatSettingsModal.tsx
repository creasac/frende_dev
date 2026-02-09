'use client'

export default function ChatSettingsModal({
  title,
  onClose,
  onClearChat,
  onDeleteChat,
  onAddMembers,
  clearing,
  deleting,
}: {
  title?: string
  onClose: () => void
  onClearChat: () => void
  onDeleteChat: () => void
  onAddMembers?: () => void
  clearing?: boolean
  deleting?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Chat Settings</h2>
            {title && <p className="text-sm text-gray-500">{title}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Close
          </button>
        </div>

        <div className="space-y-4">
          {onAddMembers && (
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900">Group members</h3>
              <p className="mt-1 text-sm text-gray-500">
                Invite new people to this group.
              </p>
              <button
                onClick={onAddMembers}
                className="mt-3 rounded-lg bg-azure px-3 py-2 text-sm text-white hover:bg-azure/90"
              >
                Add members
              </button>
            </div>
          )}
          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900">Clear chat history</h3>
            <p className="mt-1 text-sm text-gray-500">
              Removes messages from your view only. Others still keep their history.
            </p>
            <button
              onClick={onClearChat}
              disabled={clearing}
              className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              {clearing ? 'Clearing...' : 'Clear history'}
            </button>
          </div>

          <div className="rounded-lg border border-red-200 bg-red-50/40 p-4">
            <h3 className="font-medium text-red-700">Delete chat</h3>
            <p className="mt-1 text-sm text-red-600">
              Hides this chat from your list. It will reappear if someone sends a new message.
            </p>
            <button
              onClick={onDeleteChat}
              disabled={deleting}
              className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete chat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
